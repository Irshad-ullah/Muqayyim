#!/usr/bin/env python
"""
Module 5.1 — variant 2, step 2: ESCO phrase → O*NET technology category candidates and reranker scores (sandbox).

For each ESCO essential phrase of the active roles (common.essential_phrases; the same 749 phrases as variant 1):
1. Bi-encoder (bge-small, the production embedder, loaded in this process): cosine between the phrase (embedded with the
   same text rule as the vector cache) and each category's text "{category}: e.g. {tool1}, {tool2}, {tool3}". All 134
   categories are candidates; the TOP_K = 10 are kept.
2. Cross-encoder BAAI/bge-reranker-base (CPU, the model already in ./models) scores every kept pair. The requested
   single question ("Does the ability '{phrase}' correspond to using {category} (e.g. ...)?") cannot be paired with a
   passage without repeating it: the first run (question | "{category}: tools") scored all 7,490 pairs >= 0.9, and the
   probe (category_probe.py, 24 hand-picked pairs) gave AUC 0.625. Two layouts that stop the echo are scored:
       C (primary)  query = "the ability '{phrase}'"
                    passage = "using {category} (e.g. {tool1}, {tool2}, {tool3})"                      probe AUC 0.993
       B            query = "Does the ability '{phrase}' correspond to using this software?"
                    passage = "{category} (e.g. {tool1}, {tool2}, {tool3})"                            probe AUC 0.951
   Scores are logits (C's probabilities sit close to 0, so bands use logit quantiles); probabilities are kept too.

Example tools: up to 3 per category — its most used tools that map to a canonical skill key first (shown with the
canonical spelling, e.g. "SQL"), then its most used other tools. "Most used" = listed for the most O*NET occupations.
Only categories with a mapped tool can ever credit a phrase; that is recorded per pair (mapped_tools) so the
calibration and step D can use it.

Output: results/category_pairs.csv, results/category_run.json. Nothing is written elsewhere.
Usage (repo root): AIServices/backend/venv/Scripts/python AIServices/eval/esco_phrase_mapping/category_rerank.py
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
from category_feasibility import load_categories, tool_key  # noqa: E402
from app.services.embeddings.descriptions import build_embed_text  # noqa: E402
from app.services.professions.cleaning import clean_onet_label  # noqa: E402

MODEL = "BAAI/bge-reranker-base"
TOP_K = 10
BATCH = 32
EXAMPLES = 3


def layout_c(phrase: str, category: str, tools):
    return f"the ability '{phrase}'", f"using {category} (e.g. {', '.join(tools)})"


def layout_b(phrase: str, category: str, tools):
    return f"Does the ability '{phrase}' correspond to using this software?", f"{category} (e.g. {', '.join(tools)})"


def category_table():
    """[{category, examples, mapped: {canonical key: tool label}, tools}] sorted by name."""
    table = []
    for name, entry in sorted(load_categories().items()):
        tools = entry["tools"]
        by_use = sorted(tools, key=lambda t: (-tools[t], t))
        mapped = {}
        for tool in by_use:
            key = tool_key(tool)
            if key and key not in mapped:
                mapped[key] = tool
        shown = [clean_onet_label(t) for t in mapped.values()][:EXAMPLES]
        shown += [t for t in by_use if t not in mapped.values()][:EXAMPLES - len(shown)]
        table.append({"category": name, "examples": shown, "mapped": mapped, "tools": len(tools)})
    return table


def main():
    started = time.perf_counter()
    phrases = common.essential_phrases(common.db())
    names = sorted(phrases)
    categories = category_table()
    embedder = common.bi_encoder()
    pm = np.asarray(embedder.embed_texts([build_embed_text(p).text for p in names]))
    cm = np.asarray(embedder.embed_texts([f"{c['category']}: e.g. {', '.join(c['examples'])}" for c in categories]))
    sims = pm @ cm.T
    top = np.argsort(-sims, axis=1)[:, :TOP_K]
    pairs = [(names[i], categories[j], float(sims[i, j]), rank) for i in range(len(names)) for rank, j in enumerate(top[i], 1)]
    prepared = time.perf_counter()

    from sentence_transformers import CrossEncoder
    import torch

    load_started = time.perf_counter()
    model = CrossEncoder(MODEL, device="cpu", cache_folder=str(common.MODELS), max_length=256)
    load_seconds = time.perf_counter() - load_started
    def score(layout):
        inputs = [layout(p, c["category"], c["examples"]) for p, c, _, _ in pairs]
        return np.asarray(model.predict(inputs, batch_size=BATCH, activation_fn=torch.nn.Identity(), show_progress_bar=False,
                                        convert_to_numpy=True), dtype=np.float64)

    score_started = time.perf_counter()
    logits = score(layout_c)
    score_seconds = time.perf_counter() - score_started
    logits_b = score(layout_b)
    score_b_seconds = time.perf_counter() - score_started - score_seconds
    probabilities = 1 / (1 + np.exp(-logits))
    _, peak_mb = common.memory_mb()

    common.RESULTS.mkdir(exist_ok=True)
    with (common.RESULTS / "category_pairs.csv").open("w", newline="", encoding="utf8") as handle:
        writer = csv.writer(handle)
        writer.writerow(["phrase", "esco_skill_type", "roles", "category", "examples", "category_tools", "mapped_tools",
                         "mapped_keys", "bi_encoder_rank", "bi_encoder_cosine", "reranker_logit", "reranker_score", "reranker_b_logit"])
        for (phrase, c, cos, rank), logit, prob, logit_b in zip(pairs, logits, probabilities, logits_b):
            writer.writerow([phrase, phrases[phrase]["skill_type"] or "", len(phrases[phrase]["roles"]), c["category"],
                             "; ".join(c["examples"]), c["tools"], len(c["mapped"]), "; ".join(sorted(c["mapped"])), rank,
                             f"{cos:.4f}", f"{float(logit):.4f}", f"{prob:.6f}", f"{float(logit_b):.4f}"])

    usable = np.array([bool(c["mapped"]) for _, c, _, _ in pairs])
    best = logits.reshape(len(names), TOP_K).max(axis=1)
    best_usable = np.where(usable, logits, -99).reshape(len(names), TOP_K).max(axis=1)
    cuts = (-4, -2, 0, 2, 4)
    run = {
        "model": MODEL, "device": "cpu", "torch_threads": torch.get_num_threads(), "top_k": TOP_K, "batch": BATCH,
        "phrases": len(names), "categories": len(categories),
        "categories_with_a_mapped_tool": sum(1 for c in categories if c["mapped"]), "pairs": len(pairs),
        "pairs_with_a_mapped_tool": int(usable.sum()),
        "seconds": {"bi_encoder_and_candidates": round(prepared - started, 1), "reranker_load": round(load_seconds, 1),
                    "reranker_scoring_c": round(score_seconds, 1), "reranker_scoring_b": round(score_b_seconds, 1),
                    "total": round(time.perf_counter() - started, 1)},
        "pairs_per_second": round(len(pairs) / score_seconds, 1), "ram_peak_mb": peak_mb,
        "logit_percentiles_c_1_10_50_90_99": [round(float(x), 2) for x in np.percentile(logits, [1, 10, 50, 90, 99])],
        "logit_percentiles_b_1_10_50_90_99": [round(float(x), 2) for x in np.percentile(logits_b, [1, 10, 50, 90, 99])],
        "spearman_c_vs_b": round(float(np.corrcoef(np.argsort(np.argsort(logits)), np.argsort(np.argsort(logits_b)))[0, 1]), 3),
        "logit_distribution_c": {f">= {t}": int((logits >= t).sum()) for t in cuts},
        "phrases_with_a_candidate_c": {f">= {t}": int((best >= t).sum()) for t in cuts},
        "phrases_with_a_usable_candidate_c": {f">= {t}": int((best_usable >= t).sum()) for t in cuts},
        "layout_c": list(layout_c("{phrase}", "{category}", ["{tool1}", "{tool2}", "{tool3}"])),
        "layout_b": list(layout_b("{phrase}", "{category}", ["{tool1}", "{tool2}", "{tool3}"])),
        "first_run_saturated": "question | '{category}: tools' -> all 7,490 pairs >= 0.9 (logit p1 4.09, median 7.55)",
        "category_text_for_bi_encoder": "{category}: e.g. {tool1}, {tool2}, {tool3}",
    }
    (common.RESULTS / "category_run.json").write_text(json.dumps(run, indent=2), encoding="utf8")
    print(json.dumps(run, indent=1))


if __name__ == "__main__":
    main()
