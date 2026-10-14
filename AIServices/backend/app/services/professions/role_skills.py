"""
Role-skill vectors: every distinct skill of the active professions gets a
vector in ai_db.skill_vectors through the shared embedding layer
(get_skill_vectors: same cache, same model, same "Name: description" text as
user skills). Each skill is embedded on its own; there are no role vectors.
"""

from typing import Dict, List, Tuple

import numpy as np

from app.config.database import get_database
from app.services.embeddings.descriptions import get_description_provider
from app.services.embeddings.vector_store import get_skill_vectors
from app.services.professions.store import PROFESSIONS, active_filter

BATCH = 256


async def active_professions(db=None) -> List[dict]:
    db = db if db is not None else get_database()
    projection = {"_id": 0, "profession_id": 1, "title": 1, "source": 1, "skills": 1}
    return [doc async for doc in db[PROFESSIONS].find(active_filter(), projection).sort("profession_id", 1)]


def distinct_role_skills(professions: List[dict]) -> List[Tuple[str, str]]:
    """[(key, name)] over the given professions, first-seen name per key."""
    seen: Dict[str, str] = {}
    for profession in professions:
        for skill in profession.get("skills") or []:
            seen.setdefault(skill["key"], skill["name"])
    return list(seen.items())


async def ensure_role_skill_vectors(pairs: List[Tuple[str, str]], embedder=None, db=None) -> Dict[str, np.ndarray]:
    """{key: vector} for the role skills, embedding only cache misses, in batches.
    Raises ModelNotReady if anything is missing and the model is not loaded."""
    vectors: Dict[str, np.ndarray] = {}
    names = [name for _, name in pairs]
    for start in range(0, len(names), BATCH):
        vectors.update(await get_skill_vectors(names[start:start + BATCH], embedder, db))
    return vectors


def description_coverage(pairs: List[Tuple[str, str]]) -> dict:
    provider = get_description_provider()
    described = sum(1 for _, name in pairs if provider.lookup(name))
    total = len(pairs)
    return {"total": total, "described": described, "described_pct": round(100 * described / total, 1) if total else 0.0}


async def professions_health(db=None) -> dict:
    """For /health: active professions per source, distinct role skills, % described."""
    db = db if db is not None else get_database()
    if db is None:
        return {"available": False}
    by_source = {}
    async for row in db[PROFESSIONS].aggregate([{"$match": active_filter()}, {"$group": {"_id": "$source", "n": {"$sum": 1}}}]):
        by_source[row["_id"]] = row["n"]
    pairs = distinct_role_skills(await active_professions(db))
    coverage = description_coverage(pairs)
    return {
        "active_by_source": by_source,
        "active_total": sum(by_source.values()),
        "distinct_role_skills": coverage["total"],
        "described_pct": coverage["described_pct"],
    }
