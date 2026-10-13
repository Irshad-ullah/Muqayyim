"""
Re-embedding after a model or text-mode change (used by
AIServices/scripts/reembed_all.py).

For the current EMBEDDING_MODEL and EMBEDDING_TEXT_MODE:
  1. collect every skill key in skill_vectors (under ANY model or text mode)
     and every key referenced by user_skill_profiles;
  2. embed each one whose current text (name or "Name: description") has no
     vector yet for the current model + mode — in batches;
  3. only after ALL of those were written successfully: delete vectors of
     other models / text modes and stale text hashes, and set
     user_skill_profiles.model / text_mode (status done) for every profile
     whose vectors are all present.
Vectors of different models or text modes are never mixed; running it twice
does nothing the second time.
"""

import time
from datetime import datetime, timezone
from typing import Dict

from app.services.embeddings.descriptions import text_mode as current_text_mode
from app.services.embeddings.normalise import normalise_skill
from app.services.embeddings.user_profiles import dedupe_skills, skills_hash
from app.services.embeddings.vector_store import (
    SKILL_VECTORS,
    USER_SKILL_PROFILES,
    get_skill_vectors,
    load_vectors,
    plan_texts,
)

BATCH = 256


async def _counts(db, model: str, mode: str) -> Dict[str, int]:
    current = {"model": model, "text_mode": mode}
    return {
        "vectors_total": await db[SKILL_VECTORS].count_documents({}),
        "vectors_current": await db[SKILL_VECTORS].count_documents(current),
        "vectors_other": await db[SKILL_VECTORS].count_documents({"$nor": [current]}),
        "profiles_total": await db[USER_SKILL_PROFILES].count_documents({}),
        "profiles_current": await db[USER_SKILL_PROFILES].count_documents({**current, "embedding_status": "done"}),
    }


async def reembed_all(db, embedder, dry_run: bool = False, mode: str = None) -> Dict:
    started = time.perf_counter()
    model = embedder.model_name
    mode = mode or current_text_mode()

    # key → canonical name under the CURRENT normalisation (aliases may have
    # changed since a vector or profile was stored, e.g. "Apache Kafka" → "Kafka").
    names: Dict[str, str] = {}

    def collect(raw_name):
        key, canonical = normalise_skill(raw_name)
        if key:
            names.setdefault(key, canonical)

    async for profile in db[USER_SKILL_PROFILES].find({}, {"skills": 1}):
        for skill in profile.get("skills") or []:
            collect(skill.get("name") or skill.get("key"))
    async for doc in db[SKILL_VECTORS].find({}, {"key": 1, "name": 1}):
        collect(doc.get("name") or doc["key"])

    pairs = list(names.items())
    existing = await load_vectors(pairs, model, db, mode)
    missing = [(k, n) for k, n in pairs if k not in existing]
    before = await _counts(db, model, mode)
    report = {
        "model": model,
        "text_mode": mode,
        "keys": len(pairs),
        "already_embedded": len(existing),
        "to_embed": len(missing),
        "before": before,
    }
    if dry_run:
        return {**report, "embedded": 0, "vectors_removed": 0, "profiles_updated": 0,
                "seconds": round(time.perf_counter() - started, 2)}

    embedded = 0
    for start in range(0, len(missing), BATCH):
        batch = missing[start : start + BATCH]
        await get_skill_vectors([n for _, n in batch], embedder, db, mode)
        embedded += len(batch)

    # Every key now has a current vector: old models/modes and stale texts can go.
    current_hashes = {p.key: p.hash for p in plan_texts(pairs, mode)}
    stored = {
        doc["key"]
        async for doc in db[SKILL_VECTORS].find({"model": model, "text_mode": mode}, {"key": 1, "text_hash": 1})
        if current_hashes.get(doc["key"]) == doc["text_hash"]
    }
    if set(current_hashes) - stored:
        raise RuntimeError(f"{len(set(current_hashes) - stored)} skills still lack a current vector; nothing was removed")
    removed = (await db[SKILL_VECTORS].delete_many({"$nor": [{"model": model, "text_mode": mode}]})).deleted_count
    stale = [{"key": k, "model": model, "text_mode": mode, "text_hash": {"$ne": h}} for k, h in current_hashes.items()]
    if stale:
        removed += (await db[SKILL_VECTORS].delete_many({"$or": stale})).deleted_count

    # Profiles: re-normalise their skills (keys/names may have changed), then
    # record the new model and text mode.
    updated = 0
    async for profile in db[USER_SKILL_PROFILES].find({}):
        entries = dedupe_skills([{"name": s.get("name") or s.get("key"), "source": s.get("source")} for s in profile.get("skills") or []])
        keys = [e["key"] for e in entries]
        if not all(k in stored for k in keys):
            continue
        changes = {
            "skills": entries,
            "skills_hash": skills_hash(keys),
            "model": model,
            "text_mode": mode,
            "embedding_status": "done",
        }
        if any(profile.get(f) != v for f, v in changes.items()):
            await db[USER_SKILL_PROFILES].update_one(
                {"_id": profile["_id"]}, {"$set": {**changes, "updated_at": datetime.now(timezone.utc)}}
            )
            updated += 1

    return {
        **report,
        "embedded": embedded,
        "vectors_removed": removed,
        "profiles_updated": updated,
        "after": await _counts(db, model, mode),
        "seconds": round(time.perf_counter() - started, 2),
    }
