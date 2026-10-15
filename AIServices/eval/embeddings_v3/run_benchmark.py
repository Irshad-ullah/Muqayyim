#!/usr/bin/env python
"""
Benchmark v3 (09b2, Part 3): how to embed ESCO phrase / knowledge skills.

User side (always): "Name: curated description" (the production text).
ESCO side, three options:
  a  label only                                         (today's role-skill index)
  b  "label: first sentence of the ESCO description"    (first sentence, max 25 words)
  c  "label: full ESCO description"                     (max 60 words)

Model: the production embedder (BAAI/bge-small-en-v1.5), unit vectors, cosine.
"Related" = label 1 or 2; "unrelated" = label 0 (hard or easy negatives).

Per option, split (dev / held-out / all) and subset (all pairs / without pairs whose
ESCO description names the user skill):
  AUC (related vs unrelated), AUC vs hard negatives, Thr@P95 (lowest similarity at
  which >= 95 % of pairs called related are related, as in benchmark v2) and its
  recall, precision / recall at the current 0.73 threshold, score distributions by
  label, the 15 worst pairs, and how many related pairs pass with mutual_nn required
  against the real role-skill index rebuilt with that option's ESCO text.

Rules fixed before running (09b2):
  selection  highest dev AUC vs hard negatives; within 0.01 -> higher dev recall at P95
  threshold  the chosen option's dev Thr@P95
  guardrail  enable ESCO text / add a second threshold ONLY IF, on the held-out set,
             AUC vs hard(chosen) - AUC vs hard(a) >= 0.02 AND recall at 95 % precision
             (held-out Thr@P95) >= 0.90; otherwise keep the single 0.73 threshold.

Usage (AIServices venv, repo root; needs the model and ai_db):
  AIServices/backend/venv/Scripts/python AIServices/eval/embeddings_v3/run_benchmark.py
Writes results/results.json and results/report.md. Read-only on the database.
"""

import json
import os
import re
import sys
import time
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parents[1] / "backend"
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

import numpy as np  # noqa: E402
from pymongo import MongoClient  # noqa: E402

from app.config.settings import settings  # noqa: E402
from app.services.embeddings.descriptions import build_embed_text, get_description_provider  # noqa: E402
from app.services.embeddings.model import ModelManager  # noqa: E402
from app.services.embeddings.normalise import normalise_skill  # noqa: E402
from app.services.professions.cleaning import clean_esco_label  # noqa: E402
from app.services.professions.store import ESCO_SKILLS, PROFESSIONS, active_filter  # noqa: E402
from app.services.professions.role_skills import distinct_role_skills  # noqa: E402

OPTIONS = ("a", "b", "c")
OPTION_NAMES = {"a": "label only", "b": "label: first sentence (<=25 words)", "c": "label: full description (<=60 words)"}
CURRENT_THRESHOLD = 0.73
TIE = 0.01
MIN_GAIN, MIN_RECALL = 0.02, 0.90
MUTUAL_K = settings.MUTUAL_NN_K
BOOTSTRAP = 2000

_SENTENCE_END = re.compile(r"(?<=[.!?])\s+")


def words(text: str, limit: int) -> str:
    return " ".join(text.split()[:limit])


def first_sentence(description: str, limit: int = 25) -> str:
    text = " ".join((description or "").split())
    return words(_SENTENCE_END.split(text, maxsplit=1)[0], limit)


def esco_text(option: str, label: str, description: str) -> str:
    if option == "a" or not (description or "").strip():
        return label
    if option == "b":
        return f"{label}: {first_sentence(description, 25)}"
    return f"{label}: {words(' '.join(description.split()), 60)}"


# ── metrics ───────────────────────────────────────────────────────────────────
def auc(pos, neg):
    """P(pos > neg), ties count half (Mann-Whitney)."""
    pos, neg = np.asarray(pos), np.asarray(neg)
    if not len(pos) or not len(neg):
        return None
    greater = (pos[:, None] > neg[None, :]).sum()
    ties = (pos[:, None] == neg[None, :]).sum()
    return float((greater + 0.5 * ties) / (len(pos) * len(neg)))


def at_threshold(sims, related, t):
    called = sims >= t
    tp = int((called & related).sum())
    precision = tp / called.sum() if called.sum() else None
    recall = tp / related.sum() if related.sum() else None
    return precision, recall


def thr_at_precision(sims, related, target=0.95):
    """Lowest candidate threshold whose precision is >= target, and the recall there."""
    best = None
    for t in sorted(set(sims.tolist())):
        precision, recall = at_threshold(sims, related, t)
        if precision is not None and precision >= target:
            best = (t, recall, precision)
            break
    return best


def distribution(values):
    if not len(values):
        return None
    v = np.asarray(values)
    return {"n": int(len(v)), "mean": round(float(v.mean()), 3), "min": round(float(v.min()), 3),
            "p25": round(float(np.percentile(v, 25)), 3), "median": round(float(np.median(v)), 3),
            "p75": round(float(np.percentile(v, 75)), 3), "max": round(float(v.max()), 3)}


def metrics(rows, sims, dev_threshold=None):
    labels = np.array([r["label"] for r in rows])
    related = labels >= 1
    hard = np.array([r["negative"] == "hard" for r in rows])
    p95 = thr_at_precision(sims, related)
    out = {
        "n": len(rows),
        "auc": auc(sims[related], sims[~related]),
        "auc_hard": auc(sims[related], sims[hard]),
        "thr_p95": round(p95[0], 4) if p95 else None,
        "recall_p95": round(p95[1], 3) if p95 else None,
        "at_0.73": dict(zip(("precision", "recall"), map(lambda x: None if x is None else round(x, 3),
                                                         at_threshold(sims, related, CURRENT_THRESHOLD)))),
        "distribution": {
            "2": distribution(sims[labels == 2]),
            "1": distribution(sims[labels == 1]),
            "0 hard": distribution(sims[hard]),
            "0 easy": distribution(sims[(labels == 0) & ~hard]),
        },
    }
    if dev_threshold is not None:
        precision, recall = at_threshold(sims, related, dev_threshold)
        out["at_dev_threshold"] = {"threshold": round(dev_threshold, 4),
                                   "precision": None if precision is None else round(precision, 3),
                                   "recall": None if recall is None else round(recall, 3)}
    for key in ("auc", "auc_hard"):
        out[key] = None if out[key] is None else round(out[key], 4)
    return out


def bootstrap_gain(rows, sims_x, sims_a, seed=0):
    """95 % CI of AUC_hard(x) - AUC_hard(a), resampling related pairs and hard negatives separately."""
    labels = np.array([r["label"] for r in rows])
    pos = np.where(labels >= 1)[0]
    hard = np.array([i for i, r in enumerate(rows) if r["negative"] == "hard"])
    rng = np.random.default_rng(seed)
    gains = []
    for _ in range(BOOTSTRAP):
        p = rng.choice(pos, len(pos))
        h = rng.choice(hard, len(hard))
        gains.append(auc(sims_x[p], sims_x[h]) - auc(sims_a[p], sims_a[h]))
    return [round(float(np.percentile(gains, 2.5)), 4), round(float(np.percentile(gains, 97.5)), 4)]


# ── role-skill index per option (for mutual_nn) ──────────────────────────────
def role_skill_texts(db, option, provider):
    """{key: text} for every active role skill, as the index would embed it under `option`."""
    esco_desc = {}
    for doc in db[ESCO_SKILLS].find({}, {"label": 1, "description": 1}):
        key = normalise_skill(clean_esco_label(doc["label"]))[0]
        esco_desc.setdefault(key, (doc["label"], doc.get("description") or ""))
    professions = list(db[PROFESSIONS].find(active_filter(), {"profession_id": 1, "skills": 1}))
    texts = {}
    for key, name in distinct_role_skills(professions):
        if provider.lookup(name):
            texts[key] = build_embed_text(name, "description").text  # curated: same in every option
        elif key in esco_desc:
            texts[key] = esco_text(option, name, esco_desc[key][1])
        else:
            texts[key] = name
    return texts


def main():
    data = json.loads((HERE / "pairs.json").read_text(encoding="utf8"))
    pairs = data["pairs"]
    provider = get_description_provider()
    for p in pairs:
        assert provider.lookup(p["user_skill"]), p["user_skill"]

    manager = ModelManager()
    started = time.perf_counter()
    manager.load_sync()
    print(f"model {manager.model_name} loaded in {time.perf_counter() - started:.1f}s", file=sys.stderr)

    user_text = {p["user_skill"]: build_embed_text(p["user_skill"], "description").text for p in pairs}
    users = sorted(user_text)
    user_vec = dict(zip(users, manager.embed_texts([user_text[u] for u in users])))

    sims, texts_used = {}, {}
    for option in OPTIONS:
        texts = [esco_text(option, p["esco_label"], p["esco_description"]) for p in pairs]
        vecs = manager.embed_texts(texts)
        sims[option] = np.array([float(user_vec[p["user_skill"]] @ v) for p, v in zip(pairs, vecs)])
        texts_used[option] = texts

    subsets = {
        "all": lambda p: True,
        "without_tool_naming": lambda p: not p["esco_names_user_skill"],
    }
    splits = {"dev": lambda p: p["split"] == "dev", "heldout": lambda p: p["split"] == "heldout", "all": lambda p: True}

    results = {"model": manager.model_name, "pairs": len(pairs), "options": OPTION_NAMES, "metrics": {}}
    for subset, keep_subset in subsets.items():
        for option in OPTIONS:
            idx = {s: [i for i, p in enumerate(pairs) if keep_subset(p) and f(p)] for s, f in splits.items()}
            dev = metrics([pairs[i] for i in idx["dev"]], sims[option][idx["dev"]])
            dev_thr = dev["thr_p95"]
            block = {"dev": dev}
            for s in ("heldout", "all"):
                block[s] = metrics([pairs[i] for i in idx[s]], sims[option][idx[s]], dev_thr)
            results["metrics"].setdefault(subset, {})[option] = block

    # ── selection on dev (primary subset: all pairs) ──
    primary = results["metrics"]["all"]
    best_auc = max(primary[o]["dev"]["auc_hard"] for o in OPTIONS)
    tied = [o for o in OPTIONS if best_auc - primary[o]["dev"]["auc_hard"] <= TIE]
    chosen = max(tied, key=lambda o: (primary[o]["dev"]["recall_p95"] or 0, primary[o]["dev"]["auc_hard"]))
    held = primary[chosen]["heldout"]
    gain = round(held["auc_hard"] - primary["a"]["heldout"]["auc_hard"], 4)
    held_idx = [i for i, p in enumerate(pairs) if p["split"] == "heldout"]
    ci = bootstrap_gain([pairs[i] for i in held_idx], sims[chosen][held_idx], sims["a"][held_idx]) if chosen != "a" else [0.0, 0.0]
    passes = chosen != "a" and gain >= MIN_GAIN and (held["recall_p95"] or 0) >= MIN_RECALL
    results["decision"] = {
        "dev_auc_hard": {o: primary[o]["dev"]["auc_hard"] for o in OPTIONS},
        "tied_within_0.01": tied,
        "chosen": chosen,
        "chosen_dev_threshold": primary[chosen]["dev"]["thr_p95"],
        "heldout_auc_hard": {o: primary[o]["heldout"]["auc_hard"] for o in OPTIONS},
        "heldout_gain_vs_a": gain,
        "heldout_gain_vs_a_95ci": ci,
        "heldout_recall_p95": held["recall_p95"],
        "heldout_at_dev_threshold": held["at_dev_threshold"],
        "guardrail_passed": passes,
        "outcome": ("enable ESCO text option " + chosen) if passes else
                   "keep the single 0.73 threshold and label-only ESCO text (guardrail not met)",
    }

    # ── worst 15 pairs per option (all pairs, relative to the option's dev threshold) ──
    worst = {}
    for option in OPTIONS:
        t = primary[option]["dev"]["thr_p95"]
        scored = []
        for i, p in enumerate(pairs):
            s = sims[option][i]
            error = (s - t) if p["label"] == 0 else (t - s)
            scored.append((error, p, s))
        scored.sort(key=lambda x: -x[0])
        worst[option] = [{"id": p["id"], "user_skill": p["user_skill"], "esco_label": p["esco_label"],
                          "label": p["label"], "negative": p["negative"], "split": p["split"],
                          "similarity": round(float(s), 4), "error": round(float(e), 4),
                          "esco_text": texts_used[option][pairs.index(p)]}
                         for e, p, s in scored[:15]]
    results["worst"] = worst

    # ── mutual_nn against the real role-skill index rebuilt per option ──
    client = MongoClient(settings.MONGODB_URL)
    db = client[settings.AI_DB_NAME]
    mutual = {}
    try:
        for option in OPTIONS:
            role_texts = role_skill_texts(db, option, provider)
            keys = list(role_texts)
            matrix = manager.embed_texts([role_texts[k] for k in keys])
            position = {k: i for i, k in enumerate(keys)}
            t = primary[option]["dev"]["thr_p95"]
            counts = defaultdict(int)
            examples = []
            for i, p in enumerate(pairs):
                if p["label"] == 0:
                    continue
                key = normalise_skill(clean_esco_label(p["esco_label"]))[0]
                if key not in position:
                    counts["not_in_index"] += 1
                    continue
                counts["in_index"] += 1
                user_key = normalise_skill(p["user_skill"])[0]
                scores = matrix @ user_vec[p["user_skill"]]
                order = [keys[j] for j in np.argsort(-scores) if keys[j] != user_key][:MUTUAL_K]
                index_sim = float(scores[position[key]])
                above = index_sim >= t
                is_mutual = key in order
                counts["above_threshold"] += int(above)
                counts["above_threshold_and_mutual"] += int(above and is_mutual)
                if above and not is_mutual and len(examples) < 10:
                    examples.append(f"{p['user_skill']} -> {p['esco_label']} ({index_sim:.3f})")
            mutual[option] = {**counts, "threshold": t, "lost_by_mutual_examples": examples}
    finally:
        client.close()
    results["mutual_nn"] = {
        "note": f"For each related pair, the user is just that skill, so mutual_nn reduces to: the ESCO skill is among "
                f"the user skill's {MUTUAL_K} nearest role skills (1,428-skill index rebuilt with the option's ESCO text). "
                f"Threshold = the option's dev Thr@P95.",
        **mutual,
    }

    out_dir = HERE / "results"
    out_dir.mkdir(exist_ok=True)
    (out_dir / "results.json").write_text(json.dumps(results, indent=2, ensure_ascii=False) + "\n", encoding="utf8")
    (out_dir / "report.md").write_text(report(results), encoding="utf8")
    print(json.dumps(results["decision"], indent=2))


def report(r) -> str:
    lines = ["# Benchmark v3 — ESCO phrase / knowledge skills", "",
             f"Model: `{r['model']}` · {r['pairs']} pairs · user side \"Name: curated description\"", ""]
    for subset, title in (("all", "All pairs"), ("without_tool_naming", "Sensitivity: without pairs whose ESCO description names the user skill")):
        lines += [f"## {title}", "",
                  "| Option | Split | n | AUC | AUC vs hard | Thr@P95 | Recall@P95 | at dev thr (P / R) | at 0.73 (P / R) |",
                  "|---|---|---|---|---|---|---|---|---|"]
        for option in OPTIONS:
            for split in ("dev", "heldout"):
                m = r["metrics"][subset][option][split]
                dev_t = m.get("at_dev_threshold")
                dev_cell = f"{dev_t['precision']} / {dev_t['recall']}" if dev_t else "—"
                lines.append(f"| {option} ({OPTION_NAMES[option]}) | {split} | {m['n']} | {m['auc']} | {m['auc_hard']} | "
                             f"{m['thr_p95']} | {m['recall_p95']} | {dev_cell} | {m['at_0.73']['precision']} / {m['at_0.73']['recall']} |")
        lines.append("")
    lines += ["## Score distributions (all pairs, both splits)", "",
              "| Option | Label | n | mean | min | p25 | median | p75 | max |", "|---|---|---|---|---|---|---|---|---|"]
    for option in OPTIONS:
        for label, d in r["metrics"]["all"][option]["all"]["distribution"].items():
            if d:
                lines.append(f"| {option} | {label} | {d['n']} | {d['mean']} | {d['min']} | {d['p25']} | {d['median']} | {d['p75']} | {d['max']} |")
    lines += ["", "## Decision", "", "```", json.dumps(r["decision"], indent=2), "```", "",
              "## mutual_nn against the role-skill index", "", r["mutual_nn"]["note"], ""]
    for option in OPTIONS:
        m = r["mutual_nn"][option]
        lines.append(f"- **{option}**: related pairs in the index {m.get('in_index', 0)} (not in index {m.get('not_in_index', 0)}); "
                     f"above threshold {m.get('above_threshold', 0)}; above threshold **and** mutual {m.get('above_threshold_and_mutual', 0)}. "
                     f"Lost by mutual: {', '.join(m['lost_by_mutual_examples']) or '—'}")
    lines += ["", "## 15 worst pairs per option (relative to the option's dev Thr@P95)", ""]
    for option in OPTIONS:
        lines += [f"### Option {option}", "", "| id | user skill | ESCO skill | label | split | similarity | error |", "|---|---|---|---|---|---|---|"]
        for w in r["worst"][option]:
            tag = f"{w['label']}{' ' + w['negative'] if w['negative'] else ''}"
            lines.append(f"| {w['id']} | {w['user_skill']} | {w['esco_label']} | {tag} | {w['split']} | {w['similarity']} | {w['error']} |")
        lines.append("")
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    main()
