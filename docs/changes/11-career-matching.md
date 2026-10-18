# 11 — Semantic Career Matching (Module 5)

**Requirements:** SRS Module 5 FE-1 … FE-7, FR7.1 … FR7.10, Mockup M6 · builds on 09a / 09a2 / 09b / 09b2 (skill
embeddings, the frozen configuration, professions and the role-skill index) and 09c (the taxonomy pipeline).

**Commits (main, not pushed):** ESCO selection `3deea26` · Part 1 scoring `ed93d73` · deactivation reasons `f0efb58` ·
Part 2 API `ef001ec` · Part 3 page `4b59b36` (walkthrough `dfee1ac`) · evaluation expectations `205bca1` · Part 4
evaluation and this note — see `git log`.

> **Status: pass mark not fully met (top-5 6/7). Accepted by team decision because all three measured alternatives performed the same or worse.** Official result: top-3 6 / 7 (pass), top-5 6 / 7 (fail), chef control 15.0 % (pass). Scoring and the committed expectations were not changed.

## Summary

A signed-in user opens **Career matches** and sees every IT career in the database ranked by how many of its key skills
they already have. For the selected career the page shows each required skill as held, related (with the user skill
that earned it) or missing, the optional skills, a plain-language explanation, the career's sources (O\*NET / ESCO) with
attribution, and the gap list that Module 6 will turn into a learning path ("Generate learning path — coming soon").

## Requirement → feature → test

| Requirement | Feature | Tests |
|---|---|---|
| FE-1 / FR7.1 the user's latest skills | The merged profile skills in `ai_db.user_skill_profiles` (manual, CV, GitHub), used only when their embeddings are done; re-normalised through today's aliases | AI `test_matching.py` (aliases, pending, model mismatch) |
| FE-2 / FR7.2 compare against IT roles only | Every active profession (O\*NET SOC 15-12xx / 15-2051; ESCO ISCO 251, 252, 351, 3522, 2166) is scored; ISCO 3521 (audio-visual technicians) excluded | AI `test_matching.py` (every profession, k = all); 3521 re-import (TEST_LOG) |
| FE-3 / FE-4 skill comparison | Cosine similarity between individual skill embeddings; the credit rule per role skill | AI `test_matching.py` (credit rule, brute-force check over the full matrix) |
| FR7.3 ≥ 3 matches, % , highest first | Ranked list of all careers; the page tops filtered lists up to 3 | AI `test_matching.py` (ranking); FE `careerRules.test.js`, `CareerMatchesPage.spec.jsx` |
| FR7.4 required skills held / gaps | Required and optional skills with held / related / missing (icon and words) | FE `CareerMatchesPage.spec.jsx` (details) |
| FR7.5 explanation | Template-based sentences from the breakdown and the user's skill sources (no LLM) | AI `test_matching.py` (explanations); FE (details) |
| FR7.6 view details | `GET /api/career-matches/:professionId`; the details panel | Core `careerMatches.test.js`; FE (details) |
| FR7.7 learning path for missing skills | The gap list per career is stored (`career_matches.gaps`) and shown; button disabled "coming soon" | AI `test_matching.py` (gaps); FE (learning-path button) |
| FR7.8 sort / filter by % and category | In the browser: sort by % or title; filter by category, source, minimum % | FE `careerRules.test.js`, `CareerMatchesPage.spec.jsx` |
| FR7.9 back to the dashboard | Always-visible link; navbar and dashboard entries | FE `CareerMatchesPage.spec.jsx` |
| FR7.10 clear errors, no sensitive details | Distinct codes (EMBEDDINGS_PENDING, MODEL_LOADING, INDEX_BUILDING, NO_PROFESSIONS → 503 + Retry-After; MATCHING_UNAVAILABLE 503; MATCHING_TIMEOUT 504; PROFESSION_NOT_FOUND 404) and safe messages; logs hold a user-id hash only | AI / Core / FE tests; manual log scan (Part 2) |
| Security | The user id only from the verified JWT; `X-User-Id` to AI only with the internal key; `/internal/matching/*` blocked at the gateway | Core `careerMatches.test.js::identity`; GW `careerMatchesRoute.test.js` |

## Scoring design

**FE-4 — how it is met.** Cosine similarity is applied between **individual skill embeddings**: every role skill of
every profession is compared with each of the user's skills on its own. There is **no averaged profile vector, no
profession-level vector and no weighting by skill source** (CV, GitHub and manual skills count the same). The embedding
configuration is the frozen one from 09b2 and is reused unchanged: `BAAI/bge-small-en-v1.5`, user and curated skills as
"Name: description", ESCO skills by label, related threshold **0.73** (`get_related_threshold`), mutual nearest
neighbours K = 10, the vector cache and the FAISS role-skill index with `search_related`.

**Required set (the denominator).** O\*NET: the in-demand technologies. ESCO: the essential skills. A list shorter than
10 is topped up to 10 from the role's other skills in stored order (O\*NET: in-demand → hot; ESCO: essential →
optional). Everything else is shown as optional and is not counted. Lengths over the 143 roles measured at planning:
O\*NET in-demand min 5 / median 13 / max 30; ESCO essential min 6 / median 20 / max 63.

**Credit rule** (09b2), per role skill, taking the best credit over the user's skills:

| Pair | Condition | Credit |
|---|---|---|
| Same canonical key | — | **matched, 1.0** |
| User skill described, role skill described | similarity ≥ 0.73 **and** mutual nearest neighbours | **related, 0.5** |
| User skill described, role skill an ESCO label ("mixed") | similarity ≥ 0.73 | **related, 0.5** |
| Anything else (incl. an undescribed user skill) | — | missing, 0 |

The pair kind is decided **in the matching layer** from both skills' actual description status. (The index's
`search_related` labels a pair "described" whenever it is not "mixed", which includes an undescribed user skill; the
matching layer gives such pairs no credit. `search_related` itself is unchanged.)

**Match %** = Σ credits over the required skills ÷ the number of required skills × 100.

**Every profession is scored**, not only the top-50 neighbours: `search_related` is called with k = every role skill
(1,282), returning every pair ≥ 0.73 with its mutual flag; a test checks the credits against a brute-force reading of
the rule over the full similarity matrix.

**Duplicate roles.** Exact normalised titles only (lowercase, punctuation removed, plural -s dropped): 4 O\*NET ↔ ESCO
pairs (software developer, web developer, database administrator, data scientist). One result shows the higher-scoring
record; the details show both lists tagged by source; the category filter matches either source. O\*NET alternative
titles are **not** used (they produced wrong merges such as "data engineer" ≈ "Database Administrators").

**IT filter.** O\*NET SOC 15-12xx and 15-2051 (minus 15-1299.00); ESCO ISCO 251, 252, 351, **3522** and 2166. ISCO 3521
(broadcasting and audio-visual technicians, 13 roles) was excluded through the 9c pipeline (preview: exactly 13 removed;
publish with snapshot; 143 → 130 active). Excluded roles are recorded as "excluded by role filter (ISCO selection)".

**Explanations** are deterministic templates built only from the breakdown and the user's skill sources, e.g. "You
already have React and TypeScript (from your CV)… Related skills count half: Vue.js (close to your React, similarity
0.90)… To close the gap, learn Docker, AWS…"; ESCO results add the ESCO note.

**Cache.** One document per user in `ai_db.career_matches` (ranked summaries + the gap list per profession), keyed by
the algorithm version, the user's re-normalised skills, the index state hash, the live professions fingerprint (any
profession write, including admin overrides) and the alias / description files' signatures. A different key →
recompute (~140–470 ms cold for 130 professions; ~15–60 ms cached in AIServices).

## Architecture

```
Browser /career-matches ─► Gateway /api/career-matches ─► Core careerMatchController (JWT, auth middleware)
                                                           │  X-Internal-Key + X-User-Id (from the JWT)
                                                           ▼
                                   AI /internal/matching/matches[/{profession_id}] → app/services/matching
```

| Layer | Endpoint | Notes |
|---|---|---|
| Core | `GET /api/career-matches` | The signed-in user's ranked list |
| Core | `GET /api/career-matches/:professionId` | Format-checked (404 without calling AI); details, explanation, gaps |
| AI | `GET /internal/matching/matches` | `X-User-Id` (header, so access logs never contain it) with the internal key |
| AI | `GET /internal/matching/matches/{profession_id}` | 404 for unknown / inactive / malformed ids |

"No skills" is a state (`state: no_skills`), not an error. Logs (AI and Core) hold a 12-character hash of the user id,
the status, the result count and timings — no skills, no ids.

## Evaluation (`AIServices/eval/career_matching/`)

Expectations (`profiles.json`, 8 profiles with 2–4 acceptable roles each, the chef control "no IT role above 20 %")
were committed **before** the run (`205bca1`). `run_eval.py` scores them with the production code, read-only (profile
skills embedded in memory; no vector-cache or career_matches writes — counts identical before and after).

| Profile | First acceptable role (rank, %) | Top-3 | Top-5 |
|---|---|---|---|
| Web developer | Web and Digital Interface Designers (1, 58.3 %) | ✓ | ✓ |
| Backend Python | Software Developers, merged (2, 41.7 %) | ✓ | ✓ |
| Data scientist | Data Scientists, merged (1, 50.0 %) | ✓ | ✓ |
| DevOps engineer | Network and Computer Systems Administrators (6, 41.2 %) | ✗ | ✗ |
| Mobile developer | Software Developers, merged (3, 23.3 %) | ✓ | ✓ |
| UI/UX designer | Web and Digital Interface Designers (1, 58.3 %) | ✓ | ✓ |
| QA tester | Software Quality Assurance Analysts and Testers (1, 41.7 %) | ✓ | ✓ |
| **Chef (control)** | best IT role 15.0 % (Computer Systems Analysts) — passes (< 20 %) | | |

- **Top-3 hit rate 6 / 7** (pass mark ≥ 6) · **top-5 hit rate 6 / 7** (pass mark 7 / 7) · **chef 15.0 %** (pass mark < 20 %)
  → **pass mark not met**.
- **Background credit check** (`eval/background_credit_rate.py`): chef 3.2 % vs web 12.9 % → **PASS** (unchanged by the
  13-role exclusion: 3.0 / 12.2 before).
- **ESCO bias:** ESCO-only roles make up 0–50 % of a profile's top 10 (UI/UX 50 %, data 40 %, mobile 0 %); the best
  ESCO-only rank ranges from 2 (UI/UX) to 13 (mobile).
- **Doubtful credits:** none of the known pairs (Docker → FPGA / resource-efficient technologies / .NET, React →
  Selenium) appears behind a top-5 result. Judged doubtful after the run: "a different tool" credits such as Git → Jira,
  Flask → Selenium, Selenium → React, React → Figma, Webpack → Docker (0–12 per profile), and "another language" credits
  such as JavaScript → Python 0.85 (0–14 per profile); the chef's top results rest on Customer Service → ESCO customer
  phrases and on doubtful ones (Cooking → Microsoft Word 0.75, Inventory Management → SAS 0.77). Full lists in
  `results/report.md`.

**Why DevOps fails.** The first acceptable role, Network and Computer Systems Administrators, is at rank 6 (41.2 %). O\*NET has no DevOps occupation; ESCO **cloud DevOps
engineer** ranks 7th (37.5 %) with 1 held, 16 related — nearly all ESCO ability phrases capped at 0.5 — and 7 missing:
the **ESCO bias**. Mobile passes only through Software Developers: ESCO **mobile application developer** scores 5.6 %
because its required skills are generic programming phrases with no mobile tools (a missing-skills problem of the role
list), and O\*NET has no mobile occupation.

**Options measured, none adopted** (`options.py`, the production scorer patched in-process; background measured the
official way — its baseline reproduces 3.2 / 12.9):

| Option | Top-3 | Top-5 | Chef best | Background chef / web |
|---|---|---|---|---|
| Adopted design | 6 / 7 | 6 / 7 | 15.0 % | 3.2 / 12.9 % PASS |
| (a) ESCO roles scored on knowledge (tool) skills only | 6 / 7 | 6 / 7 | 15.0 % | 3.6 / 14.9 % PASS |
| (b) ability phrases mapped to tool names (cosine ≥ 0.80; 178 phrases) | 6 / 7 | 6 / 7 | 15.8 % | 3.3 / 10.9 % PASS |
| (c) full credit for a mixed pair ≥ 0.80 | 6 / 7 | 6 / 7 | **20.0 %** (fails the chef mark) | 3.2 / 12.9 % PASS |
| (c) full credit for a mixed pair ≥ 0.85 | 6 / 7 | 6 / 7 | 15.0 % | 3.2 / 12.9 % PASS |

None of them lifts an acceptable DevOps role into the top 5.

**Decision (2026-10-16): the current design is accepted** — pass mark not fully met (top-5 6/7), accepted by team decision because all three measured alternatives performed the same or worse. No option was adopted.

**Post-hoc observation (made after the run; the verdict is unchanged).** DevOps' rank-1 result, O\*NET **Computer Systems Engineers/Architects** (59.1 %), lists Cloud Engineer and Cloud Platform Engineer among its alternative titles, and O\*NET has no DevOps occupation. It was not in the expectations committed before the run, so it does not count as a hit.

## Known limitations

1. **No O\*NET DevOps (or mobile) occupation.** DevOps profiles are matched to neighbouring O\*NET roles (systems
   engineers / architects, network administrators) and to ESCO roles only.
2. **ESCO DevOps and mobile role lists are generic phrases without tools** (addressed by Module 5.1 below). ESCO *cloud DevOps engineer* is required
   mostly to "design cloud architecture", "deploy cloud resource" and similar phrases (at most 0.5 each); ESCO *mobile
   application developer* lists generic programming phrases and no mobile tools (5.6 % for a mobile profile). More
   generally about 95 % of ESCO essential skills are label-only phrases, so ESCO roles score lower than comparable O\*NET
   roles (the ESCO bias; the page explains it on ESCO results).
3. **Related credits between different tools and languages** from the frozen configuration (0.73 with mutual nearest
   neighbours): e.g. JavaScript → Python 0.85, Git → Jira 0.80, Selenium → React 0.83. They count half and are visible
   to the user (every related credit names the user skill behind it).
4. **Odd credits for the non-IT control:** e.g. Cooking → Microsoft Word 0.75, Inventory Management → SAS 0.77; the
   chef's best IT role still stays at 15.0 %.
5. **A small evaluation:** 7 IT profiles + 1 control, written by the team; no real users yet.
6. **Alias keys.** Stored skill keys go stale after an alias edit; matching re-normalises user skills and role skills
   with today's aliases at match time (09c note), so no re-save is needed. A renamed user skill without a cached vector is
   embedded once on demand.
7. **Older embeddings routes** still put the user id in the AI path (Module 2); queued as housekeeping.
8. The credit rule, threshold and K are frozen; no tuning was done.

## Future work

- **An ESCO–O\*NET crosswalk** (occupations and skills), so an ESCO role can borrow the named tools of its O\*NET
  counterpart and duplicate roles merge beyond exact titles.
- **A cross-encoder reranker for related pairs** (re-scoring each bi-encoder pair above 0.73) to drop credits between
  different tools and languages; and for mapping ESCO ability phrases to the tools that demonstrate them (sandboxed
  experiment: Module 5.1, `AIServices/eval/esco_phrase_mapping/`).
- **Re-evaluation with real users** (their own profiles and their judgement of the top results).

## Module 5.1 — role-aware ESCO phrase mapping (adopted 2026-10-17)

**Problem (limitation 2 above).** ESCO roles require ability phrases ("computer programming", "deploy cloud resource")
that users never list as such. Without a curated description, such a phrase could earn at most a related credit (0.5).

**Method.** The method is AI-assisted, role-aware and conservative.
- **Scope.** Every pair of an active ESCO role and one of its essential phrases without a curated description: 2,160
  pairs over 100 roles.
- **The mapping.** The assistant (Claude) listed 0–8 skills from the existing skill list whose use *clearly
  demonstrates* the ability in that role. It worked from the phrase, the role title and the skill list only, and opened
  no evaluation profile file.
  - **Role-aware.** For example, "computer programming" maps to Kotlin / Swift / Java / Dart for mobile roles and to
    Python / C++ for computer vision.
  - **Left empty:** generic, soft, legal, managerial, artistic and knowledge-only phrases, and anything doubtful.
- **Result.** 846 pairs (39 %) are mapped, with 3.0 skills on average.
- **Spot check.** The user checked 40 random mapped entries and found all **40 correct**. At 95 % confidence the
  precision is at least about 91 % (Wilson interval).
- **Before adoption.** Earlier sandbox variants were set aside: phrase → single skill via a reranker, and phrase →
  O\*NET category. The sandbox history is in `AIServices/eval/esco_phrase_mapping/`.

**How it is applied: a transform in the ESCO import. The raw files are never edited.**
- **The map.** `AIServices/backend/app/data/esco_role_phrase_skill_map.json` is keyed by ESCO occupation URI + skill
  URI, with readable labels alongside. An empty list records a reviewed pair that stays unmapped.
- **The validator.** `AIServices/scripts/check_esco_role_map.py` fails the build on any error:
  - a skill that is not in the skill list;
  - more than 8 skills for one pair;
  - a duplicate pair;
  - an occupation or skill URI, or their relation, that is not in the active ESCO data (the raw dataset as the import
    selects it, or with `--db` the live professions).

  It runs in the AIServices test suite (`tests/test_esco_role_map.py`), so it is part of `scripts/run_all_tests`.
- **The import.** `parse_esco` (used by both the CLI and the admin upload pipeline) turns each mapped phrase into
  **one requirement group**:
  - a display label, e.g. "Kotlin / Swift / Java / … (computer programming)";
  - the alternatives, any one of which satisfies the group (credit 1.0);
  - the original phrase, its URI, its essential/optional type and `source: "role_map"`.

  The phrase keeps its name and key. So the required count, the top-up to 10 (a group counts once), the role-skill
  index and the related-credit fallback are exactly as before, and a phrase is never split into several requirements.
  Unmapped phrases keep the frozen rule (0.73 mixed / mutual-NN). O\*NET roles are untouched. Every ESCO skill now also
  stores its URI.
- **Scoring order** (`scoring.assess_group`):
  1. the phrase itself → matched;
  2. else any alternative the user holds → matched via that skill;
  3. else related / missing as before.

  The algorithm version is 2. The map's hash is part of the career-match cache key, so old results refresh.
- **Pipeline.**
  - The import preview shows the adjusted requirements live → staged (with a warning when fewer would be adjusted),
    the undescribed essential pairs not in the map (e.g. new roles after a re-import) and stale map entries (URI drift).
  - Publishing never edits the map.
  - Snapshots include the map file, and a restore puts it back and reloads it.
  - The post-checks fail, and the publish or restore is rolled back, when the live group count differs from the
    preview's staged count (publish) or the snapshot's count (restore).
- **UI.**
  - The career details show the label. A held group reads "Held via Kotlin (shows: computer programming)"; a missing
    group lists its alternatives.
  - The admin Professions tab lists each role's skills, marking adjusted ones with their alternatives and the original
    phrase.
  - The preview shows the role-map counts.
- **Re-import (2026-10-17).** The ESCO import was re-run on the current files through the normal pipeline (CLI, actor
  "module-5.1-adoption"). Snapshot `20261017T114216-52907671` was taken before the swap.
  - The same 130 active roles: no professions added, removed or changed.
  - 846 requirements adjusted; 1,314 reviewed and left unmapped; 0 not in the map; 0 stale.
  - Post-checks: group count 846 = 846 expected, state hash OK, background check PASS.

**Official evaluation (production code on the re-imported data; `eval/career_matching/results/module5.1_{old8,new6}/`).**

| Set | Top-3 | Top-5 | Chef best | Background check |
|---|---|---|---|---|
| Old 8 (official; Module 5 profiles) | **7/7** (Module 5: 6/7) | **7/7** (6/7) | **15.0 %** (unchanged) | chef 3.2 % vs web 12.9 % — PASS |
| New 6 (cloud, Android, data engineer, security, game, IT support) — *not blind* | 3/6 (3/6) | **6/6** (4/6) | — | — |

- **Sandbox reproduced exactly.** All 14 profiles match the sandbox run: first-acceptable ranks and scores, the top 5
  and the ESCO-only share.
- **DevOps** moves from rank 6 to **3** (cloud DevOps engineer 47.9 %). **Mobile** stays at rank 3, and mobile
  application developer enters the top 5.
- **Background.** Across all ESCO roles, the map credits the chef nothing (0 of 2,297 required rows) and the web profile
  1.7 %.
- **The median ESCO-only share in the top 10 rises:** old 20 % → 30 %, new 5 % → 25 %.
- **Most influential mappings:**
  - old set: web designer (markup, front-end design, wireframes), UX research phrases, and mobile application developer
    / computer programming;
  - new set: ICT application developer / computer programming, and cloud software developer / deploy cloud resource.

**Honest limits.**
- **Small sample.** There are 7 + 6 IT profiles.
- **The new 6 are not blind.** The same assistant wrote them just before the mapping.
- **The spot check covers 40 of 846 entries.**
- **Three profiles moved from #1 to #2,** each because an ESCO role rose above the acceptable one; they are still top-3
  hits:
  - web developer: ESCO web designer;
  - data scientist: computer vision engineer;
  - game developer: 3D animator.
- **Adding skills to the skill list** does not extend the map. New ESCO roles or phrases appear in the preview as "not
  in the map" until someone reviews them.
- **The frozen embedding configuration is untouched.**

**Suggested SDS text.**
- **Module 5 FE-3, add:** "For ESCO careers, an essential or optional ability phrase that a curated role-aware map links
  to named skills is one requirement satisfied by any one of those skills (credit 1.0); otherwise the rule above
  applies."
- **§3.5, add:** `app/data/esco_role_phrase_skill_map.json`; role skills may carry `uri`, and requirement groups carry
  `source`, `label`, `alternatives`, `phrase` and `phrase_uri`.

**Files.**
- AIServices:
  - `app/services/professions/{esco_role_map,esco,store}.py`, `app/services/matching/{scoring,service}.py`,
    `app/services/taxonomy/{pipeline,publishing,snapshots}.py`;
  - `app/data/esco_role_phrase_skill_map.json`, `scripts/check_esco_role_map.py`;
  - tests: `tests/test_esco_role_map.py`;
  - `eval/esco_phrase_mapping/convert_to_uri_map.py`, `eval/career_matching/run_eval.py` (`--profiles`).
- Frontend: `src/pages/careers/careerRules.js`, `src/pages/admin/taxonomy/{ProfessionsTab,PreviewPublishTab}.jsx`;
  specs alongside.

## Module 5.2 — curated modern roles replace ESCO; exact / alias / any-of scoring (adopted 2026-10-17)

**Why.**
- **Vague ESCO phrases.** 1,319 required ESCO skills were label phrases with no named alternative.
- **The background diagnosis.** Related credit was 66–90 % false matches (`eval/curated_roles/results/background_diagnosis.md`).
- **B vs B2.** Removing the 0.5 related credit kept every hit mark and took the chef to 0 %
  (`eval/curated_roles/results/b2_compare.md`).

**What changed.**
- **Curated roles.** 19 roles (`AIServices/data/curated/modern_roles_v1.json`, v1.0.0, METHOD.md) were imported as source
  `curated` through the taxonomy pipeline: snapshot `20261017T175232-ac8f0dc7` first; the published file is
  `app/data/curated_roles.json`.
- **Skill list.** 17 aliases and 27 new skills, so every curated skill is in the list.
- **ESCO.** Retired through the pipeline: snapshot `20261017T175306-b356abae` first; all ESCO roles inactive, reason
  "retired: replaced by curated modern roles v1". `esco_skills`, the ESCO import code and the role map stay, dormant.
- **Scoring (`systemconfigs` `matching.related_credit = false`).** Credit is 1.0 for an exact key, alias or any-of
  alternative, otherwise 0. Related pairs are shown only as hints on a role's missing skills.
- **Career pages.** Curated roles are labelled "Curated" (with the evidence attribution line).

**Official re-run** (production code, after the import; `eval/career_matching/results/module5.2_*`):

| Set | Top-3 | Top-5 | Other |
|---|---|---|---|
| Old 8 | 7/7 | 7/7 | chef best 0 % |
| New 6 (not blind) | 6/6 | 6/6 | |
| 10 test CVs (not blind) | 10/10 | 10/10 | expected family #1 for 7 |
| Background (B2 metric) | | | chef 0 %, web 0 %: PASS (ratio n/a); legacy related rate 5.4 % / 18.5 % |

- **Same as a sandbox B2 run on the same dataset.** All 24 profiles are identical.
- **Different from the original sandbox B2 in 5 profiles' match %.** The skill-list additions unify spellings (e.g. the
  Android CV's MVVM, OWASP Top 10, BigQuery). CV 06's first acceptable role moved from #2 to #3, still a top-3 hit.

**Limitations.**
- The curated roles were AI-assisted, with traceable evidence per requirement (METHOD.md), and the team review
  (`review.csv`) is still pending.
- The test CVs and the new 6 profiles are not blind, and the samples are small (7 + 6 + 10).
- The background metric was redefined for B2 before it was run.
- Without related credit, O\*NET roles score lower than before.
- In legacy mode the chef's related-credit rate is 5.4 % (> 5 %).
- **Testing:** the full suite was not re-run after the interruption. The new tests passed individually, and manual testing
  by a project team member passed.

**How to undo.**
- **Re-enable ESCO:** restore a snapshot (admin History tab → Restore, or `POST /internal/admin/taxonomy/snapshots/{id}/restore`).
  - `20261017T175232-ac8f0dc7` returns to the state before Module 5.2: O\*NET + ESCO, no curated roles.
  - `20261017T175306-b356abae` re-enables ESCO and keeps the curated roles.
- **Legacy scoring:** set `matching.related_credit` to `true` on the admin Configuration page. Career matches are
  recomputed, because the mode is part of the cache key.

## Suggested SDS text

| Section | Add or replace |
|---|---|
| **Module 5 FE-3** | "Each required skill of a career is compared with each of the user's skills individually: the same canonical skill is a match (credit 1.0); a related skill earns 0.5 when the cosine similarity of the two skills' own embeddings is at least 0.73 and, when both skills have curated descriptions, each is among the other's ten nearest neighbours. The best credit over the user's skills is taken for every required skill." |
| **Module 5 FE-4** | "Semantic similarity is cosine similarity between individual skill embeddings (bge-small-en-v1.5). No averaged profile vector, no profession-level vector and no weighting by skill source are used." |
| **FR7.3** | "Match % = the sum of credits over the career's required skills ÷ the number of required skills × 100. Required skills are O\*NET in-demand technologies or ESCO essential skills, at least ten per career (topped up from the career's other skills). All active IT careers are ranked; at least three are always shown." |
| **FR7.2** | "Only IT and related careers are matched: O\*NET SOC 15-12xx and 15-2051 and ESCO ISCO 251, 252, 351, 3522 and 2166." |
| **FR7.5** | "Explanations are generated from fixed templates using the career's skill breakdown and where each of the user's skills came from (profile, CV or GitHub)." |
| **FR7.7** | "The missing required skills of every career are stored per user for the learning-path module; the action is shown as 'coming soon' until that module exists." |
| **FR7.10** | Error codes and messages as in the requirement table above. |
| **§3.5 (data design)** | Add `ai_db.career_matches` (`user_id` unique, `cache_key`, `computed_at`, `skill_count`, `best_score`, `low_match`, `results[]`, `gaps[{profession_id, gaps[]}]`). |
| **Table 3.1 (APIs)** | Add `GET /api/career-matches`, `GET /api/career-matches/:professionId` (Core, JWT) and `GET /internal/matching/matches[/{profession_id}]` (AI, internal key + `X-User-Id`). |
| **Evaluation (§5)** | Add the sanity-profile table, hit rates, the chef control and the background check above. |

## Files

- AIServices: `app/services/matching/{scoring,service}.py`, `app/routes/matching_routes.py`, `app/main.py`;
  `app/services/professions/{esco,onet,store,imports}.py`, `app/services/taxonomy/pipeline.py` (deactivation reasons);
  `app/config/settings.py`, `.env.example` (ISCO selection); tests `tests/test_matching.py`, `tests/test_professions.py`;
  evaluation `eval/career_matching/{profiles.json,run_eval.py,options.py,analysis.py,results/}`.
- CoreServices: `backend/controllers/careerMatchController.js`, `backend/routes/careerMatchRoutes.js`, `app.js`;
  tests `tests/careerMatches.test.js`. Frontend: `src/pages/CareerMatchesPage.jsx`, `src/pages/careers/*`,
  `src/services/careerMatchService.js`, `App.jsx`, `Navbar.jsx`, `DashboardPage.jsx`; specs alongside.
- API Gateway: `app.js`; tests `tests/careerMatchesRoute.test.js`.
