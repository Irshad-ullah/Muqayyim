#!/usr/bin/env python
"""
Module 5.2 sandbox — add O*NET evidence (O) to the curated roles and recompute importance (METHOD.md rule).

For each requirement: O is added when any skill of its any_of list matches a technology skill listed for the role's
related_onet_code in AIServices/data/raw/onet/software_skills.csv (read only). Matching is by our skill key on both
sides: an O*NET "Workplace Example" goes through the importer's own cleaning (clean_onet_label, e.g. "Structured query
language SQL" -> SQL) and then normalise_skill; a dataset skill is tried as written and, for names like
"Amazon Web Services (AWS)", also as the part before the parenthesis and the part inside it.

importance = essential when the evidence comes from >= 2 different source types (R, S, P, C, O; "C:XYZ" counts as C),
otherwise optional. The matched O*NET labels are kept per requirement in `from_onet`.

Writes data/curated/modern_roles_v1.json (updated in place: evidence, from_onet, importance; "onet_evidence" note at
the top), data/curated/review.csv (evidence / importance columns; reviewer columns kept) and
results/onet_evidence_changes.csv. Everything else is unchanged.

Usage (repo root): AIServices/backend/venv/Scripts/python AIServices/eval/curated_roles/add_onet_evidence.py
"""

import csv
import json
import re
import sys
from collections import defaultdict
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parents[1] / "backend"
sys.path.insert(0, str(BACKEND))

from app.services.embeddings.normalise import normalise_skill  # noqa: E402
from app.services.professions.cleaning import clean_onet_label  # noqa: E402

CURATED = HERE.parents[1] / "data" / "curated"
DATASET = CURATED / "modern_roles_v1.json"
REVIEW = CURATED / "review.csv"
SOFTWARE = HERE.parents[1] / "data" / "raw" / "onet" / "software_skills.csv"
RESULTS = HERE / "results"
PAREN = re.compile(r"^(?P<base>.+?)\s*\((?P<inner>[^()]+)\)\s*$")


def candidate_keys(skill: str) -> set:
    forms = [skill]
    m = PAREN.match(skill)
    if m:
        forms += [m.group("base"), m.group("inner")]
    return {normalise_skill(f)[0] for f in forms if normalise_skill(f)[0]}


def onet_tools() -> dict:
    """O*NET-SOC code -> {our key: [workplace example labels]}."""
    tools = defaultdict(lambda: defaultdict(list))
    with SOFTWARE.open(encoding="utf8", newline="") as handle:
        for row in csv.DictReader(handle):
            label = row["Workplace Example"].strip()
            key = normalise_skill(clean_onet_label(label))[0]
            if key and label not in tools[row["O*NET-SOC Code"]][key]:
                tools[row["O*NET-SOC Code"]][key].append(label)
    return tools


def source_types(evidence) -> set:
    return {e.split(":")[0] for e in evidence}


def main():
    data = json.loads(DATASET.read_text(encoding="utf8"))
    tools = onet_tools()
    changes, added = [], 0
    for role in data["roles"]:
        code = role["related_onet_code"]
        if code not in tools:
            print(f"WARNING {role['title']}: {code} has no technology skills in software_skills.csv")
        for req in role["required_skills"]:
            matched = sorted({label for s in req["any_of"] for k in candidate_keys(s) for label in tools[code].get(k, [])})
            before_importance, before_evidence = req["importance"], list(req["evidence"])
            if matched:
                req["from_onet"] = matched
                if "O" not in req["evidence"]:
                    req["evidence"] = req["evidence"] + ["O"]
                    added += 1
            req["importance"] = "essential" if len(source_types(req["evidence"])) >= 2 else "optional"
            if req["importance"] != before_importance or req["evidence"] != before_evidence:
                changes.append([role["title"], req["skill"], " ".join(before_evidence), " ".join(req["evidence"]),
                                before_importance, req["importance"], "; ".join(matched)])
    data["onet_evidence"] = (f"O applied {date.today().isoformat()} by eval/curated_roles/add_onet_evidence.py from "
                             "data/raw/onet/software_skills.csv (related_onet_code; importer cleaning + skill keys)")
    DATASET.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf8")

    by_req = {(r["title"], q["skill"]): q for r in data["roles"] for q in r["required_skills"]}
    rows = list(csv.reader(REVIEW.open(encoding="utf8")))
    for row in rows[1:]:
        q = by_req.get((row[0], row[1]))
        if q:
            row[3], row[4] = q["importance"], " ".join(q["evidence"])
    with REVIEW.open("w", newline="", encoding="utf8") as handle:
        csv.writer(handle).writerows(rows)

    RESULTS.mkdir(exist_ok=True)
    with (RESULTS / "onet_evidence_changes.csv").open("w", newline="", encoding="utf8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["role", "requirement", "evidence_before", "evidence_after", "importance_before",
                         "importance_after", "onet_labels"])
        writer.writerows(changes)
    sys.stdout.reconfigure(encoding="utf-8")
    flips = [c for c in changes if c[4] != c[5]]
    total = sum(len(r["required_skills"]) for r in data["roles"])
    essential = sum(q["importance"] == "essential" for r in data["roles"] for q in r["required_skills"])
    print(f"O added to {added} of {total} requirements; importance changed for {len(flips)}; essential now {essential}")
    for c in flips:
        print(f"  {c[0]} / {c[1]}: {c[4]} -> {c[5]} (evidence {c[2]} -> {c[3]}; O*NET: {c[6]})")


if __name__ == "__main__":
    main()
