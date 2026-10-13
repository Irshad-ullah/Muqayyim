"""
Embedding model (Module 2 FE-4/FE-5, CON-8).

The sentence-transformers model is loaded in a background task at startup;
the API never waits for it. State: 'loading' | 'ready' | 'failed'. A failed
load is logged as critical and retried with backoff (30 s, doubling, max 10
min). The first load downloads the model into EMBEDDING_CACHE_DIR; later
loads use the cached copy only (local_files_only), so the service works
offline after the first download.

Everything that embeds goes through an Embedder (get_embedder()); tests
replace it with the deterministic FakeEmbedder via use_embedder() and never
download the model.
"""

import asyncio
import logging
import time
from typing import List, Optional, Protocol

import numpy as np

from app.config.settings import settings

logger = logging.getLogger(__name__)

LOADING, READY, FAILED = "loading", "ready", "failed"
RETRY_START_SECONDS, RETRY_MAX_SECONDS = 30, 600


class ModelNotReady(Exception):
    """The embedding model is still loading (or failed to load)."""


class Embedder(Protocol):
    model_name: str
    dimension: Optional[int]  # read from the loaded model; None while loading

    @property
    def ready(self) -> bool: ...

    @property
    def state(self) -> str: ...

    def embed_texts(self, texts: List[str]) -> np.ndarray: ...


def l2_normalise(vectors: np.ndarray) -> np.ndarray:
    vectors = np.asarray(vectors, dtype=np.float32)
    norms = np.linalg.norm(vectors, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return (vectors / norms).astype(np.float32)


class ModelManager:
    """The real sentence-transformers embedder, loaded in the background."""

    def __init__(self, model_name: Optional[str] = None, cache_dir: Optional[str] = None):
        self.model_name = model_name or settings.EMBEDDING_MODEL
        self.cache_dir = cache_dir or settings.EMBEDDING_CACHE_DIR
        self.dimension: Optional[int] = None  # read from the model once loaded
        self._state = LOADING
        self._model = None
        self.error: Optional[str] = None
        self.load_seconds: Optional[float] = None
        self.attempts = 0
        self.ready_event = asyncio.Event()

    @property
    def state(self) -> str:
        return self._state

    @property
    def ready(self) -> bool:
        return self._state == READY

    def load_sync(self) -> None:
        """Load the model (blocking). Cached copy first, then a one-time download."""
        started = time.perf_counter()  # includes importing torch (~7 s on first use)
        from sentence_transformers import SentenceTransformer

        kwargs = {"cache_folder": self.cache_dir, "device": "cpu"}
        try:
            model = SentenceTransformer(self.model_name, local_files_only=True, **kwargs)
        except Exception:  # not cached yet: download once
            logger.info("Embedding model %s not cached; downloading to %s", self.model_name, self.cache_dir)
            model = SentenceTransformer(self.model_name, **kwargs)
        get_dimension = getattr(model, "get_embedding_dimension", None) or model.get_sentence_embedding_dimension
        self.dimension = int(get_dimension())
        self._model = model
        self.load_seconds = round(time.perf_counter() - started, 2)
        self._state, self.error = READY, None

    async def load_forever(self) -> None:
        """Background task: load, retrying with backoff until it succeeds."""
        delay = RETRY_START_SECONDS
        while not self.ready:
            self.attempts += 1
            self._state = LOADING
            try:
                await asyncio.to_thread(self.load_sync)
                logger.info("Embedding model %s ready in %.2fs", self.model_name, self.load_seconds)
                self.ready_event.set()
                return
            except Exception as exc:  # noqa: BLE001
                from app.services.error_logger import log_error

                self._state, self.error = FAILED, f"{type(exc).__name__}: {exc}"[:300]
                log_error(
                    level="critical",
                    module="embeddings",
                    error_type="EMBEDDING_MODEL_LOAD_FAILED",
                    message=f"Could not load {self.model_name} (attempt {self.attempts}): {self.error}. Retrying in {delay}s.",
                )
                await asyncio.sleep(delay)
                delay = min(delay * 2, RETRY_MAX_SECONDS)

    def embed_texts(self, texts: List[str]) -> np.ndarray:
        """Batched, L2-normalised float32 vectors (len(texts) × model dimension). No instruction prefix:
        skill-to-skill similarity is symmetric."""
        if not self.ready:
            raise ModelNotReady(self.model_name)
        if not texts:
            return np.zeros((0, self.dimension), dtype=np.float32)
        vectors = self._model.encode(
            list(texts), batch_size=64, convert_to_numpy=True, normalize_embeddings=True, show_progress_bar=False
        )
        return l2_normalise(vectors)

    def health(self) -> dict:
        return {
            "state": self._state,
            "model": self.model_name,
            "dimension": self.dimension,
            "loadSeconds": self.load_seconds,
            "error": self.error,
        }


_manager: Optional[ModelManager] = None
_override: Optional[Embedder] = None


def get_manager() -> ModelManager:
    global _manager
    if _manager is None:
        _manager = ModelManager()
    return _manager


def get_embedder() -> Embedder:
    """FastAPI dependency / service default: the active embedder."""
    return _override or get_manager()


def use_embedder(embedder: Optional[Embedder]) -> None:
    """Substitute the embedder (tests); None restores the real model."""
    global _override
    _override = embedder
