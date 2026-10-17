"""
Cache of identical LLM requests (12): ai_db.llm_cache, for LLM_CACHE_TTL_DAYS.

The key is a SHA-256 of (user, feature, prompt version, model, system text, prompt text, output
kind). It includes the user, so one user's output is never served to another, and every entry
carries the user reference so that consent withdrawal or account deletion can delete all of that
user's cached outputs (`delete_user`). A cache hit costs no provider call and no quota.
"""

import hashlib
import json
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.config.settings import settings

CACHE = "llm_cache"


def user_ref(user_id: Optional[str]) -> str:
    """The stored / logged form of a user id (never the id itself)."""
    return hashlib.sha256(str(user_id or "anonymous").encode()).hexdigest()


def cache_key(user: str, feature: str, prompt_ref: str, model: str, system: str, prompt: str, kind: str) -> str:
    material = json.dumps([user, feature, prompt_ref, model, system, prompt, kind], ensure_ascii=False)
    return hashlib.sha256(material.encode()).hexdigest()


async def ensure_cache_indexes(db) -> None:
    await db[CACHE].create_index("expires_at", expireAfterSeconds=0)
    await db[CACHE].create_index("user_ref")


async def get(db, key: str) -> Optional[str]:
    doc = await db[CACHE].find_one({"_id": key, "expires_at": {"$gt": datetime.now(timezone.utc)}}, {"output": 1})
    return doc["output"] if doc else None


async def put(db, key: str, user: str, feature: str, output: str) -> None:
    now = datetime.now(timezone.utc)
    await db[CACHE].replace_one({"_id": key}, {"_id": key, "user_ref": user, "feature": feature, "output": output,
                                               "created_at": now,
                                               "expires_at": now + timedelta(days=settings.LLM_CACHE_TTL_DAYS)},
                                upsert=True)


async def delete_user(db, user: str) -> int:
    return (await db[CACHE].delete_many({"user_ref": user})).deleted_count
