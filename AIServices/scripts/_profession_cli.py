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
from app.services.professions.imports import preview_import, publish_import  # noqa: E402


async def run(source: str, args) -> int:
    client = AsyncIOMotorClient(settings.MONGODB_URL)
    db = client[settings.AI_DB_NAME]
    database_module.database = db  # services use the shared database handle
    try:
        if args.dry_run:
            report = await preview_import(source, args.data_dir, args.version, db=db)
        else:
            if not args.no_index:
                manager = get_manager()
                print(f"Loading {manager.model_name} ...", file=sys.stderr)
                started = time.perf_counter()
                await asyncio.to_thread(manager.load_sync)
                manager.ready_event.set()
                print(f"Model ready in {time.perf_counter() - started:.1f}s", file=sys.stderr)
                await ensure_embedding_indexes(db)
            report = await publish_import(source, args.data_dir, args.version, actor=args.actor, db=db,
                                          rebuild=not args.no_index)
        print(json.dumps(report.to_dict(), indent=2, ensure_ascii=False, default=str))
        if not report.ok:
            print("Import failed: " + "; ".join(report.errors), file=sys.stderr)
            return 1
        if not args.dry_run:
            print("Done. A running AI service picks up the new index on restart or after "
                  "POST /internal/index/rebuild.", file=sys.stderr)
        return 0
    finally:
        client.close()


def main(source: str, doc: str) -> None:
    parser = argparse.ArgumentParser(description=doc, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="validate and report what would change; write nothing")
    parser.add_argument("--data-dir", help="dataset folder (default: PROFESSION_DATA_DIR/<source>)")
    parser.add_argument("--version", help="dataset version label (default from settings)")
    parser.add_argument("--actor", default="cli", help="who ran the import (stored in the import log)")
    parser.add_argument("--no-index", action="store_true", help="write professions only; skip embedding and the index rebuild")
    sys.exit(asyncio.run(run(source, parser.parse_args())))
