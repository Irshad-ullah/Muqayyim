#!/usr/bin/env python
"""
Import O*NET 31.0 professions into ai_db.professions, embed their skills and
rebuild the role-skill FAISS index.

Kept: SOC codes starting with ONET_SOC_PREFIXES (15-12, 15-2051) except
ONET_SOC_EXCLUDE (15-1299.00). Skills: Hot Technology / In Demand software,
at most ONET_SKILLS_CAP per occupation. See AIServices/data/raw/README.md.

Usage (from the repo root, with the AIServices venv):
  AIServices/backend/venv/Scripts/python AIServices/scripts/import_onet.py --dry-run
  AIServices/backend/venv/Scripts/python AIServices/scripts/import_onet.py
"""

from _profession_cli import main

if __name__ == "__main__":
    main("onet", __doc__)
