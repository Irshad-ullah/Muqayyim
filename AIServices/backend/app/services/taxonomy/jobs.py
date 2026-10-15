"""
Taxonomy import jobs (09c, Module 10 FE-4 / FR12.5): ai_db.import_jobs.

  { job_id, source ('onet' | 'esco'), dataset_version ("O*NET 31.0", "ESCO v1.2.1"),
    status, created_by (admin user id, or "cli"), created_at, updated_at,
    file_summary, validation_errors, diff_summary, checks, snapshot_id,
    post_publish_checks, background_acknowledged, progress {step, message},
    error, events [{at, from, to, note}] }

Lifecycle (every change is one atomic find_one_and_update guarded by the current
status, so two requests can never move the same job twice):

  uploaded → validating → validated | failed
  validated → previewing → previewed | failed
  previewed → publishing → published | failed | rolled_back
  uploaded | validated | previewed → cancelled

`run_in_background()` runs a step as an asyncio task; an exception marks the job
failed with a short, content-free message.
"""

import asyncio
import logging
import uuid
from datetime import datetime, timezone
from typing import Awaitable, Callable, Dict, Iterable, Optional

from pymongo import ASCENDING, DESCENDING, ReturnDocument

from app.config.database import get_database

logger = logging.getLogger(__name__)

JOBS = "import_jobs"
SOURCES = ("onet", "esco")

UPLOADED, VALIDATING, VALIDATED = "uploaded", "validating", "validated"
PREVIEWING, PREVIEWED = "previewing", "previewed"
PUBLISHING, PUBLISHED = "publishing", "published"
FAILED, ROLLED_BACK, CANCELLED = "failed", "rolled_back", "cancelled"
STATUSES = (UPLOADED, VALIDATING, VALIDATED, PREVIEWING, PREVIEWED, PUBLISHING, PUBLISHED, FAILED, ROLLED_BACK, CANCELLED)

TRANSITIONS: Dict[str, tuple] = {
    UPLOADED: (VALIDATING, CANCELLED),
    VALIDATING: (VALIDATED, FAILED),
    VALIDATED: (PREVIEWING, CANCELLED),
    PREVIEWING: (PREVIEWED, FAILED),
    PREVIEWED: (PUBLISHING, CANCELLED, PREVIEWING),  # re-preview after the live data changed
    PUBLISHING: (PUBLISHED, FAILED, ROLLED_BACK),
    PUBLISHED: (),
    FAILED: (),
    ROLLED_BACK: (),
    CANCELLED: (),
}
RUNNING = (VALIDATING, PREVIEWING, PUBLISHING)
INTERNAL_FIELDS = ("_id", "staging_dir")  # never sent to clients
FINAL = (PUBLISHED, FAILED, ROLLED_BACK, CANCELLED)


class JobNotFound(Exception):
    pass


class JobStateError(Exception):
    """The job is not in a status that allows this action (HTTP 409 JOB_STATE)."""

    def __init__(self, job_id: str, status: Optional[str], wanted: str):
        self.status = status
        super().__init__(f"Job {job_id} is {status or 'unknown'}; cannot move to {wanted}")


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _coll(db=None):
    db = db if db is not None else get_database()
    return db[JOBS]


async def ensure_job_indexes(db) -> None:
    await db[JOBS].create_index([("job_id", ASCENDING)], unique=True, name="job_id_unique")
    await db[JOBS].create_index([("created_at", DESCENDING)], name="created_at")
    await db[JOBS].create_index([("status", ASCENDING)], name="status")


def public(job: Optional[dict]) -> Optional[dict]:
    if not job:
        return None

    def clean(value):
        if isinstance(value, datetime):
            return (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).isoformat()
        if isinstance(value, dict):
            return {k: clean(v) for k, v in value.items()}
        if isinstance(value, list):
            return [clean(v) for v in value]
        return value

    return clean({k: v for k, v in job.items() if k not in INTERNAL_FIELDS})


async def create_job(source: str, dataset_version: str, created_by: str, file_summary: Optional[dict] = None,
                     db=None, job_id: Optional[str] = None) -> dict:
    if source not in SOURCES:
        raise ValueError(f"source must be one of {SOURCES}")
    now = _now()
    job = {
        "job_id": job_id or uuid.uuid4().hex,
        "source": source,
        "dataset_version": dataset_version,
        "status": UPLOADED,
        "created_by": created_by,
        "created_at": now,
        "updated_at": now,
        "file_summary": file_summary or {},
        "validation_errors": [],
        "diff_summary": None,
        "checks": None,
        "snapshot_id": None,
        "post_publish_checks": None,
        "background_acknowledged": False,
        "progress": {"step": UPLOADED, "message": "Files received"},
        "error": None,
        "events": [{"at": now, "from": None, "to": UPLOADED, "note": None}],
    }
    await _coll(db).insert_one(dict(job))
    return job


async def get_job(job_id: str, db=None) -> dict:
    job = await _coll(db).find_one({"job_id": job_id})
    if not job:
        raise JobNotFound(job_id)
    return job


async def list_jobs(page: int = 1, limit: int = 20, status: Optional[str] = None, source: Optional[str] = None,
                    db=None) -> dict:
    query = {}
    if status:
        query["status"] = status
    if source:
        query["source"] = source
    coll = _coll(db)
    total = await coll.count_documents(query)
    projection = {"_id": 0, "events": 0}
    cursor = coll.find(query, projection).sort("created_at", -1).skip((page - 1) * limit).limit(limit)
    return {"items": [public(j) async for j in cursor], "total": total, "page": page, "limit": limit,
            "pages": (total + limit - 1) // limit if limit else 0}


async def transition(job_id: str, to: str, *, note: Optional[str] = None, db=None, **fields) -> dict:
    """Move the job to `to` if its current status allows it (atomic), setting `fields`."""
    if to not in STATUSES:
        raise ValueError(f"unknown status {to!r}")
    allowed_from = [s for s, nexts in TRANSITIONS.items() if to in nexts]
    now = _now()
    updated = await _coll(db).find_one_and_update(
        {"job_id": job_id, "status": {"$in": allowed_from}},
        {"$set": {"status": to, "updated_at": now, "progress": {"step": to, "message": note}, **fields},
         "$push": {"events": {"at": now, "to": to, "note": note}}},
        return_document=ReturnDocument.AFTER,
    )
    if updated is None:
        current = await _coll(db).find_one({"job_id": job_id}, {"status": 1})
        if current is None:
            raise JobNotFound(job_id)
        raise JobStateError(job_id, current.get("status"), to)
    return updated


async def update_job(job_id: str, db=None, **fields) -> None:
    """Set fields without changing the status (progress messages, results)."""
    await _coll(db).update_one({"job_id": job_id}, {"$set": {**fields, "updated_at": _now()}})


async def set_progress(job_id: str, message: str, db=None) -> None:
    job = await _coll(db).find_one({"job_id": job_id}, {"status": 1})
    if job:
        await update_job(job_id, db, progress={"step": job["status"], "message": message})


def safe_error(exc: BaseException) -> str:
    """A short message for the job record: never file contents or secrets."""
    from app.services.professions.csv_io import DatasetError
    from app.services.taxonomy.lock import TaxonomyBusy

    if isinstance(exc, (DatasetError, TaxonomyBusy, JobStateError)) or getattr(exc, "safe_message", None):
        return (getattr(exc, "safe_message", None) or str(exc))[:500]
    return f"{type(exc).__name__} (details in the service error log)"


# ── background runner ─────────────────────────────────────────────────────────
_tasks: set = set()


def run_in_background(job_id: str, step: Callable[[], Awaitable[None]], *, failed_status: str = FAILED,
                      db=None) -> asyncio.Task:
    """Run `step` as a task; on an exception mark the job `failed_status` with a safe message."""

    async def runner():
        try:
            await step()
        except Exception as exc:  # noqa: BLE001
            from app.services.error_logger import log_error

            message = safe_error(exc)
            log_error(level="error", module="taxonomy", exc=exc, error_type="TAXONOMY_JOB_FAILED",
                      message=f"Taxonomy job {job_id} failed: {type(exc).__name__}")
            try:
                await transition(job_id, failed_status, note=message, db=db, error=message)
            except (JobStateError, JobNotFound):
                await update_job(job_id, db, error=message)

    task = asyncio.get_running_loop().create_task(runner())
    _tasks.add(task)
    task.add_done_callback(_tasks.discard)
    return task


async def wait_for_background() -> None:
    """Tests / shutdown: wait until every background job step has finished."""
    while _tasks:
        await asyncio.gather(*list(_tasks), return_exceptions=True)


# ── startup recovery ──────────────────────────────────────────────────────────
INTERRUPTED = "Interrupted by a service restart"


async def recover_interrupted_jobs(db=None, publishing_handler: Optional[Callable[[dict], Awaitable[None]]] = None
                                   ) -> Dict[str, int]:
    """
    At startup no job step can still be running in this process. Jobs left in
    validating / previewing are marked failed. Jobs left in publishing are handed to
    `publishing_handler` (Part 4: restore the snapshot → rolled_back); without a
    handler they are marked failed.
    """
    counts = {"failed": 0, "publishing": 0}
    async for job in _coll(db).find({"status": {"$in": list(RUNNING)}}, {"job_id": 1, "status": 1}):
        if job["status"] == PUBLISHING and publishing_handler is not None:
            await publishing_handler(job)
            counts["publishing"] += 1
            continue
        try:
            await transition(job["job_id"], FAILED, note=INTERRUPTED, db=db, error=INTERRUPTED)
            counts["failed"] += 1
        except JobStateError:
            pass
    return counts


def statuses_from(names: Iterable[str]) -> list:
    return [s for s in names if s in STATUSES]
