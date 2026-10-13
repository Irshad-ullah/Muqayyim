"""
Skill vector cache: ai_db.skill_vectors (Module 2 FE-4).

  { key, name, vector: [384 floats], model, created_at }   unique (key, model)

Each distinct skill key is embedded once per model, ever. Lookups always
filter by the current model, so vectors of different models never mix.
"""

import asyncio
from datetime import datetime, timezone
from typing import Dict, Iterable, List, Optional

import numpy as np
from pymongo import ASCENDING
from pymongo.errors import BulkWriteError

from app.config.database import get_database
from app.services.embeddings.model import Embedder, ModelNotReady, get_embedder
from app.services.embeddings.normalise import normalise_skills

SKILL_VECTORS = "skill_vectors"
USER_SKILL_PROFILES = "user_skill_profiles"
DUPLICATE_KEY = 11000


async def ensure_embedding_indexes(db) -> None:
    await db[SKILL_VECTORS].create_index([("key", ASCENDING), ("model", ASCENDING)], unique=True, name="key_model_unique")
    await db[USER_SKILL_PROFILES].create_index([("user_id", ASCENDING)], unique=True, name="user_id_unique")
    await db[USER_SKILL_PROFILES].create_index([("embedding_status", ASCENDING)], name="embedding_status")
    await db["cv_parsed_data"].create_index([("embedding_status", ASCENDING)], name="embedding_status")


async def load_vectors(keys: Iterable[str], model: str, db=None) -> Dict[str, np.ndarray]:
    """Stored vectors for `keys` under `model` only."""
    db = db if db is not None else get_database()
    keys = list(dict.fromkeys(keys))
    if not keys:
        return {}
    cursor = db[SKILL_VECTORS].find({"model": model, "key": {"$in": keys}}, {"_id": 0, "key": 1, "vector": 1})
    return {doc["key"]: np.asarray(doc["vector"], dtype=np.float32) async for doc in cursor}


async def get_skill_vectors(
    names: Iterable[str], embedder: Optional[Embedder] = None, db=None
) -> Dict[str, np.ndarray]:
    """
    {key: unit vector} for the given skill names (normalised, de-duplicated,
    in input order). Only cache misses are embedded, in one batch, and stored.
    Raises ModelNotReady when misses exist and the model is not loaded.
    """
    embedder = embedder or get_embedder()
    db = db if db is not None else get_database()
    pairs = normalise_skills(names)
    if not pairs:
        return {}
    found = await load_vectors([k for k, _ in pairs], embedder.model_name, db)
    misses = [(k, c) for k, c in pairs if k not in found]
    if misses:
        if not embedder.ready:
            raise ModelNotReady(embedder.model_name)
        vectors = await asyncio.to_thread(embedder.embed_texts, [c for _, c in misses])
        now = datetime.now(timezone.utc)
        docs = [
            {"key": k, "name": c, "vector": v.astype(float).tolist(), "model": embedder.model_name, "created_at": now}
            for (k, c), v in zip(misses, vectors)
        ]
        try:
            await db[SKILL_VECTORS].insert_many(docs, ordered=False)
        except BulkWriteError as exc:
            # Another request stored the same (key, model) first: same vector, fine.
            if any(e.get("code") != DUPLICATE_KEY for e in exc.details.get("writeErrors", [])):
                raise
        for (k, _), v in zip(misses, vectors):
            found[k] = v
    return {k: found[k] for k, _ in pairs}


def vector_list(vectors: Dict[str, np.ndarray], keys: List[str]) -> np.ndarray:
    return np.stack([vectors[k] for k in keys]) if keys else np.zeros((0, 384), dtype=np.float32)
