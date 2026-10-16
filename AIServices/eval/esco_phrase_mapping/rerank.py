#!/usr/bin/env python
"""
Module 5.1 — B. Reranker scores for ESCO essential phrase → described skill pairs (sandbox).

For each ESCO essential phrase (see common.py) take the TOP_K described skills by bi-encoder
cosine (bge-small, the same texts as the vector cache), then score every pair with the
cross-encoder BAAI/bge-reranker-base on CPU. The cross-encoder input is

    query   = "Does using {skill} demonstrate the ability to {phrase}?"
    passage = "{skill}: {curated description}"

and its score is the model's relevance probability (sigmoid of the logit; the raw logit is kept).
The model is downloaded once into ./models (git-ignored). Runtime and RAM are measured.
Output: results/reranker_pairs.csv and results/reranker_run.json. Nothing is written elsewhere.

Usage (repo root): AIServices/backend/venv/Scripts/python AIServices/eval/esco_phrase_mapping/rerank.py
"""

import csv
import json
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import common  # noqa: E402
import numpy as np  # noqa: E402

MODEL = "BAAI/bge-reranker-base"
TOP_K = 20
BATCH = 32


def question(skill: str, phrase: str) -> str:
    return f"Does using {skill} demonstrate the ability to {phrase}?"


def main():
    started = time.perf_counter()
    database = common.db()
    phrases = common.essential_phrases(database)
    skills = common.described_skills()
    descriptions = dict(skills)
    embedder = common.bi_encoder()
    names, pm, skill_names, sm = common.embed_phrases_and_skills(embedder, phrases, skills)
    sims = pm @ sm.T
    top = np.argsort(-sims, axis=1)[:, :TOP_K]
    pairs = [(names[i], skill_names[j], float(sims[i, j]), rank) for i in range(len(names)) for rank, j in enumerate(top[i], 1)]
    prepared = time.perf_counter()

    from sentence_transformers import CrossEncoder
    import torch

    common.MODELS.mkdir(exist_ok=True)
    load_started = time.perf_counter()
    model = CrossEncoder(MODEL, device="cpu", cache_folder=str(common.MODELS), max_length=256)
    load_seconds = time.perf_counter() - load_started
    mem_after_load = common.memory_mb()

    inputs = [(question(skill, phrase), f"{skill}: {descriptions[skill]}") for phrase, skill, _, _ in pairs]
    score_started = time.perf_counter()
    logits = model.predict(inputs, batch_size=BATCH, activation_fn=torch.nn.Identity(), show_progress_bar=False,
                           convert_to_numpy=True)
    score_seconds = time.perf_counter() - score_started
    probabilities = 1 / (1 + np.exp(-np.asarray(logits, dtype=np.float64)))
    current_mb, peak_mb = common.memory_mb()

    common.RESULTS.mkdir(exist_ok=True)
    with (common.RESULTS / "reranker_pairs.csv").open("w", newline="", encoding="utf8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["phrase", "esco_skill_type", "roles", "skill", "bi_encoder_rank", "bi_encoder_cosine",
                         "reranker_logit", "reranker_score"])
        for (phrase, skill, cos, rank), logit, prob in zip(pairs, logits, probabilities):
            writer.writerow([phrase, phrases[phrase]["skill_type"] or "", len(phrases[phrase]["roles"]), skill, rank,
                             f"{cos:.4f}", f"{float(logit):.4f}", f"{prob:.4f}"])

    best = probabilities.reshape(len(names), TOP_K).max(axis=1)
    run = {
        "model": MODEL, "device": "cpu", "torch_threads": torch.get_num_threads(), "top_k": TOP_K, "batch": BATCH,
        "phrases": len(names), "described_skills": len(skill_names), "pairs": len(pairs),
        "seconds": {"bi_encoder_and_candidates": round(prepared - started, 1), "reranker_load": round(load_seconds, 1),
                    "reranker_scoring": round(score_seconds, 1), "total": round(time.perf_counter() - started, 1)},
        "pairs_per_second": round(len(pairs) / score_seconds, 1),
        "ram_mb": {"after_reranker_load": mem_after_load[0], "current_after_scoring": current_mb, "peak": peak_mb},
        "score_distribution": {f">= {t}": int((probabilities >= t).sum()) for t in (0.5, 0.7, 0.8, 0.9, 0.95)},
        "phrases_with_a_candidate": {f">= {t}": int((best >= t).sum()) for t in (0.5, 0.7, 0.8, 0.9, 0.95)},
        "query_template": question("{skill}", "{phrase}"), "passage_template": "{skill}: {curated description}",
    }
    (common.RESULTS / "reranker_run.json").write_text(json.dumps(run, indent=2), encoding="utf8")
    print(json.dumps(run, indent=1))


if __name__ == "__main__":
    main()
