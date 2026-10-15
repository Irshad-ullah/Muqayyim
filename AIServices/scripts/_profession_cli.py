"""Shared CLI for scripts/import_onet.py and scripts/import_esco.py (calls the import services)."""

import argparse
import asyncio
import json
import os
import sys
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)  # .env, the model cache and relative data paths resolve from the backend folder

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

from app.config import database as database_module  # noqa: E402
from app.config.settings import settings  # noqa: E402
from app.services.embeddings.model import get_manager  # noqa: E402
from app.services.embeddings.vector_store import ensure_embedding_indexes  # noqa: E402
from app.services.taxonomy import jobs  # noqa: E402
from app.services.taxonomy.cli import BackgroundCheckFailed, preview_from_directory, publish_from_directory  # noqa: E402
from app.services.taxonomy.heartbeat import service_seems_running  # noqa: E402
from app.services.taxonomy.lock import TaxonomyBusy  # noqa: E402
from app.services.taxonomy.publishing import PublishRefused  # noqa: E402
from app.services.taxonomy.snapshots import ensure_snapshot_indexes  # noqa: E402
from app.services.taxonomy.pipeline import ensure_diff_indexes  # noqa: E402
from app.services.taxonomy.uploads import UploadRejected, cancel_job  # noqa: E402


async def load_model(db) -> None:
    manager = get_manager()
    print(f"Loading {manager.model_name} ...", file=sys.stderr)
    started = time.perf_counter()
    await asyncio.to_thread(manager.load_sync)
    manager.ready_event.set()
    print(f"Model ready in {time.perf_counter() - started:.1f}s", file=sys.stderr)
    await ensure_embedding_indexes(db)


async def dry_run(source: str, args, db) -> int:
    """09c: the same job pipeline as an admin upload (created_by "cli"); nothing live is written."""
    await jobs.ensure_job_indexes(db)
    await ensure_diff_indexes(db)
    await load_model(db)  # the preview runs the background credit check
    try:
        job = await preview_from_directory(source, args.data_dir, args.version, db=db, actor=args.actor)
    except UploadRejected as exc:
        print("Upload rejected: " + exc.safe_message, file=sys.stderr)
        return 1
    report = {k: jobs.public(job).get(k) for k in ("job_id", "source", "dataset_version", "status", "created_by",
                                                   "file_summary", "validation_errors", "diff_summary", "checks", "error")}
    print(json.dumps(report, indent=2, ensure_ascii=False, default=str))
    if job["status"] == jobs.PREVIEWED:
        await cancel_job(job["job_id"], note="CLI dry run finished", db=db)  # deletes the staged data
        if (job.get("checks") or {}).get("background_warning"):
            print("WARNING: the background credit check did not pass on the staged data.", file=sys.stderr)
        return 0
    print("Dry run failed: " + "; ".join(job.get("validation_errors") or [job.get("error") or job["status"]]),
          file=sys.stderr)
    return 1


async def run(source: str, args) -> int:
    client = AsyncIOMotorClient(settings.MONGODB_URL)
    db = client[settings.AI_DB_NAME]
    database_module.database = db  # services use the shared database handle
    try:
        if args.dry_run:
            return await dry_run(source, args, db)
        return await publish(source, args, db)
    finally:
        client.close()


async def publish(source: str, args, db) -> int:
    """09c: the same job pipeline as the admin UI: preview, then publish with a snapshot,
    an atomic swap, the index rebuild and the post-publish checks (rolled back on failure)."""
    await jobs.ensure_job_indexes(db)
    await ensure_diff_indexes(db)
    await ensure_snapshot_indexes(db)
    await load_model(db)
    try:
        job = await publish_from_directory(source, args.data_dir, args.version, db=db,
                                           acknowledge=args.i_understand_background_check, actor=args.actor)
    except UploadRejected as exc:
        print("Upload rejected: " + exc.safe_message, file=sys.stderr)
        return 1
    except BackgroundCheckFailed:
        print("Refused: the background credit check did not pass on the staged data. Review the dry run "
              "(--dry-run) and re-run with --i-understand-background-check to publish anyway.", file=sys.stderr)
        return 1
    except (PublishRefused, TaxonomyBusy) as exc:
        print("Refused: " + (getattr(exc, "safe_message", None) or str(exc)), file=sys.stderr)
        return 1
    report = {k: jobs.public(job).get(k) for k in ("job_id", "source", "dataset_version", "status", "created_by",
                                                   "snapshot_id", "validation_errors", "diff_summary",
                                                   "post_publish_checks", "error")}
    print(json.dumps(report, indent=2, ensure_ascii=False, default=str))
    if job["status"] != jobs.PUBLISHED:
        print(f"Publish did not complete: {job['status']} ({job.get('error') or '; '.join(job.get('validation_errors') or [])})",
              file=sys.stderr)
        return 1
    if await service_seems_running(db):
        print("The AI service is running: its in-memory index is now out of date. Rebuild it with "
              "POST /internal/index/rebuild or restart the service.", file=sys.stderr)
    return 0


def main(source: str, doc: str) -> None:
    parser = argparse.ArgumentParser(description=doc, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true",
                        help="validate and preview through the import-job pipeline (created_by cli); write nothing live")
    parser.add_argument("--data-dir", help="dataset folder (default: PROFESSION_DATA_DIR/<source>)")
    parser.add_argument("--version", help="dataset version label (default from settings)")
    parser.add_argument("--actor", default="cli", help="who ran the import (the job's created_by; default cli)")
    parser.add_argument("--i-understand-background-check", action="store_true",
                        help="publish even if the background credit check fails on the staged data")
    sys.exit(asyncio.run(run(source, parser.parse_args())))
