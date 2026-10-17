"""
Retiring an import source (Module 5.2: ESCO, replaced by the curated modern roles).

Retirement is an ordinary taxonomy job (kind "retire") through the same pipeline as an import: preview (staged copy in
which every ESCO profession is inactive with RETIRED_REASON; diff and checks) → publish (snapshot of the live state
first, swap, index rebuild, post-checks, automatic rollback). Nothing is deleted: ai_db.esco_skills, the ESCO import
code and app/data/esco_role_phrase_skill_map.json stay, dormant.

While ESCO is retired, ESCO uploads are refused (409 SOURCE_RETIRED, with the explanation below) and the admin
Data sources tab shows it as retired. **Re-enabling ESCO = restoring the snapshot taken before the retirement** (the
retire job's snapshot, History → Restore): the restore puts the active ESCO professions back, which ends the retired
state.
"""

from typing import Optional

from app.config.database import get_database
from app.services.professions.store import PROFESSIONS
from app.services.taxonomy import jobs

RETIRED_REASON = "retired: replaced by curated modern roles v1"
RETIRABLE = ("esco",)
LABELS = {"esco": "ESCO"}


class RetirementRefused(Exception):
    def __init__(self, message: str):
        self.safe_message = message
        super().__init__(message)


async def source_retired(source: str, db=None) -> bool:
    """True when the source has professions, none active, and they were retired (not just filtered out)."""
    if source not in RETIRABLE:
        return False
    db = db if db is not None else get_database()
    if db is None:
        return False
    if await db[PROFESSIONS].count_documents({"source": source, "active": True}, limit=1):
        return False
    return bool(await db[PROFESSIONS].count_documents({"source": source, "inactive_reason": RETIRED_REASON}, limit=1))


def retired_message(source: str) -> str:
    name = LABELS.get(source, source)
    return (f"{name} is retired: its roles were replaced by the curated modern roles v1 (Module 5.2). Its data is kept "
            f"but dormant, so {name} uploads are disabled. To re-enable {name}, restore the snapshot taken before the "
            "retirement (History tab → Restore).")


async def retirement_snapshot(source: str, db=None) -> Optional[dict]:
    """The latest published retirement job of the source: {job_id, snapshot_id, updated_at} (the snapshot to restore)."""
    db = db if db is not None else get_database()
    job = await db[jobs.JOBS].find_one({"source": source, "kind": "retire", "status": jobs.PUBLISHED}, sort=[("updated_at", -1)])
    return jobs.public({k: job.get(k) for k in ("job_id", "snapshot_id", "updated_at")}) if job else None


async def create_retirement_job(source: str, actor: str, db=None) -> dict:
    """A validated retirement job (no upload; the preview stages the deactivation)."""
    from app.services.taxonomy.uploads import new_staging_dir

    db = db if db is not None else get_database()
    if source not in RETIRABLE:
        raise RetirementRefused(f"{source} cannot be retired")
    if await source_retired(source, db):
        raise RetirementRefused(f"{LABELS[source]} is already retired")
    if not await db[PROFESSIONS].count_documents({"source": source, "active": True}, limit=1):
        raise RetirementRefused(f"{LABELS[source]} has no active professions")
    job = await jobs.create_job(source, f"{LABELS[source]} retirement", actor, db=db, kind="retire")
    await jobs.update_job(job["job_id"], db, staging_dir=str(new_staging_dir()))
    await jobs.transition(job["job_id"], jobs.VALIDATING, note="Retirement: nothing to upload", db=db)
    return await jobs.transition(job["job_id"], jobs.VALIDATED, note=f"Retire {LABELS[source]}: {RETIRED_REASON}", db=db,
                                 validation_errors=[])


async def stage_retirement(db, staging: str, source: str) -> int:
    """In the staged professions collection: every active profession of the source → inactive, RETIRED_REASON."""
    from datetime import datetime, timezone

    result = await db[staging].update_many({"source": source, "active": True},
                                           {"$set": {"active": False, "inactive_reason": RETIRED_REASON,
                                                     "updated_at": datetime.now(timezone.utc)}})
    return result.modified_count
