#!/usr/bin/env python
"""
Module 5.1 — variant 2, step 2 check: which cross-encoder input separates phrase → category pairs (sandbox).

The first scoring run put the whole question (with the category and tools) in the query and the category with the same
tools in the passage: every one of 7,490 pairs scored >= 0.9 (logit 1st percentile 4.1) — the passage repeats the
query, so the model sees near-total overlap. This probe scores 24 obvious pairs (12 positive, 12 negative, chosen by
hand before scoring) with a few input layouts that keep the requested wording but stop the echo, and reports the
separation (AUC and the margin between the classes). Output: results/category_probe.json.
"""

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import common  # noqa: E402
import numpy as np  # noqa: E402
from category_rerank import MODEL, category_table  # noqa: E402

POSITIVE = [
    ("execute software tests", "Program testing software"), ("database management systems", "Data base management system software"),
    ("create digital images", "Graphics or photo imaging software"), ("deploy cloud resource", "Cloud-based management software"),
    ("perform project management", "Project management software"), ("design graphics", "Graphics or photo imaging software"),
    ("tools for software configuration management", "Configuration management software"),
    ("apply statistical analysis techniques", "Analytical or scientific software"), ("use scripting programming", "Object or component oriented development software"),
    ("implement front-end website design", "Web platform development software"), ("mobile operating systems", "Operating system software"),
    ("edit digital moving images", "Video creation and editing software"),
]
NEGATIVE = [
    ("execute software tests", "Accounting software"), ("database management systems", "Video creation and editing software"),
    ("create digital images", "Data base management system software"), ("deploy cloud resource", "Computer aided design CAD software"),
    ("perform project management", "Operating system software"), ("design graphics", "Program testing software"),
    ("comply with legal regulations", "Development environment software"), ("intellectual property law", "Web platform development software"),
    ("collaborate with designers", "Data base management system software"), ("ICT network cable limitations", "Graphics or photo imaging software"),
    ("analyse a script", "Program testing software"), ("ensure legal gaming", "Object or component oriented development software"),
]


def layouts(phrase, category, tools):
    eg = ", ".join(tools)
    full = f"Does the ability '{phrase}' correspond to using {category} (e.g. {eg})?"
    return {
        "A_first_run (question | category: tools)": (full, f"{category}: {eg}"),
        "B (question about 'this software' | category (e.g. tools))": (
            f"Does the ability '{phrase}' correspond to using this software?", f"{category} (e.g. {eg})"),
        "C (ability | using category (e.g. tools))": (f"the ability '{phrase}'", f"using {category} (e.g. {eg})"),
        "D (full question | empty passage)": (full, ""),
    }


def auc(pos, neg):
    return float(np.mean([(p > n) + 0.5 * (p == n) for p in pos for n in neg]))


def main():
    from sentence_transformers import CrossEncoder
    import torch

    table = {c["category"]: c for c in category_table()}
    model = CrossEncoder(MODEL, device="cpu", cache_folder=str(common.MODELS), max_length=256)
    pairs = [(p, c, 1) for p, c in POSITIVE] + [(p, c, 0) for p, c in NEGATIVE]
    names = list(layouts("x", "y", ["z"]))
    report = {}
    for name in names:
        inputs = [layouts(p, c, table[c]["examples"])[name] for p, c, _ in pairs]
        logits = model.predict(inputs, activation_fn=torch.nn.Identity(), convert_to_numpy=True, show_progress_bar=False)
        probs = 1 / (1 + np.exp(-logits))
        pos = [float(s) for s, (_, _, y) in zip(probs, pairs) if y]
        neg = [float(s) for s, (_, _, y) in zip(probs, pairs) if not y]
        report[name] = {"auc": round(auc(pos, neg), 3), "positive_min_median": [round(min(pos), 3), round(float(np.median(pos)), 3)],
                        "negative_median_max": [round(float(np.median(neg)), 3), round(max(neg), 3)],
                        "scores": [[p, c, y, round(float(s), 4)] for (p, c, y), s in zip(pairs, probs)]}
    (common.RESULTS / "category_probe.json").write_text(json.dumps(report, indent=1), encoding="utf8")
    for name, r in report.items():
        print(f"{name}: AUC {r['auc']}  pos min/median {r['positive_min_median']}  neg median/max {r['negative_median_max']}")


if __name__ == "__main__":
    main()
