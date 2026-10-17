#!/usr/bin/env python
"""
Retire ESCO (Module 5.2): every ESCO profession becomes inactive with inactive_reason
"retired: replaced by curated modern roles v1", through the taxonomy pipeline — a retirement job is previewed (staged
copy, diff, checks) and published with a snapshot of the live state first, the index rebuild, post-checks and automatic
rollback. ai_db.esco_skills, the ESCO import code and the ESCO role map stay, dormant.

Re-enabling ESCO = restoring the snapshot this job takes before the retirement (printed at the end; admin History tab →
Restore, or POST /internal/admin/taxonomy/snapshots/{id}/restore).

Usage (repo root, AIServices venv):
  AIServices/backend/venv/Scripts/python AIServices/scripts/retire_esco.py [--dry-run] [--actor NAME] [--i-understand-background-check]
"""

import argparse
import asyncio
import json
import sys

from _profession_cli import load_model  # noqa: F401  (sets the backend path and cwd)
from motor.motor_asyncio import AsyncIOMotorClient

from app.config import database as database_module
from app.config.settings import settings
from app.services.taxonomy import jobs, pipeline, publishing, uploads
from app.services.taxonomy.pipeline import ensure_diff_indexes
from app.services.taxonomy.retirement import RetirementRefused, create_retirement_job
from app.services.taxonomy.snapshots import ensure_snapshot_indexes


async def run(args) -> int:
    client = AsyncIOMotorClient(settings.MONGODB_URL)
    db = client[settings.AI_DB_NAME]
    database_module.database = db
    try:
        for setup in (jobs.ensure_job_indexes, ensure_diff_indexes, ensure_snapshot_indexes):
            await setup(db)
        await load_model(db)
        try:
            job = await create_retirement_job("esco", args.actor, db)
        except RetirementRefused as exc:
            print("Refused: " + exc.safe_message, file=sys.stderr)
            return 1
        await pipeline.start_preview(job["job_id"], db=db)
        await jobs.wait_for_background()
        job = await jobs.get_job(job["job_id"], db)
        if job["status"] != jobs.PREVIEWED:
            print(f"Preview failed: {job.get('error')}", file=sys.stderr)
            return 1
        if args.dry_run:
            print(json.dumps({k: jobs.public(job).get(k) for k in ("job_id", "status", "diff_summary", "checks")}, indent=2, default=str))
            await uploads.cancel_job(job["job_id"], note="CLI dry run finished", db=db)
            return 0
        if (job.get("checks") or {}).get("background_warning") and not args.i_understand_background_check:
            await uploads.cancel_job(job["job_id"], note="Background check failed; not acknowledged", db=db)
            print("Refused: the background credit check did not pass on the staged data.", file=sys.stderr)
            return 1
        job = await publishing.start_publish(job["job_id"], args.i_understand_background_check, args.actor, db,
                                             owner_prefix="cli", wait=True)
        report = {k: jobs.public(job).get(k) for k in ("job_id", "source", "kind", "status", "snapshot_id", "diff_summary",
                                                       "post_publish_checks", "error")}
        print(json.dumps(report, indent=2, ensure_ascii=False, default=str))
        if job["status"] != jobs.PUBLISHED:
            return 1
        print(f"ESCO retired. To re-enable it, restore snapshot {job['snapshot_id']}.", file=sys.stderr)
        return 0
    finally:
        client.close()


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="preview only; nothing live is written")
    parser.add_argument("--actor", default="cli")
    parser.add_argument("--i-understand-background-check", action="store_true")
    sys.exit(asyncio.run(run(parser.parse_args())))


if __name__ == "__main__":
    main()
