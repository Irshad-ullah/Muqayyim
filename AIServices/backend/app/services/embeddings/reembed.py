"""
Re-embedding for a model change (used by AIServices/scripts/reembed_all.py).

For the current EMBEDDING_MODEL: every skill key stored in skill_vectors under
ANY model, plus every key referenced by user_skill_profiles, gets a vector
for the current model (only missing ones are embedded). Then each user
profile whose keys are all available is marked as using the current model.
Old-model vectors are left in place but never read for the new model, so
vectors of different models are never mixed.
"""

from datetime import datetime, timezone
from typing import Dict

from app.services.embeddings.vector_store import SKILL_VECTORS, USER_SKILL_PROFILES, get_skill_vectors, load_vectors

BATCH = 256


async def reembed_all(db, embedder, dry_run: bool = False) -> Dict[str, int]:
    model = embedder.model_name
    names: Dict[str, str] = {}
    async for doc in db[SKILL_VECTORS].find({}, {"key": 1, "name": 1}):
        names.setdefault(doc["key"], doc.get("name") or doc["key"])
    async for profile in db[USER_SKILL_PROFILES].find({}, {"skills": 1}):
        for skill in profile.get("skills") or []:
            names.setdefault(skill["key"], skill.get("name") or skill["key"])

    existing = await load_vectors(names.keys(), model, db)
    missing = [k for k in names if k not in existing]
    profiles = await db[USER_SKILL_PROFILES].count_documents({"model": {"$ne": model}})
    report = {"keys": len(names), "already_embedded": len(existing), "to_embed": len(missing), "profiles_to_update": profiles}
    if dry_run:
        return {**report, "embedded": 0, "profiles_updated": 0}

    embedded = 0
    for start in range(0, len(missing), BATCH):
        batch = missing[start : start + BATCH]
        await get_skill_vectors([names[k] for k in batch], embedder, db)
        embedded += len(batch)

    updated = 0
    stored = set(await load_vectors(names.keys(), model, db))
    async for profile in db[USER_SKILL_PROFILES].find({}, {"user_id": 1, "skills": 1, "model": 1, "embedding_status": 1}):
        keys = [s["key"] for s in profile.get("skills") or []]
        if all(k in stored for k in keys) and (profile.get("model") != model or profile.get("embedding_status") != "done"):
            await db[USER_SKILL_PROFILES].update_one(
                {"_id": profile["_id"]},
                {"$set": {"model": model, "embedding_status": "done", "updated_at": datetime.now(timezone.utc)}},
            )
            updated += 1
    return {**report, "embedded": embedded, "profiles_updated": updated}
