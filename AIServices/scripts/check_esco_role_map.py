#!/usr/bin/env python
"""
Validate the ESCO role map (Module 5.1): AIServices/backend/app/data/esco_role_phrase_skill_map.json.

Checks (esco_role_map.validate): every mapped skill exists in the skill list (app/data/skill_descriptions.json), at
most 8 skills per pair, no duplicate pairs, and every occupation URI / skill URI and their relation exist in the
active ESCO data — by default the raw dataset as the import selects it (data/raw/esco, ESCO_ISCO_PREFIXES), with --db
the live ai_db professions. Exit code 1 on any error (the build fails); it runs in the AIServices test suite
(tests/test_esco_role_map.py) and therefore in scripts/run_all_tests.

Usage (repo root, AIServices venv):
  AIServices/backend/venv/Scripts/python AIServices/scripts/check_esco_role_map.py [--db] [--data DIR]
"""

import argparse
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND))

from app.config.settings import settings  # noqa: E402
from app.services.professions import esco_role_map  # noqa: E402
from app.services.professions.csv_io import csv_list, read_rows, validate_files  # noqa: E402
from app.services.professions.esco import FILES, OPTIONAL  # noqa: E402

RAW = BACKEND.parent / "data" / "raw" / "esco"
OCC = "http://data.europa.eu/esco/occupation/"


def raw_reference(data_dir: Path = RAW):
    """(occupation URIs, skill URIs, relations) of the dataset as the import selects it (ISCO prefixes)."""
    paths = validate_files(data_dir, FILES, optional=OPTIONAL)
    prefixes = csv_list(settings.ESCO_ISCO_PREFIXES)
    occupations = {r["conceptUri"] for r in read_rows(paths["occupations"])
                   if any(r["iscoGroup"].startswith(p) for p in prefixes)}
    skills = {r["conceptUri"] for r in read_rows(paths["skills"])}
    relations = {(r["occupationUri"], r["skillUri"]) for r in read_rows(paths["occupationSkillRelations"])
                 if r["occupationUri"] in occupations}
    return occupations, skills, relations


def db_reference():
    """(occupation URIs, skill URIs, relations) of the live active ESCO professions (skills carry their URI)."""
    from pymongo import MongoClient

    db = MongoClient(settings.MONGODB_URL)[settings.AI_DB_NAME]
    occupations, relations = set(), set()
    for prof in db["professions"].find({"active": True, "source": "esco"}, {"profession_id": 1, "skills": 1}):
        occ = OCC + prof["profession_id"].split(":", 1)[1]
        occupations.add(occ)
        relations.update((occ, s["uri"]) for s in prof.get("skills") or [] if s.get("uri"))
    skills = {d["uri"] for d in db["esco_skills"].find({}, {"uri": 1})}
    return occupations, skills, relations


def check(use_db: bool = False, data_dir: Path = RAW) -> list:
    occupations, skills, relations = db_reference() if use_db else raw_reference(data_dir)
    return esco_role_map.validate(esco_role_map.read_map(), occupations=occupations, skills=skills, relations=relations)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--db", action="store_true", help="validate the URIs against the live ai_db professions")
    parser.add_argument("--data", default=str(RAW), help="raw ESCO folder (default data/raw/esco)")
    args = parser.parse_args()
    errors = check(args.db, Path(args.data))
    doc = esco_role_map.read_map()
    mapped = sum(1 for e in doc["entries"] if e["skills"])
    if errors:
        print(f"FAIL: {len(errors)} error(s) in {esco_role_map.MAP_FILE.name}")
        for error in errors[:50]:
            print(f"  - {error}")
        sys.exit(1)
    print(f"OK: {len(doc['entries'])} entries ({mapped} mapped) valid against the skill list and the "
          f"{'live' if args.db else 'raw'} ESCO data")


if __name__ == "__main__":
    main()
