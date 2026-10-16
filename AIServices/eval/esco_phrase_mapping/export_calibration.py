#!/usr/bin/env python
"""
Module 5.1 — C. The calibration set to label (sandbox).

Samples ~150 phrase → skill pairs from results/reranker_pairs.csv, spread across the reranker score
(10 bands of 0.1, ~14 each, at most 2 pairs per phrase, seeded), plus PLANTED pairs: likely
negatives (React for "design user interface", the bi-encoder's generic picks such as Pascal for
"computer programming") and a few likely positives for contrast. Planted pairs that are not among
the candidates are scored with the reranker here.

BLIND LABELLING: calibration_to_label.csv has NO scores (shuffled, ids only) so the scores cannot
steer the labels; calibration_key.csv holds the scores for the same ids. After labelling, the
cut-off is chosen for >= 95 % precision (step D).

Usage (repo root): AIServices/backend/venv/Scripts/python AIServices/eval/esco_phrase_mapping/export_calibration.py
"""

import csv
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import common  # noqa: E402

SEED = 51
PER_BAND = 14
MAX_PER_PHRASE = 2
PLANTED = [
    ("design user interface", "React", "likely negative (named in the brief)"),
    ("computer programming", "Pascal", "likely negative (bi-encoder's nearest pick)"),
    ("web programming", "CoffeeScript", "likely negative (bi-encoder's nearest pick)"),
    ("develop with cloud services", "Codenvy", "likely negative (bi-encoder's nearest pick)"),
    ("manage system security", "Windows Administration", "likely negative (bi-encoder's nearest pick)"),
    ("design user interface", "Figma", "likely positive (contrast)"),
    ("deploy cloud resource", "Terraform", "likely positive (contrast)"),
    ("debug software", "Debugging", "likely positive (contrast)"),
]


def main():
    rows = list(csv.DictReader((common.RESULTS / "reranker_pairs.csv").open(encoding="utf8")))
    descriptions = dict(common.described_skills())
    rng = random.Random(SEED)
    bands = defaultdict(list)
    for row in rows:
        bands[min(int(float(row["reranker_score"]) * 10), 9)].append(row)

    chosen, per_phrase = [], Counter()
    for band in range(10):
        pool = bands[band][:]
        rng.shuffle(pool)
        taken = 0
        for row in pool:
            if taken >= PER_BAND:
                break
            if per_phrase[row["phrase"]] >= MAX_PER_PHRASE:
                continue
            chosen.append({**row, "sample": f"band {band / 10:.1f}–{(band + 1) / 10:.1f}"})
            per_phrase[row["phrase"]] += 1
            taken += 1

    index = {(r["phrase"], r["skill"]): r for r in rows}
    missing = [(p, s, note) for p, s, note in PLANTED if (p, s) not in index]
    scored = {}
    if missing:
        import numpy as np
        import torch
        from sentence_transformers import CrossEncoder

        from rerank import MODEL, question

        model = CrossEncoder(MODEL, device="cpu", cache_folder=str(common.MODELS), max_length=256)
        logits = model.predict([(question(s, p), f"{s}: {descriptions[s]}") for p, s, _ in missing],
                               activation_fn=torch.nn.Identity(), convert_to_numpy=True)
        for (p, s, _), logit in zip(missing, logits):
            scored[(p, s)] = 1 / (1 + float(np.exp(-logit)))
    phrases = common.essential_phrases()
    for phrase, skill, note in PLANTED:
        if any(c["phrase"] == phrase and c["skill"] == skill for c in chosen):
            continue
        base = index.get((phrase, skill))
        chosen.append({
            "phrase": phrase, "skill": skill,
            "esco_skill_type": (phrases.get(phrase) or {}).get("skill_type") or "",
            "roles": len((phrases.get(phrase) or {}).get("roles", [])),
            "bi_encoder_rank": base["bi_encoder_rank"] if base else "not in top 20",
            "bi_encoder_cosine": base["bi_encoder_cosine"] if base else "",
            "reranker_score": base["reranker_score"] if base else f"{scored[(phrase, skill)]:.4f}",
            "sample": f"planted: {note}",
        })

    rng.shuffle(chosen)
    with (common.RESULTS / "calibration_to_label.csv").open("w", newline="", encoding="utf8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["pair_id", "phrase", "skill", "skill_description", "label", "notes"])
        for i, row in enumerate(chosen, 1):
            writer.writerow([f"P{i:03d}", row["phrase"], row["skill"], descriptions.get(row["skill"], ""), "", ""])
    with (common.RESULTS / "calibration_key.csv").open("w", newline="", encoding="utf8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["pair_id", "phrase", "skill", "esco_skill_type", "roles", "bi_encoder_rank", "bi_encoder_cosine",
                         "reranker_score", "sample"])
        for i, row in enumerate(chosen, 1):
            writer.writerow([f"P{i:03d}", row["phrase"], row["skill"], row.get("esco_skill_type", ""), row.get("roles", ""),
                             row.get("bi_encoder_rank", ""), row.get("bi_encoder_cosine", ""), row["reranker_score"], row["sample"]])
    bands_count = Counter(r["sample"] for r in chosen)
    print(f"{len(chosen)} pairs, {len({r['phrase'] for r in chosen})} distinct phrases")
    for key in sorted(bands_count):
        print(f"   {key}: {bands_count[key]}")


if __name__ == "__main__":
    main()
