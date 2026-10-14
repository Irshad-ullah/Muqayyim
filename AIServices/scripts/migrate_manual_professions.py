#!/usr/bin/env python
"""
Move admin-created professions from core_db.professions (the old CoreServices
Profession model) into ai_db.professions as source 'manual' (09b).

Each Core document becomes profession_id "manual:<Core _id>" with its title,
code, category, description, alternative titles, required skills (as essential
skills) and active flag. Professions already migrated are skipped, so the
script can be re-run. core_db is only read, never changed.

Usage (from the repo root, with the AIServices venv):
  AIServices/backend/venv/Scripts/python AIServices/scripts/migrate_manual_professions.py --dry-run
  AIServices/backend/venv/Scripts/python AIServices/scripts/migrate_manual_professions.py

Env: MONGODB_URL, AI_DB_NAME (AIServices/backend/.env), CORE_DB_NAME (default core_db).
"""

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

from app.config.settings import settings  # noqa: E402
from app.services.professions.categories import categories, categorise  # noqa: E402
from app.services.professions.store import PROFESSIONS, ensure_profession_indexes, make_skill, profession_doc  # noqa: E402


def convert(core: dict) -> dict:
    category = core.get("category") if core.get("category") in categories() else categorise("manual", "", core.get("title", ""))
    doc = profession_doc(
        profession_id=f"manual:{core['_id']}",
        title=(core.get("title") or "").strip(),
        alt_titles=list(dict.fromkeys(t.strip() for t in core.get("alternativeTitles") or [] if t and t.strip()))[:15],
        description=core.get("description") or "",
        category=category,
        source="manual",
        source_code=core.get("code") or "",
        source_version="manual",
        skills=[make_skill(name, "essential", name) for name in core.get("requiredSkills") or [] if name and name.strip()],
    )
    if core.get("isActive") is False:
        doc.update(active=False, inactive_reason="disabled by admin", disabled_by_admin=True)
    now = datetime.now(timezone.utc)
    doc.update(created_at=core.get("createdAt") or now, updated_at=now, migrated_from="core_db.professions")
    return doc


async def main(dry_run: bool) -> None:
    client = AsyncIOMotorClient(settings.MONGODB_URL)
    core = client[os.getenv("CORE_DB_NAME", "core_db")]
    ai = client[settings.AI_DB_NAME]
    try:
        found = [d async for d in core["professions"].find({})]
        docs = [convert(d) for d in found]
        existing = {d["profession_id"] async for d in ai[PROFESSIONS].find(
            {"profession_id": {"$in": [d["profession_id"] for d in docs]}}, {"profession_id": 1})}
        todo = [d for d in docs if d["profession_id"] not in existing]
        if not dry_run and todo:
            await ensure_profession_indexes(ai)
            await ai[PROFESSIONS].insert_many(todo)
        print(json.dumps({
            "dry_run": dry_run,
            "core_professions": len(found),
            "already_migrated": len(existing),
            "to_migrate" if dry_run else "migrated": [{"profession_id": d["profession_id"], "title": d["title"],
                                                         "skills": len(d["skills"]), "active": d["active"]} for d in todo],
            "note": "nothing to migrate" if not todo else
                    "rebuild the role-skill index afterwards (POST /internal/index/rebuild or restart the AI service)",
        }, indent=2, default=str))
    finally:
        client.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--dry-run", action="store_true", help="report what would be migrated; write nothing")
    asyncio.run(main(parser.parse_args().dry_run))
