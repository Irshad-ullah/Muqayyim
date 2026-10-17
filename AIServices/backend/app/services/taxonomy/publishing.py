"""
Publish, restore and crash recovery (09c Part 4).

publish (previewed → publishing → published | rolled_back | failed):
  checked before answering:  the job is previewed; a failed background check was
                             acknowledged; the live data has not changed since the
                             preview (fingerprint); the taxonomy lock is free (409)
  then, in the background, holding the lock (renewed by its heartbeat):
    1. snapshot the whole live state (publish pool)
    2. swap the staged collections in (renameCollection, professions then esco_skills)
    3. rebuild the role-skill index (atomic file swap; embeds new skills with the
       frozen pipeline)
    4. post-publish checks: index state_hash matches the data, coverage, background
       credit rates, and the ESCO requirement groups (Module 5.1) equal the preview's
       staged count — an unexpected drop fails the publish (→ rolled_back)
  any failure after the snapshot restores it automatically → rolled_back.

restore (202 + polling; ai_db.restore_jobs: restoring → restored | rolled_back | failed):
lock → snapshot of the current state ("pre-restore", so a restore can be undone) →
whole-state restore → post-restore checks. A failure part-way puts the pre-restore
snapshot back (rolled_back); a crashed restore is recovered the same way.

recovery: a job left in "publishing" by a crash (its lock expired, or held by nobody)
is restored from its snapshot → rolled_back; without a snapshot nothing live was
changed → failed. Runs at startup and every TAXONOMY_RECOVERY_INTERVAL_SECONDS.
"""

import asyncio
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.config.database import get_database
from app.config.settings import settings
from app.services.embeddings.descriptions import text_mode
from app.services.embeddings.model import get_embedder
from app.services.professions.role_index import READY, get_role_index, state_hash
from app.services.professions.role_skills import active_professions
from app.services.professions.store import ESCO_SKILLS, PROFESSIONS
from app.services.taxonomy import jobs, pipeline, snapshots
from app.services.taxonomy.lock import TaxonomyBusy, TaxonomyLock

logger = logging.getLogger(__name__)


class PublishRefused(Exception):
    def __init__(self, status: int, code: str, message: str):
        self.status, self.code, self.safe_message = status, code, message
        super().__init__(message)


class PublishCheckFailed(Exception):
    def __init__(self, message: str):
        self.safe_message = message
        super().__init__(message)


# ── checks after publish / restore ───────────────────────────────────────────
async def post_checks(db, expected_role_map: Optional[int] = None) -> dict:
    """`expected_role_map`: the number of ESCO requirement groups the live data must have (the preview's staged
    count after a publish, the snapshot's count after a restore); None = not checked."""
    index = get_role_index()
    role_map_actual = await snapshots.role_map_adjusted(db)
    professions = await active_professions(db)
    expected = state_hash(professions, get_embedder().model_name, text_mode())
    actual = index.snapshot.meta.get("state_hash") if index.snapshot else None
    checks = await pipeline.run_checks(db, PROFESSIONS, ESCO_SKILLS, None)
    return {
        "state_hash_ok": bool(professions) and actual == expected or (not professions and index.snapshot is None),
        "state_hash": actual,
        "index": index.health(),
        "fingerprint": await pipeline.live_fingerprint(db),
        "role_map": {"adjusted": role_map_actual, "expected": expected_role_map,
                     "ok": expected_role_map is None or role_map_actual == expected_role_map},
        **checks,
    }


# ── publish ───────────────────────────────────────────────────────────────────
async def start_publish(job_id: str, acknowledge: bool = False, actor: str = "unknown", db=None,
                        owner_prefix: str = "job", wait: bool = False) -> dict:
    """Validate the request now (raising JobStateError / PublishRefused / TaxonomyBusy),
    then publish in the background (or inline with wait=True, for the CLI)."""
    db = db if db is not None else get_database()
    job = await jobs.get_job(job_id, db)
    if job["status"] != jobs.PREVIEWED:
        raise jobs.JobStateError(job_id, job["status"], jobs.PUBLISHING)
    if (job.get("checks") or {}).get("background_warning") and not acknowledge:
        raise PublishRefused(422, "BACKGROUND_ACK_REQUIRED",
                             "The background credit check did not pass on the staged data. "
                             "Confirm that you understand before publishing.")
    lock = await TaxonomyLock(f"{owner_prefix}:{job_id}", job_id, db, actor=actor).acquire()
    try:
        # Checked under the lock, so nothing can change the live data between this check and the swap.
        if await pipeline.live_fingerprint(db) != job.get("preview_base"):
            raise PublishRefused(409, "LIVE_DATA_CHANGED",
                                 "The live data changed after this preview. Run the preview again before publishing.")
        job = await jobs.transition(job_id, jobs.PUBLISHING, note="Publishing", db=db,
                                    background_acknowledged=bool(acknowledge), published_by=actor)
    except BaseException:
        await lock.release()
        raise
    if wait:
        await _publish(job, lock, actor, db)
        return await jobs.get_job(job_id, db)
    jobs.run_in_background(job_id, lambda: _publish(job, lock, actor, db), db=db)
    return job


async def _publish(job: dict, lock: TaxonomyLock, actor: str, db) -> None:
    job_id = job["job_id"]
    snapshot = None
    try:
        await jobs.set_progress(job_id, "Taking a snapshot of the live data", db=db)
        snapshot = await snapshots.create_snapshot(db, created_by=actor, reason="publish", job_id=job_id)
        await jobs.update_job(job_id, db, snapshot_id=snapshot["snapshot_id"])
        if lock.lost:
            raise PublishCheckFailed("The taxonomy lock was lost; nothing was published")
        await jobs.set_progress(job_id, "Swapping the new data in", db=db)
        await snapshots.swap_in(db, pipeline.staging_names(job_id))
        if job["source"] == "curated" and job.get("kind", "import") == "import":
            await asyncio.to_thread(snapshots.store_curated_dataset, job.get("staging_dir"))
        await jobs.set_progress(job_id, "Rebuilding the role-skill index", db=db)
        index = get_role_index()
        await index.rebuild(db)
        if index.state != READY:
            raise PublishCheckFailed(f"The role-skill index could not be rebuilt ({index.state})")
        await jobs.set_progress(job_id, "Running the post-publish checks", db=db)
        expected = ((job.get("diff_summary") or {}).get("role_map") or {}).get("staged_adjusted")
        post = await post_checks(db, expected_role_map=expected)
        if not post["state_hash_ok"]:
            raise PublishCheckFailed("The rebuilt index does not match the published data (state_hash)")
        if not post["role_map"]["ok"]:
            raise PublishCheckFailed(f"ESCO requirement groups: {post['role_map']['adjusted']} live, "
                                     f"{expected} expected from the preview")
        await jobs.transition(job_id, jobs.PUBLISHED, note="Published", db=db, post_publish_checks=post)
        _finish_files(job)
        await jobs.update_job(job_id, db, staging_dir=None)
    except Exception as exc:  # noqa: BLE001 — every failure ends in rolled_back or failed
        await _roll_back(job, snapshot, exc, db)
    finally:
        await lock.release()


def _finish_files(job: dict) -> None:
    from app.services.taxonomy.uploads import remove_staging

    remove_staging(job.get("staging_dir"))


async def _roll_back(job: dict, snapshot: Optional[dict], exc: BaseException, db) -> None:
    from app.services.error_logger import log_error

    job_id = job["job_id"]
    reason = jobs.safe_error(exc)
    log_error(level="error", module="taxonomy", exc=exc, error_type="TAXONOMY_PUBLISH_FAILED",
              message=f"Publishing job {job_id} failed: {type(exc).__name__}")
    if snapshot is None:  # nothing live was changed
        await pipeline.drop_staging(db, job_id)
        _finish_files(job)
        await jobs.transition(job_id, jobs.FAILED, note=reason, db=db, error=reason, staging_dir=None)
        return
    try:
        await jobs.set_progress(job_id, "Publish failed; restoring the snapshot", db=db)
        restored = await snapshots.restore_files(db, snapshot)
        post = await post_checks(db)
        await pipeline.drop_staging(db, job_id)
        _finish_files(job)
        await jobs.transition(job_id, jobs.ROLLED_BACK, note=f"Restored snapshot {snapshot['snapshot_id']}", db=db,
                              error=reason, post_publish_checks={**post, "restore": restored}, staging_dir=None)
    except Exception as restore_exc:  # noqa: BLE001
        message = f"{reason}; restoring snapshot {snapshot['snapshot_id']} also failed: {jobs.safe_error(restore_exc)}"
        log_error(level="critical", module="taxonomy", exc=restore_exc, error_type="TAXONOMY_ROLLBACK_FAILED",
                  message=f"Rollback of job {job_id} failed: {type(restore_exc).__name__}")
        await jobs.transition(job_id, jobs.FAILED, note=message, db=db, error=message)


# ── restore (202 + polling, like publish) ────────────────────────────────────
RESTORES = "restore_jobs"
RESTORING, RESTORED = "restoring", "restored"
RESTORE_FAILED, RESTORE_ROLLED_BACK = "failed", "rolled_back"


async def ensure_restore_indexes(db) -> None:
    await db[RESTORES].create_index("restore_id", unique=True, name="restore_id_unique")
    await db[RESTORES].create_index([("created_at", -1)], name="created_at")
    await db[RESTORES].create_index("status", name="status")


async def _set_restore(db, restore_id: str, **fields) -> None:
    await db[RESTORES].update_one({"restore_id": restore_id},
                                  {"$set": {**fields, "updated_at": datetime.now(timezone.utc)}})


async def get_restore(restore_id: str, db=None) -> Optional[dict]:
    db = db if db is not None else get_database()
    return await db[RESTORES].find_one({"restore_id": restore_id})


async def list_restores(db=None, limit: int = 50) -> list:
    db = db if db is not None else get_database()
    return [jobs.public(r) async for r in db[RESTORES].find({}).sort("created_at", -1).limit(limit)]


async def start_restore(snapshot_id: str, actor: str = "unknown", db=None, wait: bool = False) -> dict:
    """Check now (SnapshotNotFound / TaxonomyBusy), then restore in the background.
    → the restore record (status restoring; poll GET /restores/{restore_id})."""
    db = db if db is not None else get_database()
    record = await snapshots.get_snapshot(snapshot_id, db)
    restore_id = uuid.uuid4().hex
    lock = await TaxonomyLock(f"restore:{restore_id}", None, db, actor=actor).acquire()
    now = datetime.now(timezone.utc)
    doc = {"restore_id": restore_id, "snapshot_id": snapshot_id, "status": RESTORING, "created_by": actor,
           "created_at": now, "updated_at": now, "pre_restore_snapshot": None, "progress": "Starting",
           "result": None, "error": None}
    try:
        await db[RESTORES].insert_one(dict(doc))
    except BaseException:
        await lock.release()
        raise
    if wait:
        await _restore(doc, record, lock, actor, db)
    else:
        jobs.spawn(lambda: _restore(doc, record, lock, actor, db))
    return await get_restore(restore_id, db)


async def _restore(doc: dict, record: dict, lock: TaxonomyLock, actor: str, db) -> None:
    restore_id = doc["restore_id"]
    before = None
    try:
        await _set_restore(db, restore_id, progress="Verifying the snapshot files")
        await snapshots.check_files(record)  # a damaged snapshot fails here, before anything changes
        await _set_restore(db, restore_id, progress="Taking a snapshot of the current state")
        before = await snapshots.create_snapshot(db, created_by=actor, reason="pre-restore")
        await _set_restore(db, restore_id, pre_restore_snapshot=before["snapshot_id"],
                           progress=f"Restoring snapshot {record['snapshot_id']}")
        restored = await snapshots.restore_files(db, record)
        await _set_restore(db, restore_id, progress="Running the post-restore checks")
        post = await post_checks(db, expected_role_map=(record.get("counts") or {}).get("role_map_adjusted"))
        if not post["role_map"]["ok"]:
            raise PublishCheckFailed(f"ESCO requirement groups: {post['role_map']['adjusted']} after the restore, "
                                     f"{post['role_map']['expected']} in the snapshot")
        await _set_restore(db, restore_id, status=RESTORED, progress="Restored",
                           result={"restore": restored, "post_restore_checks": post})
        await db[snapshots.SNAPSHOTS].update_one(
            {"snapshot_id": record["snapshot_id"]},
            {"$push": {"restores": {"at": datetime.now(timezone.utc), "by": actor, "restore_id": restore_id,
                                    "pre_restore_snapshot": before["snapshot_id"]}}})
    except Exception as exc:  # noqa: BLE001
        await _restore_failed(db, restore_id, before, exc)
    finally:
        await lock.release()


async def _restore_failed(db, restore_id: str, before: Optional[dict], exc: BaseException) -> None:
    """Put the pre-restore state back when a restore failed part-way."""
    from app.services.error_logger import log_error

    reason = jobs.safe_error(exc)
    log_error(level="error", module="taxonomy", exc=exc, error_type="TAXONOMY_RESTORE_FAILED",
              message=f"Restore {restore_id} failed: {type(exc).__name__}")
    if before is None:  # nothing was changed
        await _set_restore(db, restore_id, status=RESTORE_FAILED, progress="Failed", error=reason)
        return
    try:
        rolled = await snapshots.restore_files(db, before)
        post = await post_checks(db)
        await _set_restore(db, restore_id, status=RESTORE_ROLLED_BACK, error=reason,
                           progress=f"Failed; put back the pre-restore snapshot {before['snapshot_id']}",
                           result={"restore": rolled, "post_restore_checks": post})
    except Exception as again:  # noqa: BLE001
        message = f"{reason}; putting back {before['snapshot_id']} also failed: {jobs.safe_error(again)}"
        log_error(level="critical", module="taxonomy", exc=again, error_type="TAXONOMY_ROLLBACK_FAILED",
                  message=f"Rollback of restore {restore_id} failed: {type(again).__name__}")
        await _set_restore(db, restore_id, status=RESTORE_FAILED, progress="Failed", error=message)


async def restore(snapshot_id: str, actor: str = "unknown", db=None) -> dict:
    """Synchronous restore (tests, tools) → the finished restore record."""
    return await start_restore(snapshot_id, actor, db, wait=True)


async def recover_restore(doc: dict, db) -> Optional[str]:
    """A restore left in "restoring" by a crash: put its pre-restore snapshot back."""
    restore_id = doc["restore_id"]
    try:
        lock = await TaxonomyLock(f"recovery:restore:{restore_id}", None, db, actor="system").acquire()
    except TaxonomyBusy:
        return None
    try:
        doc = await get_restore(restore_id, db)
        if not doc or doc["status"] != RESTORING:
            return None
        before = (await snapshots.get_snapshot(doc["pre_restore_snapshot"], db)
                  if doc.get("pre_restore_snapshot") else None)
        await _restore_failed(db, restore_id, before, RuntimeError("Interrupted by a service restart"))
        return (await get_restore(restore_id, db))["status"]
    finally:
        await lock.release()


# ── crash recovery ────────────────────────────────────────────────────────────
async def recover_publishing_job(job: dict, db) -> Optional[str]:
    """Restore a job left in "publishing" by a crash. Skips it while its lock is still held
    (the publisher may be alive in another process, e.g. the CLI). → the new status or None."""
    job_id = job["job_id"]
    try:
        lock = await TaxonomyLock(f"recovery:{job_id}", job_id, db, actor="system").acquire()
    except TaxonomyBusy:
        return None
    try:
        job = await jobs.get_job(job_id, db)
        if job["status"] != jobs.PUBLISHING:
            return None
        if not job.get("snapshot_id"):
            await pipeline.drop_staging(db, job_id)
            _finish_files(job)
            note = "Interrupted before the live data was changed"
            await jobs.transition(job_id, jobs.FAILED, note=note, db=db, error=note, staging_dir=None)
            return jobs.FAILED
        record = await snapshots.get_snapshot(job["snapshot_id"], db)
        restored = await snapshots.restore_files(db, record)
        post = await post_checks(db)
        await pipeline.drop_staging(db, job_id)
        _finish_files(job)
        note = f"Interrupted during publish; restored snapshot {record['snapshot_id']}"
        await jobs.transition(job_id, jobs.ROLLED_BACK, note=note, db=db, error=note,
                              post_publish_checks={**post, "restore": restored}, staging_dir=None)
        logger.warning("Recovered interrupted publish %s from snapshot %s", job_id, record["snapshot_id"])
        return jobs.ROLLED_BACK
    finally:
        await lock.release()


async def recover(db=None, at_startup: bool = False) -> dict:
    """Publishing jobs → recover_publishing_job. At startup also: this process's own
    validating / previewing jobs → failed (CLI jobs only once they are stale)."""
    db = db if db is not None else get_database()
    counts = {"rolled_back": 0, "failed": 0, "skipped": 0}
    async for doc in db[RESTORES].find({"status": RESTORING}):
        outcome = await recover_restore(doc, db)
        counts[{RESTORE_ROLLED_BACK: "rolled_back", RESTORE_FAILED: "failed"}.get(outcome, "skipped")] += 1
    stale = datetime.now(timezone.utc) - timedelta(seconds=2 * settings.TAXONOMY_LOCK_TTL_SECONDS)
    query = {"status": {"$in": list(jobs.RUNNING) if at_startup else [jobs.PUBLISHING]}}
    async for job in db[jobs.JOBS].find(query):
        if job["status"] == jobs.PUBLISHING:
            outcome = await recover_publishing_job(job, db)
            counts[{jobs.ROLLED_BACK: "rolled_back", jobs.FAILED: "failed"}.get(outcome, "skipped")] += 1
            continue
        updated = job["updated_at"] if job["updated_at"].tzinfo else job["updated_at"].replace(tzinfo=timezone.utc)
        if job.get("created_by") == "cli" and updated > stale:
            counts["skipped"] += 1  # a CLI preview may be running in another process
            continue
        try:
            await jobs.transition(job["job_id"], jobs.FAILED, note=jobs.INTERRUPTED, db=db, error=jobs.INTERRUPTED)
            counts["failed"] += 1
        except jobs.JobStateError:
            pass
    return counts


async def run_recovery(db=None, interval: Optional[float] = None) -> None:
    interval = interval or settings.TAXONOMY_RECOVERY_INTERVAL_SECONDS
    while True:
        await asyncio.sleep(interval)
        try:
            await recover(db)
        except Exception as exc:  # noqa: BLE001 — retried next round
            logger.error("Taxonomy recovery failed: %s", type(exc).__name__)
