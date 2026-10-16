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
2. **ESCO DevOps and mobile role lists are generic phrases without tools.** ESCO *cloud DevOps engineer* is required
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
