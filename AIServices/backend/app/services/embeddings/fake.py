"""
Deterministic fake embedder for tests: each text maps to a fixed unit-length
384-dim vector derived from its SHA-256 hash. No model, no network.
"""

import hashlib
from typing import List

import numpy as np

from app.services.embeddings.model import DIMENSION, LOADING, READY, ModelNotReady, l2_normalise


class FakeEmbedder:
    def __init__(self, model_name: str = "fake/hash-embedder", ready: bool = True):
        self.model_name = model_name
        self.dimension = DIMENSION
        self._ready = ready
        self.calls: List[List[str]] = []

    @property
    def ready(self) -> bool:
        return self._ready

    @property
    def state(self) -> str:
        return READY if self._ready else LOADING

    def set_ready(self, ready: bool = True) -> None:
        self._ready = ready

    def embed_texts(self, texts: List[str]) -> np.ndarray:
        if not self._ready:
            raise ModelNotReady(self.model_name)
        self.calls.append(list(texts))
        rows = []
        for text in texts:
            seed = int.from_bytes(hashlib.sha256(f"{self.model_name}|{text}".encode()).digest()[:8], "little")
            rows.append(np.random.default_rng(seed).standard_normal(DIMENSION))
        return l2_normalise(np.array(rows) if rows else np.zeros((0, DIMENSION)))

    @property
    def embedded_texts(self) -> List[str]:
        return [t for call in self.calls for t in call]

    def health(self) -> dict:
        return {"state": self.state, "model": self.model_name, "dimension": DIMENSION, "loadSeconds": 0.0, "error": None}
