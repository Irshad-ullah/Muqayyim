# Module 5.1 — ESCO phrase → tool mapping (sandboxed experiment)

**Sandbox:** nothing in this folder changes production code, data or settings, and nothing is adopted. The database
is only read; models run in the experiment's own process; outputs go to `results/`. The reranker model is downloaded
once into `models/` (git-ignored, ~1.1 GB).

**Question:** ESCO roles are required to have ability phrases ("design user interface", "deploy cloud resource") that
a user never lists as such, so today they earn at most 0.5 (Module 5's ESCO bias). Can a phrase be mapped reliably to
the tools that demonstrate it, so that holding the tool counts as holding the phrase?

| Step | Script | Status |
|---|---|---|
| A. Diagnose option (b) from Module 5 | `diagnose_option_b.py` → `results/diagnosis.{md,json}` | done |
| B. Reranker scores (bge-reranker-base, CPU) | `rerank.py` → `results/reranker_pairs.csv`, `reranker_run.json`; RAM: `ram_probe.py` → `reranker_ram.json` | done |
| C. Calibration set to label | `export_calibration.py` → `results/calibration_to_label.csv` (+ `calibration_key.csv`) | **waiting for labels** |
| D. Cut-off (≥ 95 % precision) and evaluation with 8 + 6 profiles | after the labels | not started |
| E. Adopt nothing | — | — |

## How to label `results/calibration_to_label.csv`

147 pairs (shuffled; no scores shown, so the scores cannot steer the labels). For each row decide:

> **Does using {skill} demonstrate the ability to {phrase}?**

- `label` = **1** if a person who uses the skill (as described) clearly shows that ability — the skill is a direct way
  of doing what the phrase says (e.g. *deploy cloud resource* ← Terraform).
- `label` = **0** if it does not: a different job, only loosely related, or a generic phrase that the one tool does not
  cover on its own (e.g. *computer programming* ← Pascal, *design user interface* ← React).
- If you are unsure, put **0** and a word in `notes` (the cut-off aims at ≥ 95 % precision, so doubtful pairs should
  count as negatives).

`calibration_key.csv` has the reranker and bi-encoder scores for the same `pair_id`s; please do not look at it while
labelling.
