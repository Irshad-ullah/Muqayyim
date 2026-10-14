"""
Matching configuration for the future skill-matching module (Module 5).
Nothing here performs matching yet.

Matching rule (per required skill, compared with each of the user's skills):
  1. same canonical key                      → matched  (credit 1.0)
  2. else cosine similarity ≥ relatedThreshold → related  (credit 0.5)
  3. else                                     → missing  (credit 0)

Why exact keys for "matched": there is no reliable similarity cut-off for a
strong match. Alternatives such as MySQL ↔ PostgreSQL score ~0.96, higher than
many strongly related pairs, so embeddings only decide related vs unrelated.

The 0.73 threshold is the lowest similarity giving >= 95% precision for
"related" (recall 94%) on benchmark v2, which includes 92 hard negatives
(technical skills from different areas; docs/evaluation/embedding-benchmark-2026-10-14/).
Known false positives above it: React ↔ Python (0.78), Redux ↔ Redis (0.744);
Module 5 may add a mutual-nearest-neighbour check to reduce them.
It is valid ONLY for the model and text mode it was measured with;
get_related_threshold() refuses to return it for anything else — re-measure first.
"""

import logging
from typing import Optional

from app.config.settings import settings
from app.services.embeddings.descriptions import text_mode

logger = logging.getLogger(__name__)

MATCHED_CREDIT, RELATED_CREDIT, MISSING_CREDIT = 1.0, 0.5, 0.0


def embedding_config() -> dict:
    return {
        "relatedThreshold": settings.EMBEDDING_RELATED_THRESHOLD,
        "thresholdModel": settings.EMBEDDING_THRESHOLD_MODEL,
        "thresholdTextMode": settings.EMBEDDING_THRESHOLD_TEXT_MODE,
    }


def get_related_threshold(model: Optional[str] = None, mode: Optional[str] = None) -> Optional[float]:
    """The related threshold, or None (with a warning) if it was not measured for the active model/text mode."""
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
    return config["relatedThreshold"]
