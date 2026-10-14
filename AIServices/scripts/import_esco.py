#!/usr/bin/env python
"""
Import ESCO v1.2.1 professions into ai_db.professions and every ESCO skill into
ai_db.esco_skills, embed the role skills and rebuild the role-skill FAISS index.

Kept: occupations whose ISCO group starts with ESCO_ISCO_PREFIXES
(251, 252, 351, 352, 2166), with their essential and optional skills.
See AIServices/data/raw/README.md.

Usage (from the repo root, with the AIServices venv):
  AIServices/backend/venv/Scripts/python AIServices/scripts/import_esco.py --dry-run
  AIServices/backend/venv/Scripts/python AIServices/scripts/import_esco.py
"""

from _profession_cli import main

if __name__ == "__main__":
    main("esco", __doc__)
