#!/usr/bin/env python
"""
Module 5.1 — role-aware mapping: the spot-check file for the user (sandbox).

40 random non-empty entries of role_phrase_skill_map.json (seeded) → spot_check.csv with an empty `correct` column:
1 = all mapped skills are right for that ability in that role, 0 = at least one is wrong.

Usage (repo root): AIServices/backend/venv/Scripts/python AIServices/eval/esco_phrase_mapping/export_spot_check.py
"""

import csv
import json
import random
from pathlib import Path

HERE = Path(__file__).resolve().parent
SEED = 512
SIZE = 40


def main():
    entries = [e for e in json.loads((HERE / "role_phrase_skill_map.json").read_text(encoding="utf8"))["entries"] if e["skills"]]
    sample = random.Random(SEED).sample(entries, SIZE)
    with (HERE / "spot_check.csv").open("w", newline="", encoding="utf8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["id", "role", "phrase", "mapped_skills", "correct", "notes"])
        for i, e in enumerate(sample, 1):
            writer.writerow([f"S{i:02d}", e["role"], e["phrase"], "; ".join(e["skills"]), "", ""])
    print(f"{SIZE} of {len(entries)} non-empty entries; {len({e['role'] for e in sample})} roles; "
          f"{sum(e['source'] == 'role' for e in sample)} role-specific")


if __name__ == "__main__":
    main()
