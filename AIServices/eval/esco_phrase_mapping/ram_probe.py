#!/usr/bin/env python
"""Module 5.1 — B (RAM): the reranker's memory on CPU, measured in a separate short run (the main
run's RAM reading failed — a ctypes bug, fixed in common.memory_mb). Loads bge-small and the
reranker like rerank.py and scores the first 500 pairs of results/reranker_pairs.csv."""

import csv
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import common  # noqa: E402


def main():
    import torch
    from sentence_transformers import CrossEncoder

    from rerank import MODEL, question

    base = common.memory_mb()
    common.bi_encoder()
    with_bi = common.memory_mb()
    model = CrossEncoder(MODEL, device="cpu", cache_folder=str(common.MODELS), max_length=256)
    with_reranker = common.memory_mb()
    descriptions = dict(common.described_skills())
    rows = list(csv.DictReader((common.RESULTS / "reranker_pairs.csv").open(encoding="utf8")))[:500]
    started = time.perf_counter()
    model.predict([(question(r["skill"], r["phrase"]), f"{r['skill']}: {descriptions[r['skill']]}") for r in rows],
                  batch_size=32, activation_fn=torch.nn.Identity(), show_progress_bar=False)
    seconds = time.perf_counter() - started
    after = common.memory_mb()
    out = {"ram_mb_current": {"start": base[0], "with_bi_encoder": with_bi[0], "with_reranker": with_reranker[0],
                              "after_scoring_500": after[0]},
           "ram_mb_peak": after[1], "pairs": len(rows), "pairs_per_second": round(len(rows) / seconds, 1)}
    (common.RESULTS / "reranker_ram.json").write_text(json.dumps(out, indent=2), encoding="utf8")
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
