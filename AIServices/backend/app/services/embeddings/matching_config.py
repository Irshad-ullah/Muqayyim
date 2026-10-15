"""
Matching configuration for the skill-matching module (Module 5).
Nothing here performs matching or scoring yet.

FROZEN (09b2): no further embedding tuning before Module 5's end-to-end evaluation.
  model                BAAI/bge-small-en-v1.5
  user text            "description" ("Name: curated description", else the name)
  ESCO text            "label" (ESCO descriptions not used: ESCO_DESCRIPTIONS_ENABLED=false)
  related threshold    0.73, one value for both pair kinds, guarded
  mutual_nn            K = 10, required only for described ↔ described pairs

Pair KIND (reported by search_related; both kinds use the same threshold):
  described  both skills embedded the same way (both described, or neither)
  mixed      the user skill has a curated description, the role skill does not
             (an ESCO phrase / knowledge skill embedded by its label)

Credit rule for Module 5 (documented here, NOT implemented yet), per required skill:
  1. same canonical key                               → matched (1.0)
  2. described: similarity ≥ 0.73 AND mutual_nn       → related (0.5)
  3. mixed:     similarity ≥ 0.73 (no mutual check)   → related (0.5)
  4. otherwise                                        → missing (0)

Evidence:
  * 0.73 — benchmark v2: lowest similarity with ≥ 95 % precision (recall 94 %, incl.
    92 hard negatives; docs/evaluation/embedding-benchmark-2026-10-14/). Known false
    positives above it: React ↔ Python (0.78), Redux ↔ Redis (0.744); mutual_nn removes
    the tool-to-tool ones.
  * mixed pairs — benchmark v3 (AIServices/eval/embeddings_v3/): ESCO label text beat
    ESCO descriptions; at 0.73 precision 1.00, recall 0.67 (dev) / 0.74 (held-out).
    A lower mixed threshold (0.61) was rejected: on real ESCO phrases it credited a
    chef profile as much as a web profile (60.8 % vs 60.4 %). mutual_nn is not required
    for mixed pairs: it would drop most true ESCO-phrase matches (34 of 98 kept).
  * Regression check for any future threshold or matching change:
    AIServices/eval/background_credit_rate.py (chef vs web profile).

The threshold is valid ONLY for the setup it was measured with; get_related_threshold()
returns None (with a warning) for anything else.
"""

import logging
from typing import Optional

from app.config.settings import settings
from app.services.embeddings.descriptions import text_mode

logger = logging.getLogger(__name__)

MATCHED_CREDIT, RELATED_CREDIT, MISSING_CREDIT = 1.0, 0.5, 0.0
KINDS = ("described", "mixed")
# The ESCO text mode the threshold was measured with for mixed pairs (benchmark v3).
MIXED_ESCO_TEXT_MODE = "label"


def esco_text_mode() -> str:
    """How ESCO skills without a curated description are embedded: 'label' or 'description'."""
    return "description" if settings.ESCO_DESCRIPTIONS_ENABLED else "label"


def embedding_config() -> dict:
    return {
        "relatedThreshold": settings.EMBEDDING_RELATED_THRESHOLD,
        "thresholdModel": settings.EMBEDDING_THRESHOLD_MODEL,
        "thresholdTextMode": settings.EMBEDDING_THRESHOLD_TEXT_MODE,
        "mixedEscoTextMode": MIXED_ESCO_TEXT_MODE,
        "mutualNnK": settings.MUTUAL_NN_K,
    }


def get_related_threshold(model: Optional[str] = None, mode: Optional[str] = None,
                          kind: str = "described", esco_mode: Optional[str] = None) -> Optional[float]:
    """The related threshold for a pair of `kind`, or None (with a warning) if it was not
    measured for the active model / text mode (and, for 'mixed', the ESCO text mode).
    Both kinds use the same value (0.73)."""
    if kind not in KINDS:
        raise ValueError(f"kind must be one of {KINDS}, not {kind!r}")
    model = model or settings.EMBEDDING_MODEL
    mode = mode or text_mode()
    config = embedding_config()
    if model != config["thresholdModel"] or mode != config["thresholdTextMode"]:
        logger.warning(
            "Related threshold %.2f was measured for %s (%s text), but the active setup is %s (%s text): "
            "re-measure the threshold before matching.",
            config["relatedThreshold"], config["thresholdModel"], config["thresholdTextMode"], model, mode,
        )
        return None
    if kind == "mixed":
        esco_mode = esco_mode or esco_text_mode()
        if esco_mode != MIXED_ESCO_TEXT_MODE:
            logger.warning(
                "Related threshold %.2f was measured for mixed pairs with ESCO %s text, but ESCO skills are "
                "embedded with %s text: re-measure before matching.",
                config["relatedThreshold"], MIXED_ESCO_TEXT_MODE, esco_mode,
            )
            return None
    return config["relatedThreshold"]
