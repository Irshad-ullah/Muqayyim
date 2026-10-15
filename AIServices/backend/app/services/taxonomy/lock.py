"""
The taxonomy lock (09c): at most one publish, restore or edit changes the live
profession data at a time, across processes (API service and CLI).

ai_db.taxonomy_locks holds one document:
  { _id: "taxonomy", holder (random token), owner (e.g. "job:<id>", "cli"),
    job_id, acquired_at, heartbeat_at, expires_at }

Acquire is one atomic operation: insert when there is no lock, or take over a lock
whose expires_at has passed (its holder died). While held, a heartbeat task renews
expires_at every TAXONOMY_LOCK_HEARTBEAT_SECONDS (TTL TAXONOMY_LOCK_TTL_SECONDS).
Release deletes the lock only if this holder still owns it.
"""

import asyncio
import logging
import secrets
from contextlib import asynccontextmanager
from datetime import datetime, timedelta, timezone
from typing import Optional

from pymongo import ReturnDocument
from pymongo.errors import DuplicateKeyError

from app.config.database import get_database
from app.config.settings import settings

logger = logging.getLogger(__name__)

LOCKS = "taxonomy_locks"
LOCK_ID = "taxonomy"


class TaxonomyBusy(Exception):
    """Another publish, restore or edit holds the lock (HTTP 409 TAXONOMY_BUSY)."""

    def __init__(self, current: Optional[dict] = None):
        self.current = public_lock(current)
        owner = (current or {}).get("owner") or "another operation"
        super().__init__(f"The taxonomy is busy ({owner}). Try again when it has finished.")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _aware(value):
    if isinstance(value, datetime) and value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


def public_lock(doc: Optional[dict]) -> Optional[dict]:
    """The lock without its holder token."""
    if not doc:
        return None
    return {k: (_aware(v).isoformat() if isinstance(v, datetime) else v)
            for k, v in doc.items() if k not in ("_id", "holder")}


class TaxonomyLock:
    def __init__(self, owner: str, job_id: Optional[str] = None, db=None,
                 ttl_seconds: Optional[int] = None, heartbeat_seconds: Optional[float] = None):
        self.owner = owner
        self.job_id = job_id
        self.db = db
        self.ttl = ttl_seconds or settings.TAXONOMY_LOCK_TTL_SECONDS
        self.heartbeat_seconds = heartbeat_seconds or settings.TAXONOMY_LOCK_HEARTBEAT_SECONDS
        self.holder = secrets.token_hex(16)
        self._task: Optional[asyncio.Task] = None
        self.lost = False

    @property
    def coll(self):
        db = self.db if self.db is not None else get_database()
        return db[LOCKS]

    async def acquire(self) -> "TaxonomyLock":
        now = _now()
        fields = {"holder": self.holder, "owner": self.owner, "job_id": self.job_id,
                  "acquired_at": now, "heartbeat_at": now, "expires_at": now + timedelta(seconds=self.ttl)}
        try:
            # Matches only a missing (→ upsert) or expired lock; a live lock makes the
            # upsert collide on _id → DuplicateKeyError → busy.
            await self.coll.find_one_and_update(
                {"_id": LOCK_ID, "expires_at": {"$lt": now}},
                {"$set": fields},
                upsert=True,
                return_document=ReturnDocument.AFTER,
            )
        except DuplicateKeyError:
            raise TaxonomyBusy(await self.coll.find_one({"_id": LOCK_ID}))
        self._task = asyncio.get_running_loop().create_task(self._heartbeat())
        return self

    async def renew(self) -> bool:
        now = _now()
        result = await self.coll.update_one(
            {"_id": LOCK_ID, "holder": self.holder},
            {"$set": {"heartbeat_at": now, "expires_at": now + timedelta(seconds=self.ttl)}},
        )
        if result.matched_count == 0:
            self.lost = True
            logger.error("Taxonomy lock for %s was lost (expired and taken over)", self.owner)
        return result.matched_count == 1

    async def _heartbeat(self) -> None:
        try:
            while True:
                await asyncio.sleep(self.heartbeat_seconds)
                if not await self.renew():
                    return
        except asyncio.CancelledError:
            pass

    async def release(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            self._task = None
        await self.coll.delete_one({"_id": LOCK_ID, "holder": self.holder})


@asynccontextmanager
async def taxonomy_lock(owner: str, job_id: Optional[str] = None, db=None):
    """async with taxonomy_lock("job:<id>", job_id): ... — raises TaxonomyBusy."""
    lock = await TaxonomyLock(owner, job_id, db).acquire()
    try:
        yield lock
    finally:
        await lock.release()


async def current_lock(db=None) -> Optional[dict]:
    """The live lock (None when free or expired), without the holder token."""
    db = db if db is not None else get_database()
    doc = await db[LOCKS].find_one({"_id": LOCK_ID})
    if not doc or _aware(doc.get("expires_at")) < _now():
        return None
    return public_lock(doc)
