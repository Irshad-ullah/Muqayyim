#!/usr/bin/env python
"""
Role-skill description coverage (09b2, Part 1).

Reads the ACTIVE professions in ai_db.professions (sources from
PROFESSION_SOURCES) and reports, per source and overall:
  (a) % of distinct role skills with a description
  (b) % of role-skill occurrences (profession × skill) with a description
  (c) % of ESSENTIAL occurrences described (ESCO) and of hot/in-demand
      occurrences described (O*NET)
"Described" = the active description chain (curated file; ESCO only when
ESCO_DESCRIPTIONS_ENABLED=true).

Undescribed skills are grouped by simple rules (see `group()`):
  tool        — short proper names: languages, products, platforms
  phrase      — ESCO skill/competence phrases ("design user interface")
  knowledge   — ESCO knowledge areas ("computer programming")

Usage (AIServices venv, from the repo root):
  AIServices/backend/venv/Scripts/python AIServices/eval/role_skill_coverage.py [--json out.json] [--top 200]
Read-only.
"""

import argparse
import json
import os
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

from pymongo import MongoClient  # noqa: E402

from app.config.settings import settings  # noqa: E402
from app.services.embeddings.descriptions import get_description_provider  # noqa: E402
from app.services.professions.store import ESCO_SKILLS, PROFESSIONS, active_filter  # noqa: E402

# Knowledge-area head words: a capitalised ESCO knowledge label containing one of
# these is a field of knowledge, not a product ("Agile project management").
GENERIC = {
    "management", "methodologies", "methodology", "methods", "principles", "legislation", "standards",
    "models", "modelling", "modeling", "techniques", "theory", "engineering", "analysis", "analytics",
    "design", "processes", "process", "procedures", "policies", "law", "regulations", "ethics",
    "languages", "tools", "systems", "architecture", "security", "governance", "strategies",
    "concepts", "frameworks", "programming", "science", "statistics", "mathematics", "protocols",
}
GENERIC_LEAD = {"ICT", "IT", "ICT-", "Internet", "Information", "Business", "Digital", "Computer", "Cloud", "Data"}
QUALIFIER = re.compile(r"\s*\([^()]*\)\s*$")


def group(name: str, source: str, esco_type: str) -> str:
    """tool | phrase | knowledge (simple rules, documented in 09b2)."""
    base = QUALIFIER.sub("", name).strip()
    words = base.split()
    if source != "esco":
        return "tool"  # O*NET and manual role skills are technologies / products
    if esco_type == "skill/competence":
        return "phrase"
    capitalised = bool(words) and (words[0][0].isupper() or words[0][0].isdigit())
    generic = any(w.lower().strip(",") in GENERIC for w in words) or (words and words[0] in GENERIC_LEAD)
    if capitalised and len(words) <= 4 and not generic:
        return "tool"
    return "knowledge"


def pct(part: int, whole: int) -> float:
    return round(100 * part / whole, 1) if whole else 0.0


def measure(db) -> dict:
    provider = get_description_provider()
    esco_type = {}
    for doc in db[ESCO_SKILLS].find({}, {"label": 1, "skill_type": 1}):
        esco_type[doc["label"]] = doc.get("skill_type") or ""

    distinct = defaultdict(dict)  # source → key → info
    occ = Counter()  # (source, described, kind) counts
    professions_per_key = defaultdict(set)
    info = {}
    for prof in db[PROFESSIONS].find(active_filter(), {"profession_id": 1, "source": 1, "skills": 1}):
        src = prof["source"]
        for s in prof.get("skills") or []:
            described = provider.lookup(s["name"]) is not None
            key = s["key"]
            kind_type = esco_type.get(s.get("original_label"), "") if src == "esco" else ""
            entry = info.setdefault(key, {"name": s["name"], "described": described, "sources": set(),
                                          "esco_type": kind_type, "examples": s.get("original_label")})
            entry["sources"].add(src)
            if kind_type and not entry["esco_type"]:
                entry["esco_type"] = kind_type
            distinct[src][key] = described
            professions_per_key[key].add(prof["profession_id"])
            occ[(src, "all", described)] += 1
            if src == "esco" and s["type"] == "essential":
                occ[(src, "essential", described)] += 1
            if src == "onet" and (s.get("hot") or s.get("in_demand")):
                occ[(src, "hot_or_in_demand", described)] += 1

    rows = {}
    for src in sorted(distinct) + ["overall"]:
        if src == "overall":
            keys = {k: v["described"] for k, v in info.items()}
            o_all = [occ[(s, "all", True)] for s in distinct], [occ[(s, "all", False)] for s in distinct]
            all_yes, all_no = sum(o_all[0]), sum(o_all[1])
        else:
            keys = distinct[src]
            all_yes, all_no = occ[(src, "all", True)], occ[(src, "all", False)]
        row = {
            "distinct": len(keys),
            "distinct_described_pct": pct(sum(keys.values()), len(keys)),
            "occurrences": all_yes + all_no,
            "occurrences_described_pct": pct(all_yes, all_yes + all_no),
        }
        if src == "esco":
            y, n = occ[(src, "essential", True)], occ[(src, "essential", False)]
            row.update(essential_occurrences=y + n, essential_described_pct=pct(y, y + n))
        if src == "onet":
            y, n = occ[(src, "hot_or_in_demand", True)], occ[(src, "hot_or_in_demand", False)]
            row.update(hot_or_in_demand_occurrences=y + n, hot_or_in_demand_described_pct=pct(y, y + n))
        rows[src] = row

    undescribed = []
    for key, entry in info.items():
        if entry["described"]:
            continue
        src = "esco" if entry["sources"] == {"esco"} else sorted(entry["sources"] - {"esco"})[0]
        undescribed.append({
            "name": entry["name"], "key": key, "group": group(entry["name"], src, entry["esco_type"]),
            "professions": len(professions_per_key[key]), "sources": sorted(entry["sources"]),
            "esco_type": entry["esco_type"] or None,
        })
    undescribed.sort(key=lambda r: (-r["professions"], r["name"].lower()))
    groups = Counter(r["group"] for r in undescribed)
    return {"coverage": rows, "undescribed_total": len(undescribed), "groups": dict(groups),
            "group_examples": {g: [r["name"] for r in undescribed if r["group"] == g][:15] for g in groups},
            "undescribed": undescribed}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--json", help="write the full result to this file")
    parser.add_argument("--top", type=int, default=200)
    args = parser.parse_args()
    client = MongoClient(settings.MONGODB_URL)
    try:
        result = measure(client[settings.AI_DB_NAME])
    finally:
        client.close()
    if args.json:
        Path(args.json).write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf8")
    print(json.dumps({k: v for k, v in result.items() if k != "undescribed"}, indent=2, ensure_ascii=False))
    print(f"\nTop {args.top} undescribed role skills (by professions using them):")
    for i, r in enumerate(result["undescribed"][: args.top], 1):
        print(f"{i:3}. {r['name']} [{r['group']}] {r['professions']} ({'/'.join(r['sources'])})")


if __name__ == "__main__":
    main()
