"""
Skill descriptions for embedding text (09a2).

The benchmark (docs/evaluation/embedding-benchmark-2026-10-13/) showed that
embedding "Name: description" instead of the bare name raises related-vs-
unrelated ROC-AUC from ~0.87 to ~0.996, so each skill is embedded with a short
description when one is known:

    build_embed_text("Celery") → "Celery: Python distributed task queue for running background jobs"

Descriptions come from DescriptionProviders consulted in order (first hit
wins): CuratedFileProvider (app/data/skill_descriptions.json, reviewed by
hand), then EscoDescriptionProvider when ESCO_DESCRIPTIONS_ENABLED=true (09b). Descriptions are embedding text
only; the CV parser never reads them.
"""

import json
import logging
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable, List, Optional, Protocol

from app.config.settings import settings
from app.services.embeddings.normalise import normalise_skill

logger = logging.getLogger(__name__)

CURATED_FILE = Path(__file__).resolve().parents[2] / "data" / "skill_descriptions.json"
TEXT_MODES = ("description", "name")


@dataclass(frozen=True)
class Description:
    description: str
    source: str  # 'curated' now; later e.g. 'esco', 'onet', 'llm'


class DescriptionProvider(Protocol):
    name: str

    def lookup(self, canonical: str) -> Optional[Description]: ...


class InvalidDescriptionFile(RuntimeError):
    """The curated description file is missing or malformed."""


class CuratedFileProvider:
    """Hand-reviewed descriptions from app/data/skill_descriptions.json, keyed by canonical name."""

    name = "curated"

    def __init__(self, path: Path = CURATED_FILE):
        self.path = Path(path)
        self._by_key = self._load()

    def _load(self) -> dict:
        try:
            data = json.loads(self.path.read_text(encoding="utf8"))
        except (OSError, ValueError) as exc:
            raise InvalidDescriptionFile(f"Cannot read {self.path}: {exc}") from exc
        if not isinstance(data, dict) or not data:
            raise InvalidDescriptionFile(f"{self.path} must be a non-empty JSON object of name → description")
        by_key = {}
        for name, text in data.items():
            if not isinstance(text, str) or not text.strip():
                raise InvalidDescriptionFile(f"{self.path}: empty or non-text description for {name!r}")
            key, canonical = normalise_skill(name)
            if canonical != name:
                raise InvalidDescriptionFile(f"{self.path}: {name!r} is not a canonical name (expected {canonical!r})")
            if key in by_key:
                raise InvalidDescriptionFile(f"{self.path}: duplicate canonical key {key!r}")
            by_key[key] = text.strip()
        return by_key

    def __len__(self) -> int:
        return len(self._by_key)

    def lookup(self, canonical: str) -> Optional[Description]:
        text = self._by_key.get(normalise_skill(canonical)[0])
        return Description(text, self.name) if text else None


class ChainedProvider:
    """Providers in priority order; the first one that knows the skill wins."""

    name = "chain"

    def __init__(self, providers: Iterable[DescriptionProvider]):
        self.providers: List[DescriptionProvider] = list(providers)

    def lookup(self, canonical: str) -> Optional[Description]:
        for provider in self.providers:
            found = provider.lookup(canonical)
            if found:
                return found
        return None


class EscoDescriptionProvider:
    """ESCO skill descriptions (ai_db.esco_skills), keyed by the cleaned ESCO label.
    Consulted after the curated file, and only when ESCO_DESCRIPTIONS_ENABLED=true
    (off by default: ESCO descriptions are long and were not part of the benchmark
    behind the related threshold)."""

    name = "esco"

    def __init__(self, descriptions: dict):
        # descriptions: {canonical name: description}
        self._by_key = {}
        for name, text in descriptions.items():
            key = normalise_skill(name)[0]
            if key and text and key not in self._by_key:
                self._by_key[key] = " ".join(text.split())

    def __len__(self) -> int:
        return len(self._by_key)

    def lookup(self, canonical: str) -> Optional[Description]:
        text = self._by_key.get(normalise_skill(canonical)[0])
        return Description(text, self.name) if text else None


_provider: Optional[DescriptionProvider] = None
_curated: Optional[CuratedFileProvider] = None


def load_description_provider(esco: Optional[EscoDescriptionProvider] = None) -> DescriptionProvider:
    """Build (and validate) the provider chain: curated, then ESCO when given. Raises InvalidDescriptionFile."""
    global _provider, _curated
    _curated = _curated or CuratedFileProvider()
    _provider = ChainedProvider([_curated] + ([esco] if esco is not None else []))
    logger.info("Skill descriptions loaded: %d curated%s", len(_curated), f", {len(esco)} ESCO" if esco is not None else "")
    return _provider


def get_description_provider() -> DescriptionProvider:
    return _provider or load_description_provider()


def use_description_provider(provider: Optional[DescriptionProvider]) -> None:
    """Substitute the provider (tests); None reloads the curated file on next use."""
    global _provider, _curated
    _provider = provider
    if provider is None:
        _curated = None


def text_mode() -> str:
    mode = (settings.EMBEDDING_TEXT_MODE or "description").strip().lower()
    return mode if mode in TEXT_MODES else "description"


# Distinct skills embedded without a description, logged once each (to extend the curated file).
_logged_unknown: set = set()


@dataclass(frozen=True)
class EmbedText:
    text: str
    has_description: bool
    description_source: Optional[str]


def build_embed_text(canonical: str, mode: Optional[str] = None, provider: Optional[DescriptionProvider] = None) -> EmbedText:
    """'Name: description' in description mode when one is known, else the name."""
    mode = mode or text_mode()
    if mode == "name":
        return EmbedText(canonical, False, None)
    found = (provider or get_description_provider()).lookup(canonical)
    if found:
        return EmbedText(f"{canonical}: {found.description}", True, found.source)
    key = normalise_skill(canonical)[0]
    if key not in _logged_unknown:
        _logged_unknown.add(key)
        logger.info("No description for skill %r; embedding its name only", canonical)
    return EmbedText(canonical, False, None)


def reset_unknown_log() -> None:
    _logged_unknown.clear()


def unknown_logged() -> List[str]:
    return sorted(_logged_unknown)

