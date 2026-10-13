#!/usr/bin/env python
"""
Re-embed all skills for the current EMBEDDING_MODEL (after changing the model).

Embeds every skill key found in ai_db.skill_vectors (under any model) and every
key referenced by ai_db.user_skill_profiles, then marks user profiles as using
the current model. Vectors of different models are never mixed.

Usage (from the repo root, with the AIServices venv):
  AIServices/backend/venv/Scripts/python AIServices/scripts/reembed_all.py --dry-run
  AIServices/backend/venv/Scripts/python AIServices/scripts/reembed_all.py

Env (read from AIServices/backend/.env): MONGODB_URL, AI_DB_NAME,
EMBEDDING_MODEL, EMBEDDING_CACHE_DIR.
"""

import argparse
import asyncio
import json
import os
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)  # .env and the relative model cache resolve from the backend folder

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

from app.config.settings import settings  # noqa: E402
from app.services.embeddings.model import ModelManager  # noqa: E402
from app.services.embeddings.reembed import reembed_all  # noqa: E402
from app.services.embeddings.vector_store import ensure_embedding_indexes  # noqa: E402


async def main(dry_run: bool) -> None:
    client = AsyncIOMotorClient(settings.MONGODB_URL)
    db = client[settings.AI_DB_NAME]
    try:
        embedder = ModelManager()
        if not dry_run:
            print(f"Loading {embedder.model_name} ...")
            embedder.load_sync()
            await ensure_embedding_indexes(db)
        report = await reembed_all(db, embedder, dry_run=dry_run)
        print(json.dumps({"model": embedder.model_name, "dry_run": dry_run, **report}, indent=2))
    finally:
        client.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="report what would be embedded; write nothing")
    asyncio.run(main(parser.parse_args().dry_run))
