"""
User skill profiles: ai_db.user_skill_profiles (Module 2 FE-5, FR-B9).

  { user_id (unique), skills: [{ name, key, source }], skills_hash, model,
    embedding_status: 'done' | 'pending', requested_at, updated_at }

Every skill keeps its own vector (in skill_vectors, looked up by key). There is
NO averaged profile vector and NO weighting: `source` is stored for display
only and is never used in any calculation.

Dedupe by key: skills are taken in source order manual → cv → github (the
profile's own dedupe order, so the user's own spelling wins) and the first
occurrence of a key keeps its name and its single source. An aliased skill is
always stored under its canonical name.

Latest request per user wins: CoreServices stamps each request with
`requested_at`; an older request never overwrites a newer one.
"""

import asyncio
import hashlib
import logging
from datetime import datetime, timezone
from typing import Dict, List, Optional, Tuple

import numpy as np
from pymongo.errors import DuplicateKeyError

from app.config.database import get_database
from app.services.embeddings.model import DIMENSION, Embedder, ModelNotReady, get_embedder
from app.services.embeddings.normalise import normalise_skill
from app.services.embeddings.vector_store import USER_SKILL_PROFILES, get_skill_vectors, load_vectors

logger = logging.getLogger(__name__)

SOURCE_ORDER = ["manual", "cv", "github"]
DONE, PENDING, FAILED = "done", "pending", "failed"

_locks: Dict[str, asyncio.Lock] = {}


class EmbeddingsPending(Exception):
    """The user's skill vectors are not all available yet."""


def _lock(user_id: str) -> asyncio.Lock:
    return _locks.setdefault(user_id, asyncio.Lock())


def dedupe_skills(skills: List[dict]) -> List[dict]:
    """[{name, source}] → [{name, key, source}], first occurrence per key wins."""
    ordered = sorted(
        (s for s in skills if isinstance(s, dict)),
        key=lambda s: SOURCE_ORDER.index(s.get("source")) if s.get("source") in SOURCE_ORDER else len(SOURCE_ORDER),
    )
    seen, out = set(), []
    for skill in ordered:
        key, canonical = normalise_skill(skill.get("name"))
        if key and key not in seen:
            seen.add(key)
            source = skill.get("source") if skill.get("source") in SOURCE_ORDER else "manual"
            out.append({"name": canonical, "key": key, "source": source})
    return out


def skills_hash(keys: List[str]) -> str:
    return hashlib.sha256("\n".join(sorted(keys)).encode("utf8")).hexdigest()


async def upsert_user_skills(
    user_id: str, skills: List[dict], requested_at: Optional[float] = None, embedder: Optional[Embedder] = None, db=None
) -> Tuple[int, dict]:
    """Store the user's skill list and make sure every skill has a vector. → (http status, body)"""
    embedder = embedder or get_embedder()
    db = db if db is not None else get_database()
    coll = db[USER_SKILL_PROFILES]
    requested_at = float(requested_at) if requested_at is not None else datetime.now(timezone.utc).timestamp() * 1000

    async with _lock(user_id):
        existing = await coll.find_one({"user_id": user_id})
        if existing and (existing.get("requested_at") or 0) > requested_at:
            return 200, {"success": True, "updated": False, "stale": True}

        entries = dedupe_skills(skills)
        if not entries:
            await coll.delete_one({"user_id": user_id})
            return 200, {"success": True, "updated": True, "deleted": True, "skills_count": 0}

        digest = skills_hash([e["key"] for e in entries])
        if (
            existing
            and existing.get("skills_hash") == digest
            and existing.get("model") == embedder.model_name
            and existing.get("embedding_status") == DONE
        ):
            await coll.update_one({"user_id": user_id}, {"$max": {"requested_at": requested_at}})
            return 200, {"success": True, "updated": False, "skills_count": len(entries)}

        status = PENDING
        if embedder.ready:
            try:
                await get_skill_vectors([e["name"] for e in entries], embedder, db)
                status = DONE
            except ModelNotReady:
                status = PENDING
            except Exception as exc:  # noqa: BLE001 — retried by the worker
                _warn("EMBEDDING_FAILED", f"Embedding skills for user {user_id} failed: {type(exc).__name__}")

        record = {
            "user_id": user_id,
            "skills": entries,
            "skills_hash": digest,
            "model": embedder.model_name,
            "embedding_status": status,
            "requested_at": requested_at,
            "updated_at": datetime.now(timezone.utc),
        }
        try:
            await coll.update_one(
                {"user_id": user_id, "$or": [{"requested_at": {"$lte": requested_at}}, {"requested_at": {"$exists": False}}]},
                {"$set": record},
                upsert=True,
            )
        except DuplicateKeyError:  # a newer request was stored meanwhile
            return 200, {"success": True, "updated": False, "stale": True}

    body = {"success": True, "updated": True, "skills_count": len(entries), "embedding_status": status}
    return (200 if status == DONE else 202), body


async def delete_user_skills(user_id: str, db=None) -> bool:
    db = db if db is not None else get_database()
    async with _lock(user_id):
        result = await db[USER_SKILL_PROFILES].delete_one({"user_id": user_id})
    return result.deleted_count > 0


async def get_user_skill_record(user_id: str, db=None) -> Optional[dict]:
    db = db if db is not None else get_database()
    return await db[USER_SKILL_PROFILES].find_one({"user_id": user_id}, {"_id": 0})


async def get_user_skill_matrix(
    user_id: str, model: Optional[str] = None, db=None
) -> Tuple[List[str], List[str], np.ndarray]:
    """
    For the matching module: (keys, names, matrix n×384), in the user's skill
    order. Empty result when the user has no record. Raises EmbeddingsPending
    when the vectors are not all available for the current model yet.
    """
    model = model or get_embedder().model_name
    record = await get_user_skill_record(user_id, db)
    if not record:
        return [], [], np.zeros((0, DIMENSION), dtype=np.float32)
    if record.get("embedding_status") != DONE or record.get("model") != model:
        raise EmbeddingsPending(f"Skill vectors for user {user_id} are still being created")
    keys = [s["key"] for s in record["skills"]]
    vectors = await load_vectors(keys, model, db)
    missing = [k for k in keys if k not in vectors]
    if missing:
        raise EmbeddingsPending(f"{len(missing)} skill vectors for user {user_id} are not stored yet")
    return keys, [s["name"] for s in record["skills"]], np.stack([vectors[k] for k in keys])


# ── Parse-time embeddings (FE-4) ─────────────────────────────────────────────
async def embed_parse_record(user_id: str, file_name: str, names: List[str], embedder=None, db=None) -> str:
    """Embed a parse record's skills; never raises. → final embedding_status."""
    embedder = embedder or get_embedder()
    db = db if db is not None else get_database()
    if not embedder.ready:
        return PENDING
    try:
        await get_skill_vectors(names, embedder, db)
        status = DONE
    except ModelNotReady:
        return PENDING
    except Exception as exc:  # noqa: BLE001
        status = FAILED
        _warn("EMBEDDING_FAILED", f"Embedding parsed CV skills for user {user_id} failed: {type(exc).__name__}")
    try:
        await db["cv_parsed_data"].update_one(
            {"user_id": user_id, "file_name": file_name, "embedding_status": PENDING},
            {"$set": {"embedding_status": status, "embedding_model": embedder.model_name}},
        )
    except Exception as exc:  # noqa: BLE001
        _warn("EMBEDDING_STATUS_WRITE_FAILED", f"Could not record embedding status for user {user_id}: {type(exc).__name__}")
    return status


_background: set = set()


def schedule_parse_embedding(user_id: str, file_name: str, names: List[str], db=None) -> None:
    """Fire-and-forget: the parse response never waits for embeddings."""
    task = asyncio.get_running_loop().create_task(embed_parse_record(user_id, file_name, names, db=db))
    _background.add(task)
    task.add_done_callback(_background.discard)


async def wait_for_background() -> None:
    """Tests: wait for scheduled parse embeddings."""
    while _background:
        await asyncio.gather(*list(_background), return_exceptions=True)


# ── Worker: completes pending work once the model is ready ───────────────────
async def process_pending(embedder=None, db=None) -> dict:
    embedder = embedder or get_embedder()
    db = db if db is not None else get_database()
    done = {"parses": 0, "users": 0}
    if db is None or not embedder.ready:
        return done
    async for record in db["cv_parsed_data"].find({"embedding_status": PENDING}, {"user_id": 1, "file_name": 1, "skills_canonical": 1}):
        status = await embed_parse_record(record["user_id"], record.get("file_name"), record.get("skills_canonical") or [], embedder, db)
        done["parses"] += status == DONE
    query = {"$or": [{"embedding_status": PENDING}, {"model": {"$ne": embedder.model_name}}]}
    async for record in db[USER_SKILL_PROFILES].find(query, {"user_id": 1}):
        user_id = record["user_id"]
        async with _lock(user_id):
            current = await db[USER_SKILL_PROFILES].find_one({"user_id": user_id})
            if not current:
                continue
            try:
                await get_skill_vectors([s["name"] for s in current["skills"]], embedder, db)
            except Exception as exc:  # noqa: BLE001
                _warn("EMBEDDING_FAILED", f"Completing embeddings for user {user_id} failed: {type(exc).__name__}")
                continue
            await db[USER_SKILL_PROFILES].update_one(
                {"user_id": user_id, "skills_hash": current["skills_hash"]},
                {"$set": {"embedding_status": DONE, "model": embedder.model_name, "updated_at": datetime.now(timezone.utc)}},
            )
            done["users"] += 1
    return done


async def run_worker(ready_event: Optional[asyncio.Event] = None, interval: float = 30) -> None:
    """Background loop: runs as soon as the model is ready, then every `interval` seconds."""
    if ready_event is not None:
        await ready_event.wait()
    while True:
        try:
            result = await process_pending()
            if result["parses"] or result["users"]:
                logger.info("Embedding worker completed %s", result)
        except Exception as exc:  # noqa: BLE001
            _warn("EMBEDDING_WORKER_FAILED", f"Embedding worker pass failed: {type(exc).__name__}")
        await asyncio.sleep(interval)


def _warn(error_type: str, message: str) -> None:
    from app.services.error_logger import log_error

    logger.warning(message)
    log_error(level="warning", module="embeddings", error_type=error_type, message=message, dedupe_key=error_type, dedupe_seconds=60)
