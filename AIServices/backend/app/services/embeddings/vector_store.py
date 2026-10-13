"""
Skill vector cache: ai_db.skill_vectors (Module 2 FE-4; 09a2 description mode).

  { key, name, vector: [model-dimension floats], model, text_mode,
    embedded_text, text_hash, has_description, description_source, created_at }
  unique (key, model, text_mode, text_hash)

The cache identity is the exact text that was embedded: text_hash =
sha256(embedded_text). A lookup returns a stored vector only if its model, text
mode and text hash match what would be embedded now, so a changed description
is re-embedded on next use and stale entries are never returned (they are
removed once the new vector is stored). Vectors of different models or text
modes never mix.
"""

import asyncio
import hashlib
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Dict, Iterable, List, Optional, Tuple

import numpy as np
from pymongo import ASCENDING
from pymongo.errors import BulkWriteError

from app.config.database import get_database
from app.services.embeddings.descriptions import EmbedText, build_embed_text, text_mode
from app.services.embeddings.model import Embedder, ModelNotReady, get_embedder
from app.services.embeddings.normalise import normalise_skills

SKILL_VECTORS = "skill_vectors"
USER_SKILL_PROFILES = "user_skill_profiles"
DUPLICATE_KEY = 11000
VECTOR_INDEX = "key_model_mode_text_unique"


async def ensure_embedding_indexes(db) -> None:
    existing = await db[SKILL_VECTORS].index_information()
    if "key_model_unique" in existing:  # 09a identity (key, model) → 09a2 identity
        await db[SKILL_VECTORS].drop_index("key_model_unique")
    await db[SKILL_VECTORS].create_index(
        [("key", ASCENDING), ("model", ASCENDING), ("text_mode", ASCENDING), ("text_hash", ASCENDING)],
        unique=True,
        name=VECTOR_INDEX,
    )
    await db[SKILL_VECTORS].create_index([("model", ASCENDING), ("text_mode", ASCENDING), ("has_description", ASCENDING)], name="model_mode_described")
    await db[USER_SKILL_PROFILES].create_index([("user_id", ASCENDING)], unique=True, name="user_id_unique")
    await db[USER_SKILL_PROFILES].create_index([("embedding_status", ASCENDING)], name="embedding_status")
    await db["cv_parsed_data"].create_index([("embedding_status", ASCENDING)], name="embedding_status")


def text_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf8")).hexdigest()


@dataclass(frozen=True)
class Planned:
    key: str
    canonical: str
    embed: EmbedText
    hash: str


def plan_texts(pairs: Iterable[Tuple[str, str]], mode: Optional[str] = None) -> List[Planned]:
    """What would be embedded now for each (key, canonical)."""
    mode = mode or text_mode()
    planned = []
    for key, canonical in pairs:
        embed = build_embed_text(canonical, mode)
        planned.append(Planned(key, canonical, embed, text_hash(embed.text)))
    return planned


async def load_vectors_for(planned: List[Planned], model: str, mode: str, db=None) -> Dict[str, np.ndarray]:
    """Stored vectors whose model, text mode and text hash match the planned texts."""
    db = db if db is not None else get_database()
    if not planned:
        return {}
    wanted = {p.key: p.hash for p in planned}
    cursor = db[SKILL_VECTORS].find(
        {"model": model, "text_mode": mode, "key": {"$in": list(wanted)}, "text_hash": {"$in": list(set(wanted.values()))}},
        {"_id": 0, "key": 1, "vector": 1, "text_hash": 1},
    )
    return {
        doc["key"]: np.asarray(doc["vector"], dtype=np.float32)
        async for doc in cursor
        if wanted.get(doc["key"]) == doc["text_hash"]
    }


async def load_vectors(names_or_pairs, model: str, db=None, mode: Optional[str] = None) -> Dict[str, np.ndarray]:
    """Vectors for skill names (or (key, canonical) pairs) under the current text rule."""
    items = list(names_or_pairs)
    pairs = items if items and isinstance(items[0], tuple) else normalise_skills(items)
    mode = mode or text_mode()
    return await load_vectors_for(plan_texts(pairs, mode), model, mode, db)


async def get_skill_vectors(
    names: Iterable[str], embedder: Optional[Embedder] = None, db=None, mode: Optional[str] = None
) -> Dict[str, np.ndarray]:
    """
    {key: unit vector} for the given skill names (normalised, de-duplicated,
    in input order). Only misses — new skills, changed descriptions, another
    model or text mode — are embedded, in one batch, and stored.
    Raises ModelNotReady when misses exist and the model is not loaded.
    """
    embedder = embedder or get_embedder()
    db = db if db is not None else get_database()
    mode = mode or text_mode()
    planned = plan_texts(normalise_skills(names), mode)
    if not planned:
        return {}
    found = await load_vectors_for(planned, embedder.model_name, mode, db)
    misses = [p for p in planned if p.key not in found]
    if misses:
        if not embedder.ready:
            raise ModelNotReady(embedder.model_name)
        vectors = await asyncio.to_thread(embedder.embed_texts, [p.embed.text for p in misses])
        now = datetime.now(timezone.utc)
        docs = [
            {
                "key": p.key,
                "name": p.canonical,
                "vector": v.astype(float).tolist(),
                "model": embedder.model_name,
                "text_mode": mode,
                "embedded_text": p.embed.text,
                "text_hash": p.hash,
                "has_description": p.embed.has_description,
                "description_source": p.embed.description_source,
                "created_at": now,
            }
            for p, v in zip(misses, vectors)
        ]
        try:
            await db[SKILL_VECTORS].insert_many(docs, ordered=False)
        except BulkWriteError as exc:
            # Another request stored the same (key, model, mode, text) first: same vector, fine.
            if any(e.get("code") != DUPLICATE_KEY for e in exc.details.get("writeErrors", [])):
                raise
        # Stale entries for these keys (older description text) are no longer needed.
        await db[SKILL_VECTORS].delete_many(
            {"$or": [{"key": p.key, "model": embedder.model_name, "text_mode": mode, "text_hash": {"$ne": p.hash}} for p in misses]}
        )
        for p, v in zip(misses, vectors):
            found[p.key] = v
    return {p.key: found[p.key] for p in planned}


async def description_counts(model: str, mode: str, db=None) -> dict:
    """Stored vectors for the current model/mode, with and without descriptions."""
    db = db if db is not None else get_database()
    if db is None:
        return {"total": 0, "described": 0, "undescribed": 0}
    total = await db[SKILL_VECTORS].count_documents({"model": model, "text_mode": mode})
    described = await db[SKILL_VECTORS].count_documents({"model": model, "text_mode": mode, "has_description": True})
    return {"total": total, "described": described, "undescribed": total - described}


async def unknown_skills(model: str, mode: str, db=None) -> List[dict]:
    """Distinct skills embedded without a description, with how many users have each."""
    db = db if db is not None else get_database()
    skills = {
        doc["key"]: doc["name"]
        async for doc in db[SKILL_VECTORS].find({"model": model, "text_mode": mode, "has_description": False}, {"key": 1, "name": 1})
    }
    users: Dict[str, int] = {}
    if skills:
        pipeline = [
            {"$unwind": "$skills"},
            {"$match": {"skills.key": {"$in": list(skills)}}},
            {"$group": {"_id": "$skills.key", "users": {"$addToSet": "$user_id"}}},
        ]
        async for row in db[USER_SKILL_PROFILES].aggregate(pipeline):
            users[row["_id"]] = len(row["users"])
    rows = [{"key": k, "name": n, "users": users.get(k, 0)} for k, n in skills.items()]
    return sorted(rows, key=lambda r: (-r["users"], r["name"].lower()))
