#!/usr/bin/env python
"""
Module 5.1 — variant 2, step 1: feasibility of ESCO phrase → O*NET technology category → tools (sandbox).

Reads AIServices/data/raw/onet/software_skills.csv (read-only) and reports:
- the category column ("Element Name", e.g. "Configuration management software"; the O*NET grouping of tools),
- the number of distinct categories, distinct tools per category (min / median / max), 10 example categories,
- how many tools map to a canonical skill key with the importer's own cleaning (clean_onet_label → a curated or alias
  name, the same rule the O*NET import uses), overall and per category.

A "tool" is a distinct Workplace Example within a category (the file repeats it once per occupation).
Output: results/category_feasibility.{json,md}. Nothing is written elsewhere.

Usage (repo root): AIServices/backend/venv/Scripts/python AIServices/eval/esco_phrase_mapping/category_feasibility.py
"""

import csv
import json
import random
import statistics
import sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import common  # noqa: E402,F401  (sets the backend path)
from app.services.embeddings.normalise import normalise_skill  # noqa: E402
from app.services.professions.cleaning import clean_onet_label, known  # noqa: E402

SOURCE = common.BACKEND.parent / "data" / "raw" / "onet" / "software_skills.csv"
CATEGORY_COLUMN = "Element Name"
TOOL_COLUMN = "Workplace Example"


def load_categories():
    """{category: {"id": element id, "tools": {tool label: occupations}}}"""
    categories = defaultdict(lambda: {"id": "", "tools": defaultdict(int)})
    with SOURCE.open(encoding="utf8", newline="") as handle:
        for row in csv.DictReader(handle):
            entry = categories[row[CATEGORY_COLUMN].strip()]
            entry["id"] = row["Element ID"]
            entry["tools"][row[TOOL_COLUMN].strip()] += 1
    return categories


def tool_key(label):
    """The canonical skill key the importer would give this tool, or None when it is not a known skill."""
    name = clean_onet_label(label)
    return normalise_skill(name)[0] if known(name) else None


def main():
    categories = load_categories()
    per_category = []
    all_tools, mapped_tools, keys = set(), set(), set()
    tool_categories = defaultdict(set)
    for name, entry in categories.items():
        tools = entry["tools"]
        mapped = {t: tool_key(t) for t in tools}
        hits = {t: k for t, k in mapped.items() if k}
        all_tools |= set(tools)
        mapped_tools |= set(hits)
        keys |= set(hits.values())
        for t in tools:
            tool_categories[t].add(name)
        by_use = sorted(tools, key=lambda t: (-tools[t], t))
        per_category.append({"category": name, "element_id": entry["id"], "tools": len(tools), "mapped_tools": len(hits),
                             "mapped_share": round(len(hits) / len(tools), 3), "canonical_keys": len(set(hits.values())),
                             "most_used_tools": by_use[:8], "most_used_mapped": [t for t in by_use if t in hits][:8]})
    per_category.sort(key=lambda c: (-c["tools"], c["category"]))
    sizes = [c["tools"] for c in per_category]
    shares = [c["mapped_share"] for c in per_category]
    rng = random.Random(51)
    examples = [c["category"] for c in per_category[:4]] + rng.sample([c["category"] for c in per_category[4:]], 6)
    report = {
        "source": str(SOURCE.relative_to(common.BACKEND.parents[1])).replace("\\", "/"),
        "category_column": CATEGORY_COLUMN, "tool_column": TOOL_COLUMN,
        "categories": len(per_category),
        "tools_per_category": {"min": min(sizes), "median": statistics.median(sizes), "max": max(sizes),
                               "mean": round(statistics.mean(sizes), 1)},
        "distinct_tools": len(all_tools),
        "tools_in_more_than_one_category": sum(1 for t in tool_categories if len(tool_categories[t]) > 1),
        "tools_mapped_to_canonical_key": len(mapped_tools),
        "tools_mapped_share": round(len(mapped_tools) / len(all_tools), 3),
        "distinct_canonical_keys_reached": len(keys),
        "categories_with_at_least_one_mapped_tool": sum(1 for c in per_category if c["mapped_tools"]),
        "categories_with_3_or_more_mapped_tools": sum(1 for c in per_category if c["mapped_tools"] >= 3),
        "mapped_share_per_category": {"min": min(shares), "median": statistics.median(shares), "max": max(shares)},
        "examples": [next(c for c in per_category if c["category"] == e) for e in examples],
        "per_category": per_category,
    }
    common.RESULTS.mkdir(exist_ok=True)
    (common.RESULTS / "category_feasibility.json").write_text(json.dumps(report, indent=1), encoding="utf8")

    lines = ["# Variant 2, step 1 — O*NET technology categories: feasibility", "",
             f"Source `{report['source']}`; category column **`{CATEGORY_COLUMN}`** (with `Element ID`); a tool is a distinct "
             f"`{TOOL_COLUMN}` within a category. Mapping = the O*NET importer's `clean_onet_label` giving a curated or "
             "alias name (the same rule the import uses).", "",
             "| Measure | Value |", "|---|---|",
             f"| Distinct categories | {report['categories']} |",
             f"| Tools per category (min / median / max; mean) | {min(sizes)} / {statistics.median(sizes)} / {max(sizes)}; {report['tools_per_category']['mean']} |",
             f"| Distinct tools | {report['distinct_tools']} ({report['tools_in_more_than_one_category']} in more than one category) |",
             f"| Tools mapped to a canonical key | {report['tools_mapped_to_canonical_key']} ({report['tools_mapped_share']:.1%}) → {report['distinct_canonical_keys_reached']} distinct keys |",
             f"| Categories with ≥ 1 / ≥ 3 mapped tools | {report['categories_with_at_least_one_mapped_tool']} / {report['categories_with_3_or_more_mapped_tools']} |",
             f"| Mapped share per category (min / median / max) | {min(shares):.0%} / {statistics.median(shares):.0%} / {max(shares):.0%} |",
             "", "## 10 example categories", "", "| Category | Tools | Mapped | Most used tools (mapped in bold) |", "|---|---|---|---|"]
    for c in report["examples"]:
        shown = ", ".join(f"**{t}**" if t in c["most_used_mapped"] else t for t in c["most_used_tools"][:6])
        lines.append(f"| {c['category']} | {c['tools']} | {c['mapped_tools']} ({c['mapped_share']:.0%}) | {shown} |")
    lines += ["", "## All categories", "", "| Category | Tools | Mapped | Keys |", "|---|---|---|---|"]
    lines += [f"| {c['category']} | {c['tools']} | {c['mapped_tools']} ({c['mapped_share']:.0%}) | {c['canonical_keys']} |" for c in per_category]
    (common.RESULTS / "category_feasibility.md").write_text("\n".join(lines) + "\n", encoding="utf8")
    print("\n".join(lines[:22]))


if __name__ == "__main__":
    main()
