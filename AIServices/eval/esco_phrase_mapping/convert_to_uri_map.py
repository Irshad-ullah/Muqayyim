#!/usr/bin/env python
"""
Module 5.1 adoption: convert the evaluated sandbox map (role_phrase_skill_map.json, keyed by role title + phrase) to
the production map AIServices/backend/app/data/esco_role_phrase_skill_map.json, keyed by ESCO occupation URI + skill URI
with readable labels alongside. The skills are copied unchanged.

URIs come from the raw ESCO files (read only; nothing in data/raw is edited) through the same label cleaning the import
uses: a relation's phrase = normalise_skill(clean_esco_label(preferred label)). Occupation titles are matched through the
live professions (profession_id esco:<uuid> ↔ occupation URI), so an admin title override cannot break the match. When
two skill URIs of one occupation clean to the same phrase, both get the entry (the import keeps one requirement per key,
exactly as the sandbox scored it). Every sandbox pair must be found, or the conversion fails.

Usage (repo root): AIServices/backend/venv/Scripts/python AIServices/eval/esco_phrase_mapping/convert_to_uri_map.py
"""

import json
import sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import common  # noqa: E402
from app.services.embeddings.normalise import normalise_skill  # noqa: E402
from app.services.professions import esco_role_map  # noqa: E402
from app.services.professions.cleaning import clean_esco_label  # noqa: E402
from app.services.professions.csv_io import read_rows, validate_files  # noqa: E402
from app.services.professions.esco import FILES, OPTIONAL  # noqa: E402

RAW = common.BACKEND.parent / "data" / "raw" / "esco"
OCC = "http://data.europa.eu/esco/occupation/"


def main():
    sandbox = json.loads((HERE / "role_phrase_skill_map.json").read_text(encoding="utf8"))
    paths = validate_files(RAW, FILES, optional=OPTIONAL)
    labels = {r["conceptUri"]: r["preferredLabel"] for r in read_rows(paths["skills"])}
    titles = {}
    for prof in common.db()["professions"].find({"active": True, "source": "esco"}, {"profession_id": 1, "title": 1}):
        titles[prof["title"]] = OCC + prof["profession_id"].split(":", 1)[1]
    occ_labels = {r["conceptUri"]: r["preferredLabel"] for r in read_rows(paths["occupations"]) if r["conceptUri"] in titles.values()}
    by_phrase = defaultdict(list)  # (occupation uri, phrase) → [skill uri]
    for row in read_rows(paths["occupationSkillRelations"]):
        occ = row["occupationUri"]
        if occ in occ_labels and row["skillUri"] in labels:
            phrase = normalise_skill(clean_esco_label(labels[row["skillUri"]]))[1]
            by_phrase[(occ, phrase)].append(row["skillUri"])

    entries, missing = [], []
    for e in sandbox["entries"]:
        occ = titles.get(e["role"])
        uris = by_phrase.get((occ, e["phrase"])) if occ else None
        if not uris:
            missing.append(f"{e['role']} / {e['phrase']}")
            continue
        for uri in dict.fromkeys(uris):
            entry = {"occupation_uri": occ, "occupation": occ_labels[occ], "skill_uri": uri, "phrase": labels[uri],
                     "skills": e["skills"]}
            if e["skills"]:
                entry["reason"] = e["reason"]
            entries.append(entry)
    if missing:
        raise SystemExit(f"{len(missing)} sandbox pairs not found in the raw ESCO data: {missing[:10]}")
    entries.sort(key=lambda x: (x["occupation"], x["phrase"].lower(), x["skill_uri"]))
    doc = {
        "_comment": "Module 5.1: ESCO role-aware phrase → skill map, applied by the ESCO import as a transform "
                    "(app/services/professions/esco_role_map.py). Keyed by occupation URI + skill URI; labels are for "
                    "reading only. skills = 0–8 canonical names from app/data/skill_descriptions.json; an empty list is a "
                    "reviewed pair that stays unmapped. Made AI-assisted, role-aware and conservative; user spot-check 40/40. "
                    "Validated by AIServices/scripts/check_esco_role_map.py. Never edited by publishing.",
        "version": 1,
        "esco_version": "1.2.1",
        "method": "AI-assisted (Claude), role-aware, conservative; spot-check 40/40 (Wilson 95 % lower bound ~91 %)",
        "entries": entries,
    }
    errors = esco_role_map.validate(doc)
    if errors:
        raise SystemExit("\n".join(errors[:20]))
    esco_role_map.MAP_FILE.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf8")
    mapped = [x for x in entries if x["skills"]]
    print(f"{len(sandbox['entries'])} sandbox pairs -> {len(entries)} URI entries ({len(mapped)} mapped) "
          f"-> {esco_role_map.MAP_FILE.relative_to(common.BACKEND.parents[1])}")


if __name__ == "__main__":
    main()
