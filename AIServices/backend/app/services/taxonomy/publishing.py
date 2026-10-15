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
       credit rates
  any failure after the snapshot restores it automatically → rolled_back.

restore: lock → snapshot of the current state ("pre-restore", so a restore can be
undone) → whole-state restore → post-restore checks.

recovery: a job left in "publishing" by a crash (its lock expired, or held by nobody)
is restored from its snapshot → rolled_back; without a snapshot nothing live was
changed → failed. Runs at startup and every TAXONOMY_RECOVERY_INTERVAL_SECONDS.
"""

import asyncio
import logging
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
async def post_checks(db) -> dict:
    index = get_role_index()
    professions = await active_professions(db)
    expected = state_hash(professions, get_embedder().model_name, text_mode())
    actual = index.snapshot.meta.get("state_hash") if index.snapshot else None
    checks = await pipeline.run_checks(db, PROFESSIONS, ESCO_SKILLS, None)
    return {
        "state_hash_ok": bool(professions) and actual == expected or (not professions and index.snapshot is None),
        "state_hash": actual,
        "index": index.health(),
        "fingerprint": await pipeline.live_fingerprint(db),
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
    lock = await TaxonomyLock(f"{owner_prefix}:{job_id}", job_id, db).acquire()
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
        await jobs.set_progress(job_id, "Rebuilding the role-skill index", db=db)
        index = get_role_index()
        await index.rebuild(db)
        if index.state != READY:
            raise PublishCheckFailed(f"The role-skill index could not be rebuilt ({index.state})")
        await jobs.set_progress(job_id, "Running the post-publish checks", db=db)
        post = await post_checks(db)
        if not post["state_hash_ok"]:
            raise PublishCheckFailed("The rebuilt index does not match the published data (state_hash)")
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


# ── restore ───────────────────────────────────────────────────────────────────
async def restore(snapshot_id: str, actor: str = "unknown", db=None) -> dict:
    """Whole-state restore of a kept snapshot (after snapshotting the current state)."""
    db = db if db is not None else get_database()
    record = await snapshots.get_snapshot(snapshot_id, db)
    lock = await TaxonomyLock(f"restore:{snapshot_id}", None, db).acquire()
    try:
        before = await snapshots.create_snapshot(db, created_by=actor, reason="pre-restore")
        restored = await snapshots.restore_files(db, record)
        post = await post_checks(db)
        await db[snapshots.SNAPSHOTS].update_one(
            {"snapshot_id": snapshot_id},
            {"$push": {"restores": {"at": datetime.now(timezone.utc), "by": actor,
                                    "pre_restore_snapshot": before["snapshot_id"]}}})
        return {"snapshot_id": snapshot_id, "pre_restore_snapshot": before["snapshot_id"], "restore": restored,
                "post_restore_checks": post}
    finally:
        await lock.release()


# ── crash recovery ────────────────────────────────────────────────────────────
async def recover_publishing_job(job: dict, db) -> Optional[str]:
    """Restore a job left in "publishing" by a crash. Skips it while its lock is still held
    (the publisher may be alive in another process, e.g. the CLI). → the new status or None."""
    job_id = job["job_id"]
    try:
        lock = await TaxonomyLock(f"recovery:{job_id}", job_id, db).acquire()
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
