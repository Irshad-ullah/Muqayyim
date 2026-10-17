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

## Variant 2 — ESCO phrase → O*NET technology category → tools (2026-10-17)

Change of approach requested before labelling variant 1: `results/calibration_to_label.csv` is **kept, unlabelled and
not used** for now. Still sandbox only; nothing is adopted.

| Step | Script | Status |
|---|---|---|
| 1. Feasibility of the O*NET categories | `category_feasibility.py` → `results/category_feasibility.{md,json}` | done |
| 2. Candidates (bi-encoder top 10 categories per phrase) + reranker scores | `category_rerank.py` → `results/category_pairs.csv`, `category_run.json` | — |
| 3. Calibration set (~100 phrase → category pairs) to label | `export_category_calibration.py` → `results/category_calibration_to_label.csv` | — |
| 4. Cut-off (≥ 95 % precision), then step D with 8 + 6 profiles | after the labels | not started |

### Step 1 findings

- Category column: **`Element Name`** (with `Element ID`, e.g. 2.E.x), e.g. "Configuration management software"
  (Perforce Helix, Puppet, Chef, IBM Terraform, …). **134 categories**; distinct tools per category **min 1 / median 14 /
  max 1,687** (mean 66.5; "Analytical or scientific software" holds 1,687); 8,753 distinct tools, 151 in more than one
  category.
- Mapping to canonical skill keys with the O*NET importer's own rule (`clean_onet_label` → a curated or alias name):
  **358 tools (4.1 %) → 331 distinct keys**; 74 categories have ≥ 1 mapped tool, 34 have ≥ 3; per-category mapped share
  min 0 % / median 1 % / max 70 %. The mapped tools sit in a few IT categories (Development environment 39, Data base
  user interface and query 30, Web platform development 29, Object or component oriented development 23, Data base
  management system 19, Program testing 18, Operating system 16, Application server 11, …).
- Caveats seen already: categories are coarse and sometimes mixed ("Application server software" holds GitHub, Docker,
  Kubernetes and WebLogic; "Enterprise application integration software" holds XML, Jenkins and Microsoft Teams), so a
  phrase → category link credits every mapped tool in that category. Holding a phrase therefore depends on how pure the
  category is, which the calibration labels judge directly.
