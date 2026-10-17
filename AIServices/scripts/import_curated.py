#!/usr/bin/env python
"""
Import the curated modern IT roles (Module 5.2) from AIServices/data/curated/modern_roles_v1.json through the taxonomy
pipeline: the same upload, validation (validate_modern_roles.py rules; every skill must be in the skill list), preview /
diff, publish with a snapshot, index rebuild, post-checks and automatic rollback as the admin UI. The published dataset
is kept as app/data/curated_roles.json (part of every snapshot).

Usage (from the repo root, with the AIServices venv):
  AIServices/backend/venv/Scripts/python AIServices/scripts/import_curated.py --dry-run
  AIServices/backend/venv/Scripts/python AIServices/scripts/import_curated.py
"""

from _profession_cli import main

if __name__ == "__main__":
    main("curated", __doc__)
