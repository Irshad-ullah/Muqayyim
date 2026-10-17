#!/usr/bin/env python
"""
Module 5.2 sandbox — map every skill in each curated requirement's any_of list to our skill keys.

A skill maps when normalise_skill (the alias table) gives a key that is in our skill list (the curated names in
app/data/skill_descriptions.json). Writes:
  results/skill_key_map.csv   role, requirement, any_of skill, key, our skill name, status (mapped / alias / missing)
  results/skill_keys.txt      our skill list for validate_modern_roles.py: every curated name and every alias form
                              (one per line), so an any_of skill that is a known alias passes the check
and prints the skills that are not in our skill list. Nothing in the skill list is changed.

Usage (repo root): AIServices/backend/venv/Scripts/python AIServices/eval/curated_roles/map_skill_keys.py
"""

import csv
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parents[1] / "backend"
sys.path.insert(0, str(BACKEND))

from app.services.embeddings import descriptions as descriptions_module  # noqa: E402
from app.services.embeddings import normalise as normalise_module  # noqa: E402
from app.services.embeddings.normalise import normalise_skill  # noqa: E402

DATASET = HERE.parents[1] / "data" / "curated" / "modern_roles_v1.json"
RESULTS = HERE / "results"


def skill_list():
    curated = json.loads(Path(descriptions_module.CURATED_FILE).read_text(encoding="utf8"))
    names = [n for n in curated if not n.startswith("_")]
    return {normalise_skill(n)[0]: n for n in names}, names


def main():
    vocab, names = skill_list()
    aliases = json.loads(Path(normalise_module.ALIASES_FILE).read_text(encoding="utf8"))["canonical"]
    data = json.loads(DATASET.read_text(encoding="utf8"))
    RESULTS.mkdir(exist_ok=True)
    rows, missing = [], {}
    for role in data["roles"]:
        for req in role["required_skills"]:
            for skill in req["any_of"]:
                key, canonical = normalise_skill(skill)
                if key in vocab:
                    status = "mapped" if vocab[key].lower() == skill.lower() else "alias"
                else:
                    status = "missing"
                    missing.setdefault(skill, []).append(role["title"])
                rows.append([role["title"], req["skill"], skill, key, vocab.get(key, ""), status])
    with (RESULTS / "skill_key_map.csv").open("w", newline="", encoding="utf8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["role", "requirement", "any_of_skill", "key", "our_skill", "status"])
        writer.writerows(rows)
    forms = set(names)
    for canonical, alts in aliases.items():
        if normalise_skill(canonical)[0] in vocab:
            forms.update([canonical, *alts])
    (RESULTS / "skill_keys.txt").write_text("\n".join(sorted(forms, key=str.lower)) + "\n", encoding="utf8")
    sys.stdout.reconfigure(encoding="utf-8")
    counts = {s: sum(r[5] == s for r in rows) for s in ("mapped", "alias", "missing")}
    print(f"{len(rows)} any_of entries: {counts}; distinct missing skills: {len(missing)}")
    for skill, roles in sorted(missing.items(), key=lambda kv: kv[0].lower()):
        print(f"  MISSING {skill!r}: {', '.join(sorted(set(roles)))}")
    for r in rows:
        if r[5] == "alias":
            print(f"  ALIAS   {r[2]!r} -> {r[4]!r}")


if __name__ == "__main__":
    main()
