#!/usr/bin/env python
"""
Module 6 Part 7 — summary of the team's manual review (manual_review.csv; manual_review.pending.csv, if present, must
hold the same marks). % exists, % relevant, % hours plausible: overall, per path, and without the freeCodeCamp rows
(the platform was removed because of them). A mark left empty counts as "not recorded", never as yes or no.

Writes results/manual_review_summary.{json,md}. Usage (repo root):
  python AIServices/eval/learning_paths/summarise_manual_review.py
"""

import csv
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
MARKS = {"exists": "exists_y_n", "relevant": "relevant_y_n", "hours plausible": "hours_plausible_y_n"}


def read(path: Path) -> list:
    with path.open(encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def share(rows: list, column: str) -> dict:
    marked = [r[column].strip().upper() for r in rows if r[column].strip()]
    if not marked:
        return {"yes": 0, "marked": 0, "percent": None}
    yes = sum(1 for m in marked if m == "Y")
    return {"yes": yes, "marked": len(marked), "percent": round(100 * yes / len(marked), 1)}


def summary(rows: list) -> dict:
    return {"rows": len(rows), **{name: share(rows, column) for name, column in MARKS.items()}}


def cell(s: dict) -> str:
    return "not recorded" if s["percent"] is None else f"{s['yes']} / {s['marked']} ({s['percent']} %)"


def main():
    rows = read(HERE / "manual_review.csv")
    pending = HERE / "manual_review.pending.csv"
    if pending.exists():
        key = lambda r: (r["path"], r["module"], r["title"], *(r[c] for c in MARKS.values()))  # noqa: E731
        if sorted(map(key, read(pending))) != sorted(map(key, rows)):
            raise SystemExit("manual_review.pending.csv has different marks: reconcile the two files first")
    paths = list(dict.fromkeys(r["path"] for r in rows))
    without = [r for r in rows if r["platform"] != "freeCodeCamp"]
    out = {
        "overall": summary(rows),
        "per_path": {p: summary([r for r in rows if r["path"] == p]) for p in paths},
        "without_freecodecamp": {"overall": summary(without),
                                 "per_path": {p: summary([r for r in without if r["path"] == p]) for p in paths}},
        "freecodecamp_rows": [{k: r[k] for k in ("path", "module", "title", "exists_y_n", "relevant_y_n")}
                              for r in rows if r["platform"] == "freeCodeCamp"],
        "reviewer_column_filled": sum(1 for r in rows if r["reviewer"].strip()),
    }
    (HERE / "results").mkdir(exist_ok=True)
    (HERE / "results" / "manual_review_summary.json").write_text(json.dumps(out, indent=1, ensure_ascii=False), encoding="utf8")
    lines = ["# Module 6 — manual review of 5 learning paths", "",
             f"{len(rows)} recommendations, {len(paths)} paths. Empty marks are \"not recorded\".", "",
             "| Scope | Rows | Exists | Relevant | Hours plausible |", "|---|---|---|---|---|"]
    for label, s in [("All paths", out["overall"])] + list(out["per_path"].items()) + \
            [("All paths, without freeCodeCamp", out["without_freecodecamp"]["overall"])] + \
            [(f"{p}, without freeCodeCamp", s) for p, s in out["without_freecodecamp"]["per_path"].items()
             if s["rows"] != out["per_path"][p]["rows"]]:
        lines.append(f"| {label} | {s['rows']} | {cell(s['exists'])} | {cell(s['relevant'])} | {cell(s['hours plausible'])} |")
    (HERE / "results" / "manual_review_summary.md").write_text("\n".join(lines) + "\n", encoding="utf8")
    sys.stdout.reconfigure(encoding="utf-8")
    print("\n".join(lines))


if __name__ == "__main__":
    main()
