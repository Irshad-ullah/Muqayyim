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
| 2. Candidates (bi-encoder top 10 categories per phrase) + reranker scores | `category_rerank.py` → `results/category_pairs.csv`, `category_run.json`; input check `category_probe.py` → `results/category_probe.json` | done |
| 3. Calibration set (100 phrase → category pairs) to label | `export_category_calibration.py` → `results/category_calibration_to_label.csv` (+ `category_calibration_key.csv`); rule in `results/CATEGORY_CALIBRATION_README.md` | **waiting for labels** |
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

### Step 2 findings

- Candidates: 749 phrases × top 10 of 134 categories by bi-encoder cosine (phrase text as in the vector cache; category
  text "{category}: e.g. {3 tools}", mapped tools first in canonical spelling) = **7,490 pairs**, of which 4,920 are in a
  category with a mapped tool (74 categories). Bi-encoder + candidates: 16 s.
- **The requested single-question input saturated.** Putting "Does the ability '{phrase}' correspond to using {category}
  (e.g. …)?" in the query and the category with the same tools in the passage scored **all 7,490 pairs ≥ 0.9** (logit 1st
  percentile 4.1, median 7.6; 661 s): the passage repeats the query, so the cross-encoder sees near-total overlap. A probe
  of 24 hand-picked pairs (12 positive, 12 negative, chosen before scoring; `category_probe.py`) compared layouts:

  | Layout (query / passage) | Probe AUC |
  |---|---|
  | A — the question / "{category}: {tools}" (first run) | 0.625 |
  | B — "Does the ability '{phrase}' correspond to using this software?" / "{category} (e.g. {tools})" | 0.951 |
  | **C — "the ability '{phrase}'" / "using {category} (e.g. {tools})"** | **0.993** |
  | D — the question / empty passage | 0.667 |

  C is the primary score; B (closest to the requested wording) is kept in `reranker_b_logit` for comparison.
- Re-run with C and B (CPU, 4 threads): **C 462 s (16.2 pairs/s), B 845 s, total 1,331 s (22 min)**, peak RAM 2.1 GB.
  C logits: 1st / 10th / 50th / 90th / 99th percentile −10.2 / −9.8 / −7.7 / −5.7 / −3.1 (probabilities near 0, so the
  logit is used). Rank correlation C vs B 0.61. Phrases with a usable candidate (category with a mapped tool) at logit
  ≥ −4 / ≥ −2: 85 / 20.
- The top of the C ranking is mostly sensible (*use customer relationship management software* → CRM software;
  *integrated development environment software* → Development environment; *tools for software configuration
  management* → Configuration management) with visible misses (*speak different languages* → Voice recognition
  software; *utilise computer-aided software engineering tools* → CAD software). The labels decide.

### Step 3 — the calibration set (waiting for labels)

`results/category_calibration_to_label.csv`: **100 pairs**, 97 phrases, 48 categories, shuffled, no scores. Each row
shows the tools that would count, i.e. the category's tools that map to a canonical skill. Rule
(`results/CATEGORY_CALIBRATION_README.md`): **1 = using software in this category clearly demonstrates the ability**;
unsure → 0.
- Pool: pairs in a category with a mapped tool only, since only those can ever credit a phrase.
- 90 pairs over 10 **equal-width** bands of the C logit (−10.2 to 0.1, about 1.0 wide), 9 per band, with the top band's
  shortfall (5 available) passed down. 45 pairs lie above −5.05. Equal width replaced quantile bands, which put only 9
  pairs above −5.6, where the cut-off will be.
- At most 1 pair per phrase and 8 per category.
- 10 planted pairs, chosen by hand before scoring:
  - likely negatives: *comply with legal regulations* → Development environment; *intellectual property law* → Web
    platform development; *collaborate with designers* → Data base management system; *ensure legal gaming* → Object or
    component oriented development; *execute software tests* → Accounting;
  - likely positives: *execute software tests* → Program testing; *database management systems* → Data base management
    system; *design graphics* → Graphics or photo imaging; *tools for software configuration management* → Configuration
    management; *deploy cloud resource* → Cloud-based management.
- `category_calibration_key.csv` holds the C and B logits, the bi-encoder rank and the band for the same ids.

After the labels (step 4): the C cut-off for ≥ 95 % precision (B reported alongside), then step D. A phrase is held if
the user holds any tool in a mapped category that maps to a canonical key. Step D runs on the 8 existing + 6 new
profiles, with expectations committed first. The variant-1 numbers are reported only where they do not need labels.
