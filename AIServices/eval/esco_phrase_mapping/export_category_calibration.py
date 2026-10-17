#!/usr/bin/env python
"""
Module 5.1 — variant 2, step 3: the phrase → category calibration set to label (sandbox).

Samples ~100 pairs from results/category_pairs.csv:
- POOL: only pairs whose category has at least one tool that maps to a canonical skill key — the only pairs that can
  ever credit a phrase (a category without mapped tools gives the user nothing to hold).
- 90 pairs spread over the primary reranker score (layout C logit): 10 EQUAL-WIDTH logit bands between the pool's
  lowest and highest score, 9 each, seeded; a band with too few pairs passes its shortfall to the next band down. Equal
  width (not quantiles) samples the sparse high-score tail, where a >= 95 % precision cut-off will sit; quantile bands
  put only 9 pairs above logit -5.6. At most 1 pair per phrase and 8 per category.
- 10 PLANTED pairs chosen by hand before scoring (5 likely negatives, 5 likely positives); those not among the
  candidates are scored here with the same layouts.

BLIND LABELLING: category_calibration_to_label.csv has NO scores and is shuffled; category_calibration_key.csv holds
the scores, band and sample type for the same ids. The rule is in CATEGORY_CALIBRATION_README.md.

Usage (repo root): AIServices/backend/venv/Scripts/python AIServices/eval/esco_phrase_mapping/export_category_calibration.py
"""

import csv
import random
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import common  # noqa: E402
import numpy as np  # noqa: E402
from category_rerank import MODEL, category_table, layout_b, layout_c  # noqa: E402
from app.services.professions.cleaning import clean_onet_label  # noqa: E402

SEED = 52
BANDS = 10
PER_BAND = 9
MAX_PER_PHRASE = 1
MAX_PER_CATEGORY = 8
SHOW_TOOLS = 12
PLANTED = [
    ("comply with legal regulations", "Development environment software", "likely negative"),
    ("intellectual property law", "Web platform development software", "likely negative"),
    ("collaborate with designers", "Data base management system software", "likely negative"),
    ("ensure legal gaming", "Object or component oriented development software", "likely negative"),
    ("execute software tests", "Accounting software", "likely negative"),
    ("execute software tests", "Program testing software", "likely positive"),
    ("database management systems", "Data base management system software", "likely positive"),
    ("design graphics", "Graphics or photo imaging software", "likely positive"),
    ("tools for software configuration management", "Configuration management software", "likely positive"),
    ("deploy cloud resource", "Cloud-based management software", "likely positive"),
]


def main():
    rows = list(csv.DictReader((common.RESULTS / "category_pairs.csv").open(encoding="utf8")))
    table = {c["category"]: c for c in category_table()}
    pool = [r for r in rows if int(r["mapped_tools"]) > 0]
    logits = np.array([float(r["reranker_logit"]) for r in pool])
    edges = np.linspace(logits.min(), logits.max(), BANDS + 1)
    rng = random.Random(SEED)
    planted_keys = {(p, c) for p, c, _ in PLANTED}

    chosen, per_phrase, per_category = [], Counter(), Counter()
    carry = 0
    for band in reversed(range(BANDS)):  # top band first; a shortfall moves down
        low, high = edges[band], edges[band + 1]
        members = [r for r in pool if low <= float(r["reranker_logit"]) <= high and (r["phrase"], r["category"]) not in planted_keys]
        rng.shuffle(members)
        taken = 0
        for row in members:
            if taken >= PER_BAND + carry:
                break
            if per_phrase[row["phrase"]] >= MAX_PER_PHRASE or per_category[row["category"]] >= MAX_PER_CATEGORY:
                continue
            chosen.append({**row, "sample": f"band {band + 1}/{BANDS} (logit {low:.2f} to {high:.2f})"})
            per_phrase[row["phrase"]] += 1
            per_category[row["category"]] += 1
            taken += 1
        carry = PER_BAND + carry - taken

    index = {(r["phrase"], r["category"]): r for r in rows}
    missing = [(p, c) for p, c, _ in PLANTED if (p, c) not in index]
    scored = {}
    if missing:
        import torch
        from sentence_transformers import CrossEncoder

        model = CrossEncoder(MODEL, device="cpu", cache_folder=str(common.MODELS), max_length=256)
        for layout, name in ((layout_c, "c"), (layout_b, "b")):
            out = model.predict([layout(p, c, table[c]["examples"]) for p, c in missing],
                                activation_fn=torch.nn.Identity(), convert_to_numpy=True, show_progress_bar=False)
            for key, logit in zip(missing, out):
                scored.setdefault(key, {})[name] = float(logit)
    for phrase, category, note in PLANTED:
        base = index.get((phrase, category))
        chosen.append({
            "phrase": phrase, "category": category,
            "bi_encoder_rank": base["bi_encoder_rank"] if base else "not in top 10",
            "bi_encoder_cosine": base["bi_encoder_cosine"] if base else "",
            "reranker_logit": base["reranker_logit"] if base else f"{scored[(phrase, category)]['c']:.4f}",
            "reranker_b_logit": base["reranker_b_logit"] if base else f"{scored[(phrase, category)]['b']:.4f}",
            "sample": f"planted: {note}",
        })

    rng.shuffle(chosen)

    def tools_that_count(category):
        names = [clean_onet_label(t) for t in table[category]["mapped"].values()]
        more = len(names) - SHOW_TOOLS
        return "; ".join(names[:SHOW_TOOLS]) + (f" (+{more} more)" if more > 0 else "")

    with (common.RESULTS / "category_calibration_to_label.csv").open("w", newline="", encoding="utf8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["pair_id", "phrase", "category", "tools_that_would_count", "label", "notes"])
        for i, row in enumerate(chosen, 1):
            writer.writerow([f"C{i:03d}", row["phrase"], row["category"], tools_that_count(row["category"]), "", ""])
    with (common.RESULTS / "category_calibration_key.csv").open("w", newline="", encoding="utf8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["pair_id", "phrase", "category", "bi_encoder_rank", "bi_encoder_cosine", "reranker_logit",
                         "reranker_b_logit", "sample"])
        for i, row in enumerate(chosen, 1):
            writer.writerow([f"C{i:03d}", row["phrase"], row["category"], row.get("bi_encoder_rank", ""),
                             row.get("bi_encoder_cosine", ""), row["reranker_logit"], row.get("reranker_b_logit", ""), row["sample"]])
    kinds = Counter(r["sample"].split(" (")[0] for r in chosen)
    print(f"{len(chosen)} pairs, {len({r['phrase'] for r in chosen})} phrases, {len({r['category'] for r in chosen})} categories")
    for key in sorted(kinds):
        print(f"   {key}: {kinds[key]}")
    print("band edges (logit C):", [round(float(e), 2) for e in edges])


if __name__ == "__main__":
    main()
