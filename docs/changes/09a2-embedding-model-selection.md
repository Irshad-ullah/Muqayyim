# 09a2 — Embedding model selection: BAAI/bge-small-en-v1.5 with curated skill descriptions

**Status:** implemented · **Date:** 2026-10-14 · **Revised:** 2026-10-14 ([v2](#revision-v2--hard-negatives-threshold-073)) · **Affects:** AIServices (embedding layer), the skill-embeddings card in the frontend
**Builds on:** [09a — skill embeddings](09a-skill-embeddings.md) · **Benchmarks:** [v1 `embedding-benchmark-2026-10-13/`](../evaluation/embedding-benchmark-2026-10-13/report.md), [v2 `embedding-benchmark-2026-10-14/`](../evaluation/embedding-benchmark-2026-10-14/report.md)

## Summary

- **New model:** skill vectors now come from **`BAAI/bge-small-en-v1.5`**, replacing all-MiniLM-L6-v2.
- **New text:** each skill is embedded as **"Name: description"**, using a curated, hand-reviewed description where one exists. Skills without one fall back to the bare name.
- **Cache identity:** a stored vector is identified by the exact text embedded, so a changed description is re-embedded automatically.
- **Matching rule** (for Module 5; no matching is built yet): same canonical key → matched (credit 1.0); else cosine ≥ **0.73** → related (credit 0.5); else missing. The threshold was 0.72 from benchmark v1 and was raised to 0.73 after benchmark v2 added hard negatives; see [Revision (v2)](#revision-v2--hard-negatives-threshold-073).
- **Delivered as two commits:**
  - **Stage 1** (`00da5d7`): 985 curated descriptions, their quality checks, and alias alignment.
  - **Stage 2** (this commit): the model and text switch, the description providers, cache invalidation, unknown-skill reporting, the threshold config, the re-embed migration, and "x of y described" on the card.


## Revision (v2) — hard negatives, threshold 0.73

**Benchmark v2** (2026-10-14, [`docs/evaluation/embedding-benchmark-2026-10-14/`](../evaluation/embedding-benchmark-2026-10-14/report.md)) re-ran the two eligible models on an extended test set.

**What v1 lacked:** most of its 245 pairs' negatives were easy: tech vs non-tech, or unrelated domains. It had **few same-field negatives**, i.e. two technical skills from different areas that a CV commonly lists together. Those are exactly the pairs career matching must not call "related". v2 adds **92 hard negatives** (e.g. React–Python, Docker–Pandas, Figma–SQL), giving 337 pairs: 102 strong, 71 related, 164 unrelated.

### v2 results: related vs technical skills from different areas

| Model | Text | AUC (all) | AUC vs hard neg | Hard neg mean | Hard neg max | Thr@P95 | Recall@P95 | Thr@P90 | Recall@P90 | Recall@5 | MRR |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **bge-small-en-v1.5** | **description** | **0.993** | **0.990** | **0.651** | **0.786** | **0.733** | **0.94** | **0.703** | **1.00** | **0.720** | **0.927** |
| all-MiniLM-L6-v2 | description | 0.995 | 0.994 | 0.160 | 0.378 | 0.329 | 0.97 | 0.269 | 0.99 | 0.689 | 0.920 |
| all-MiniLM-L6-v2 | name | 0.886 | 0.900 | 0.145 | 0.360 | 0.323 | 0.62 | 0.282 | 0.71 | 0.383 | 0.680 |
| bge-small-en-v1.5 | name | 0.857 | 0.848 | 0.571 | 0.695 | 0.677 | 0.56 | 0.636 | 0.72 | 0.333 | 0.621 |

Thr@P95 is the lowest similarity at which at least 95% of pairs called "related" really are related.

bge-small's similarities sit in a high, narrow band: hard negatives average 0.651 against 0.822 for related pairs. The threshold therefore has to be precise, but the ranking is as good as MiniLM's.

### Decision: keep bge-small-en-v1.5

- **The models are otherwise close.** With descriptions, both are excellent against hard negatives (0.990 vs 0.994) and the differences on our own small test set are small.
- **bge-small retrieves neighbours better:** Recall@5 0.720 vs 0.689 and MRR 0.927 vs 0.920. Neighbour retrieval is what the skill map and future suggestions use.
- **No re-embed was needed.** The model and text mode are unchanged.
- **Bare names don't favour bge-small** (0.857 vs MiniLM 0.886), but they are only the fallback for undescribed skills (see the correction under "Why not MiniLM").

### Threshold change: 0.72 → 0.73

| | v1 (0.72) | v2 (0.73) |
|---|---|---|
| Basis | best related/unrelated split on 245 pairs | lowest threshold with ≥ 95% precision on 337 pairs incl. 92 hard negatives (0.733) |
| Precision / recall | 0.98 / 0.98 (v1 pairs) | **0.95 / 0.94** (v2 pairs) |
| Alternative | — | 0.703 for ≥ 90% precision with 100% recall |

- `EMBEDDING_RELATED_THRESHOLD` is now **0.73**: the setting default, `.env.example` and the local `.env`.
- `thresholdModel` / `thresholdTextMode` stay `BAAI/bge-small-en-v1.5` / `description`, and `get_related_threshold()` still refuses the value for any other combination.
- The slow real-model test asserts cos(React, Next.js) 0.889 > 0.73 > cos(React, Accounting) 0.646, and cos(Celery, Cooking) 0.580 < 0.73.

### Known false positives (limitations)

Measured with the real model on the curated text; descriptions were **not** edited.

| Pair | Similarity | Why it scores high |
|---|---|---|
| React ↔ Python | 0.776 (≈ 0.78) | both are very common developer skills, and their descriptions share web and application vocabulary |
| Redux ↔ Redis | 0.744 | near-identical names and overlapping "state"/"store" wording |

Both are recorded as **strict expected failures** in the slow test, with the measured value in the reason. If a future change pushes either below 0.73, the test reports XPASS so the note gets updated.

Matching will see about 5% false "related" calls at this threshold; they affect half credit only, never full matches. **Module 5 may add a mutual-nearest-neighbour check** to reduce them: count a pair as related only if each skill is among the other's top-k neighbours, as well as above 0.73.

### Files

- `docs/evaluation/embedding-benchmark-2026-10-14/`: the v2 `report.md`, `results.json` and `similarity_by_label.png`, copied unchanged.
- **Code:** threshold default and docstring (`app/config/settings.py`, `app/services/embeddings/matching_config.py`), `.env.example`, the threshold assertions in `tests/test_embeddings_descriptions.py`, and the slow tests in `tests/test_embeddings.py`.
- No other code changed.

## Benchmark method

A standalone benchmark (2026-10-13) compared 5 models, each with two kinds of text: the bare **name**, and **"Name: description"**.

**Data** (`docs/evaluation/embedding-benchmark-2026-10-13/`; the 283 descriptions are `AIServices/data/benchmark_seed_skills.json`):
- 283 skills, each with a short description.
- **245 labelled skill pairs:** 2 = strongly related (e.g. React ↔ Next.js), 1 = related or an alternative (e.g. MySQL ↔ PostgreSQL), 0 = unrelated. There are deliberate hard cases, such as name overlaps ("Redux" vs "Redis") and tech vs non-tech pairs.
- **42 neighbour queries:** for a skill, are the expected skills among its top 5 neighbours out of 283?

**Metrics:**
- ROC-AUC for related vs unrelated (label ≥ 1 vs 0) and for strong vs the rest;
- Spearman correlation with the labels;
- Recall@5 and MRR on the neighbour queries;
- separation (Cohen's d);
- the best "related" threshold, with its precision and recall;
- RAM and ms per skill.

**Selection rule** (fixed before running): the highest average of ROC-AUC(related) and Recall@5, with RAM ≤ 1.5 GB and ≥ 100 skills/second; within 0.02, prefer the smaller model.

### Results

| Model | Text | Score | AUC related | AUC strong | Spearman | Recall@5 | MRR | Related thr. (P/R) | RAM MB | ms/skill | Eligible |
|---|---|---|---|---|---|---|---|---|---|---|---|
| qwen3-embedding-0.6b | description | 0.869 | 0.997 | 0.855 | 0.776 | 0.740 | 0.945 | 0.585 | 1880 | 638.75 | no (speed, RAM) |
| **bge-small-en-v1.5** | **description** | **0.858** | **0.996** | **0.807** | **0.723** | **0.720** | **0.927** | **0.720 (0.98/0.98)** | **621** | **5.65** | **yes** |
| bge-base-en-v1.5 | description | 0.849 | 0.998 | 0.835 | 0.754 | 0.700 | 0.964 | 0.685 | 941 | 21.87 | no (speed) |
| all-MiniLM-L6-v2 | description | 0.842 | 0.996 | 0.806 | 0.721 | 0.689 | 0.920 | 0.375 | 574 | 2.89 | yes |
| gte-modernbert-base | description | 0.816 | 0.980 | 0.812 | 0.715 | 0.652 | 0.903 | 0.673 | 761 | 330.51 | no |
| qwen3-embedding-0.6b | name | 0.840 | 0.991 | 0.850 | 0.766 | 0.688 | 0.937 | 0.602 | 1880 | 405.17 | no |
| bge-base-en-v1.5 | name | 0.676 | 0.921 | 0.773 | 0.627 | 0.432 | 0.738 | 0.580 | 941 | 6.25 | yes |
| all-MiniLM-L6-v2 | name | 0.626 | 0.869 | 0.720 | 0.528 | 0.383 | 0.680 | 0.288 | 574 | 1.09 | yes |
| bge-small-en-v1.5 | name | 0.601 | 0.869 | 0.718 | 0.526 | 0.333 | 0.621 | 0.629 | 621 | 1.97 | yes |
| gte-modernbert-base | name | 0.596 | 0.834 | 0.714 | 0.495 | 0.357 | 0.604 | 0.679 | 761 | 88.74 | no |

embeddinggemma-300m could not run, because it is a gated repository.

### Why descriptions

For **every** model, embedding "Name: description" instead of the bare name:
- raised related-vs-unrelated ROC-AUC from about 0.83–0.92 to **about 0.98–0.998**;
- roughly **doubled Recall@5** (bge-small went from 0.333 to 0.720).

Bare skill names are short and ambiguous ("Celery", "Spring", "Unity", "R"), so a sentence saying what the skill is gives the model the meaning it needs.

### Why bge-small-en-v1.5

- **Strongest eligible configuration:** AUC 0.996, AUC-strong 0.807, Spearman 0.723, Recall@5 0.720, MRR 0.927, at about 5.7 ms/skill and about 620 MB of process RAM in the benchmark.
- **Why not MiniLM:** the script's tie-break picked all-MiniLM-L6-v2, which is only 47 MB smaller with a score 0.016 lower. That tie-break was meant for large size gaps, so we override it: bge-small has the higher Recall@5 (0.720 vs 0.689) and MRR.
  - *Correction (v2):* an earlier version also claimed bge-small had "a related threshold with much better separation". Neither round supports that: with descriptions, separation is about equal (v2 d 3.89 vs 3.90) and MiniLM is slightly ahead against hard negatives.
  - *Bare names:* bge-small was **not** better there either (v1 AUC 0.869 for both; v2 **0.857 vs MiniLM 0.886**). Bare names are only a fallback for undescribed skills.
- **Why not the others:** Qwen3-0.6B was about 100× slower and 3× larger. bge-base and gte-modernbert were slower without being better on the selection score.

## The related threshold and the exact-key rule

- **The threshold (v1):** for bge-small with description text, **0.72** separates related (label ≥ 1) from unrelated pairs with **precision 0.98 and recall 0.98** on the v1 pairs.
  - **Current: 0.73.** Benchmark v2 showed the v1 set had few same-field negatives; the lowest threshold with ≥ 95% precision is 0.733. See [Revision (v2)](#revision-v2--hard-negatives-threshold-073).
- **No "strong match" threshold:** none is reliable. Alternatives score as high as or higher than strongly related pairs (MySQL ↔ PostgreSQL 0.96, Tableau ↔ Power BI 0.918, React ↔ Vue.js 0.904; Wireframing ↔ Prototyping, labelled strong, is only 0.72). So:

```
same canonical key                → matched  (credit 1.0)
else cosine ≥ relatedThreshold    → related  (credit 0.5)
else                              → missing  (credit 0)
```

- **Configuration:** `embedding.relatedThreshold = 0.73` (0.72 before v2), `thresholdModel = "BAAI/bge-small-en-v1.5"`, `thresholdTextMode = "description"`. These are settings (`EMBEDDING_RELATED_THRESHOLD`, `EMBEDDING_THRESHOLD_MODEL`, `EMBEDDING_THRESHOLD_TEXT_MODE`).
- **`get_related_threshold()`** (`app/services/embeddings/matching_config.py`) returns the threshold only when the active model and text mode equal the measured ones. Otherwise it logs a warning ("re-measure the threshold") and returns `None`.
- **No matching is implemented yet.** The rule is documented in that module's docstring for Module 5.

**Known false positive (v1): Redux ↔ Redis = 0.744** (labelled unrelated). It was measured with the benchmark's exact text, and the format check below reproduces the benchmark's published numbers. It is one of the about 2% false positives behind precision 0.977. The slow test records it as a strict expected failure (`xfail(strict=True)` with the measured value), so it stays visible; it would only be "fixed" by changing the seed descriptions, which must stay as calibrated. Benchmark v2 adds React ↔ Python (0.776) as a second known false positive at 0.73.

## The curated description file (Stage 1, `00da5d7`)

`AIServices/backend/app/data/skill_descriptions.json` holds **985 skills**:
- **283 benchmark seed entries**, copied exactly (the threshold was calibrated on them);
- **702 new entries** in the same style, covering every alias-file canonical name, every CV-parser vocabulary skill, and common IT and non-IT skills for entry-level roles. `app/data/skill_categories.json` tags each one for review.

| Category | Count | Category | Count |
|---|---|---|---|
| cloud-devops | 88 | backend | 72 |
| professional-non-it | 80 | data | 71 |
| ai-ml | 64 | frontend | 59 |
| databases | 53 | programming-languages | 53 |
| testing-qa | 52 | security | 50 |
| cs-concepts | 49 | design-ux | 49 |
| game-embedded-iot-blockchain | 46 | project-agile-tools | 44 |
| cms-ecommerce-marketing | 42 | networking-sysadmin | 42 |
| soft-skills | 39 | mobile | 32 |

**Style rules** (checked by `AIServices/scripts/check_skill_descriptions.py`, which also runs as a unit test):
- 8–20 words, plain factual English;
- say what the skill is, its language or platform, and what it's used for;
- no lists of competitors or alternatives, and at most 2 other skill names per description;
- no marketing words (powerful, popular, best, leading, modern, easy, seamless, cutting-edge), no versions, no dates;
- ambiguous names are disambiguated (Spring = Java framework, Celery = Python task queue, Unity = game engine, Go / R / Swift = programming languages).

**Alias alignment** (so the seed names are the canonical names):
- Spring / Spring Boot, Shell Scripting / Bash, Information Security / Cybersecurity and Docker Compose / Docker are now separate skills.
- Excel, Kafka, Airflow, ASP.NET Core and Computer Networking are canonical. The previous names (Microsoft Excel, MS Excel, Apache Kafka, Apache Airflow, ASP.NET, Networking) remain aliases.

**Descriptions are embedding text only.** The CV parser keeps its own short vocabulary, and tests ensure the extractor never reads the file, and that "linear regression" or "sanity testing" never produce the skills "Linear" or "Sanity".

## Implementation (Stage 2)

**Model.** `EMBEDDING_MODEL` defaults to `BAAI/bge-small-en-v1.5`.
- There is no instruction prefix, because skill-to-skill similarity is symmetric.
- The dimension is **read from the loaded model** (`None` while loading); there is no hard-coded 384 anywhere. The fake test embedder takes a `dimension`, and tests run end to end at 384 and 768.

**Text to embed** (`app/services/embeddings/descriptions.py`): `build_embed_text(canonical)` returns `"{canonical}: {description}"` when a description exists, else `"{canonical}"`. `EMBEDDING_TEXT_MODE=description` is the default; `name` embeds bare names.

**Description providers** are designed for future sources:

```
DescriptionProvider.lookup(canonical) -> {description, source} | None
ChainedProvider([CuratedFileProvider(), …later: EscoProvider, OnetProvider, LlmProvider…])   # first hit wins
```

- `CuratedFileProvider` is loaded and validated at startup: valid JSON, non-empty text, canonical names, unique keys. **An invalid file stops startup** with a critical log ("Invalid skill description file: …").
- ESCO, O*NET or LLM providers can be appended to the chain later. `description_source` on each vector records which provider supplied the text.

**Cache identity** (`app/services/embeddings/vector_store.py`):
- `skill_vectors` documents are unique on **(key, model, text_mode, text_hash)**, where `text_hash = sha256(embedded_text)`:
  ```json
  { "key": "celery", "name": "Celery", "vector": ["… 384 floats …"],
    "model": "BAAI/bge-small-en-v1.5", "text_mode": "description",
    "embedded_text": "Celery: Python distributed task queue for running background jobs",
    "text_hash": "9f2c…", "has_description": true, "description_source": "curated",
    "created_at": "2026-10-13T15:10:11Z" }
  ```
- A lookup returns a vector only if its model, mode and hash match the text that would be embedded now. A **changed description is re-embedded on next use**, and the stale entry is deleted once the new one is stored. 09a-era documents (no `text_mode` or `text_hash`) are never served.
- The old `key_model_unique` index is dropped and the new index created at startup.

**User skill profiles** now also store `text_mode`. A record counts as ready only when its model **and** text mode are current.

**Skills without a description** are embedded by name with `has_description: false`. Each distinct one is logged once (info level, deduplicated in memory), so the curated file can be extended. Two endpoints report them:
- `GET /api/embeddings/health` adds `text_mode` and `skills: { total, described, undescribed }` for the current model and mode;
- `GET /internal/embeddings/unknown-skills` (X-Internal-Key, blocked at the gateway) returns `{ key, name, users }` for each undescribed skill, most-used first, for a future admin view.

**Status card:** `GET /api/embeddings/me` adds `described_count` and `text_mode`. The card shows the model name and **"x of y skills described"**. The skill map now uses the new vectors; its helper text is unchanged.

A label-collision fix was also made to the map. With the new vectors, the "Machine Learning" and "Accounting" points sat close together and their labels overlapped, so a label now moves below its point when it would collide with an earlier one.

**Re-embedding** (`AIServices/scripts/reembed_all.py [--dry-run]`, logic in `app/services/embeddings/reembed.py`):
1. Collect every key in `skill_vectors` (under any model or mode) and every key in `user_skill_profiles`, **re-normalised with the current aliases**, so "Apache Kafka" becomes "Kafka".
2. Embed each skill missing for the current model, mode and text.
3. **Only after all new vectors are written**, delete vectors of other models or modes and stale hashes.
4. Re-normalise each profile's skills and set its **`model`, `text_mode` and `embedding_status`**.

It reports counts before and after plus the time taken. A dry run writes nothing, and a second run does nothing.

**Requirements:** **no new packages.** bge-small runs on the installed sentence-transformers 6.1.0 and torch 2.14.1+cpu. The model downloads once into `EMBEDDING_CACHE_DIR` (the cache grew from 88 to 216 MB, so about 128 MB for bge-small) and then loads offline.

## Verification

**Text format check:** encoding the seed skills as "Name: description" with bge-small reproduces the benchmark's published similarities to **within 0.0003** on average:

| Pair | Benchmark | Here |
|---|---|---|
| MySQL ↔ PostgreSQL | 0.96 | 0.960 |
| Tableau ↔ Power BI | 0.918 | 0.918 |
| React ↔ Vue.js | 0.904 | 0.904 |
| Wireframing ↔ Prototyping | 0.72 | 0.720 |
| Sass ↔ Apache Spark | 0.469 | 0.469 |

Other formats (description only; "Name. description"; newline-separated) differ by 0.02–0.04, so the embedded text exactly matches the calibration.

**Real model test** (`pytest -m slow`):
- at the original 0.72 threshold, passing: cos(React, Next.js) = **0.889** > 0.72 > cos(React, Accounting) = **0.646**; cos(Celery, Cooking) = **0.580** < 0.72 (re-checked at 0.73 in [Revision (v2)](#revision-v2--hard-negatives-threshold-073));
- recorded as a strict expected failure: cos(Redux, Redis) = **0.744**.

**Measurements on this machine** (Windows, CPU, model from the local cache with downloads forbidden):
- **Model load:** **1.0–1.2 s** for the cached model, after importing torch and sentence-transformers (7 s on the 13th; 21 s today under heavier machine load).
- **RAM:** process RSS with the model loaded is **568 MB** (+525 MB over a bare Python process). The live AIServices process, with spaCy as well, used **about 630 MB**.
- **Speed:** **21 ms per described skill** today (200 skills in 4.2–4.4 s). On the same machine at the same moment, MiniLM took 10.7 ms/skill on the same texts. That ratio (2.0×) matches the benchmark's (5.65 / 2.89 = 1.96×), so the absolute numbers mainly reflect today's machine load; the benchmark's 5.7 ms/skill was measured under lighter load. A profile change embeds only new skills, so this is a one-time cost per skill.

**Re-embed run** on the dev `ai_db`:
1. Before the switch, the test user's 7 skills were added through the Profile Builder under the **old** setup (MiniLM, name text).
2. The dry run reported 7 keys to embed and wrote nothing.
3. The real run reported:
   ```
   before: vectors_total 7, vectors_current 0, vectors_other 7, profiles_current 0
   embedded 7, vectors_removed 7, profiles_updated 1
   after:  vectors_total 7, vectors_current 7, vectors_other 0, profiles_current 1
   seconds 0.37  (plus the model load)
   ```

**Live check** (UI :5175 → gateway :8180 → Core :3100 / AI :8100): **13 of 13 passed** (2 before the migration, 11 after).
- **Profile Builder:** React, Next.js, Docker, Accounting, Python, Machine Learning and "Zorblax" were saved under the old setup and the profile reached `done`.
- **After the re-embed:**
  - only `BAAI/bge-small-en-v1.5` / `description` vectors remain;
  - `has_description` is true for the 6 real skills and **false for Zorblax** (embedded as "Zorblax", no source);
  - React's text is "React: JavaScript library for building component-based user interfaces for web applications";
  - the profile's `model`, `text_mode` and `embedding_status` are updated.
- **Unknown skills:** `GET /internal/embeddings/unknown-skills` returned `[{key: "zorblax", name: "Zorblax", users: 1}]`, and the same path is a 404 through the gateway. Health showed `skills {total 7, described 6, undescribed 1}` and dimension 384.
- **Status card:** Ready, model **bge-small-en-v1.5**, **"6 of 7 skills described"**.
- **Closest pairs:** React ↔ Next.js **0.89**, Python ↔ Machine Learning **0.81**, React ↔ Python **0.78**. These look sensible: a framework and its library, a language and its main field, then two very common developer skills. Zorblax sits far from everything.
- **Cleanup:** admin deletion removed the user's skill record. Test users, logs and all vectors created were deleted, leaving `skill_vectors` and `user_skill_profiles` empty.

**Test suites:**

| Suite | Before | After |
|---|---|---|
| AIServices pytest | 238 (after Stage 1: 265) | **289 passed, 1 skipped, 2 slow deselected** |
| Slow real-model tests (`-m slow`) | 1 | **1 passed + 1 xfailed** (Redux ↔ Redis, above) |
| Core Jest / Gateway Jest | 220 / 46 | 220 / 46 (unchanged) |
| Frontend node / Vitest | 25 / 20 | 25 / **21** |

New in `test_embeddings_descriptions.py` (24 tests):
- build_embed_text in description mode (with and without a description) and in name mode;
- unknown skills logged once;
- the provider chain uses the first hit, and an invalid curated file fails fast (6 cases);
- vector documents record their embedded text and hash;
- a changed description is re-embedded, the old entry is removed and never returned;
- description and name modes never mix, and 09a-era documents are ignored;
- the unknown-skills endpoint (key required, user counts) and the described counts in `/health` and `/me`;
- dimensions 384 and 768 work end to end, and the dimension is `None` until loaded;
- the threshold is returned only for the measured model and mode;
- the defaults;
- the re-embed migration: old model, name text and an old alias name become new-model description vectors, the profile is renamed and updated, the matrix resolves, and a second run does nothing.

`test_embeddings.py` now compares against the described texts, expects the record's `text_mode`, and expects old-model vectors to be gone after a re-embed.

## Limitations

- **The test set is our own:** 245 pairs and 42 queries, labelled by us. Numbers on real CVs may differ, and the threshold should be re-checked once matching data exists.
- **Undescribed skills fall back to bare names,** where the benchmark shows about 0.87 AUC instead of 0.996. The unknown-skills endpoint and the once-per-skill log show which descriptions to add next.
- **The threshold is valid only for bge-small-en-v1.5 with description text.** `get_related_threshold()` enforces this. Any model or text-mode change means re-measuring the threshold, and changing seed descriptions would invalidate it.
- **About 5% false positives at 0.73** (v2 precision 95% with hard negatives). Known examples: React ↔ Python 0.776, Redux ↔ Redis 0.744. Exact-key matching keeps full credit safe; only "related" (half credit) is affected. See [Revision (v2)](#revision-v2--hard-negatives-threshold-073).
- **Speed depends on the machine.** On this machine today: 21 ms per described skill.

## Suggested SDS updates

**§4.2: add an "Embedding model evaluation" subsection with both benchmark rounds:**
- the v1 results table above;
- the v2 hard-negative table (in [Revision (v2)](#revision-v2--hard-negatives-threshold-073));
- the selection rule;
- this text:
> "Embedding models were evaluated in two rounds on a hand-labelled set of skill pairs and neighbour queries over 283 described skills.
>
> Round 1 (245 pairs) compared five models with bare-name and 'Name: description' text. Descriptions raised related-vs-unrelated ROC-AUC from about 0.87 to about 0.996 for every model.
>
> Round 2 (337 pairs) added 92 hard negatives: technical skills from different areas, such as React–Python. BAAI/bge-small-en-v1.5 with descriptions reached ROC-AUC 0.993 overall and 0.990 against hard negatives, Recall@5 0.720 and MRR 0.927. all-MiniLM-L6-v2 was comparable (0.994 against hard negatives, Recall@5 0.689). bge-small-en-v1.5 was kept for its better neighbour retrieval.
>
> A skill is 'related' at cosine ≥ 0.73, the lowest threshold with at least 95% precision (94% recall). Full matches come only from identical canonical skills. Known false positives (e.g. React–Python) may be reduced with a mutual-nearest-neighbour check."

**Table 4.2 (technologies):** replace all-MiniLM-L6-v2 with **BAAI/bge-small-en-v1.5** (384-dim, CPU, sentence-transformers 6.1.0, PyTorch 2.14.1 CPU build), described as "skill embeddings on 'Name: description' text; curated description file of 985 skills".

**§3.5 (data design), `skill_vectors`:**
> `{ key, name, vector[model dimension], model, text_mode, embedded_text, text_hash, has_description, description_source, created_at }`, unique on (key, model, text_mode, text_hash). `user_skill_profiles` gains `text_mode`.
>
> A vector is valid only for the exact text it embeds; a description change or a model or text-mode change leads to re-embedding (`reembed_all.py`).
