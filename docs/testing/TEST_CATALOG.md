# Muqayyim — test catalog (traceability matrix)

Which tests cover which requirement. Requirement ids are the ones the change notes in `docs/changes/` cite
(SRS FR / FE / NFR ids and SDS sections). Rows marked **security** or **data integrity** cover cross-cutting
properties with no single SRS id.

- **Type:** unit · integration (HTTP route or several components against a test database) · manual (live check across
  the running services, recorded in [TEST_LOG.md](TEST_LOG.md)) · evaluation (measured on labelled data or real data).
- **Status:** *pass* means it passed in the latest full run in [test-runs.md](test-runs.md); *xfail* is a known,
  documented expected failure; *skipped* cannot run on the development machine; manual and evaluation rows give the
  date and result of the check.
- **Paths:** AI = `AIServices/backend/tests/`, Core = `CoreServices/tests/`, GW = `API Gateway/tests/`,
  FE = `CoreServices/frontend/src/`. `file::group` names a `describe` block or a group of tests; `file::test` a single test.

## Module 1 — users, authentication, sessions

| Requirement | Tests | Type | Status |
|---|---|---|---|
| FR2.3 password policy | Core `passwordPolicy.test.js` (server rules; frontend copy gives the same verdicts) | unit | pass |
| FR1.2 registration, duplicates → 409 | Core `authHardening.test.js::registration`, `authRoutes.test.js` | integration | pass |
| SEC-3 account lockout (5 wrong → 423), admin unlock | Core `authHardening.test.js::lockout`, `adminUnlock.test.js` | integration | pass |
| FE-9 (proposed) change password | Core `authHardening.test.js::change password` | integration | pass |
| SEC-2 live auth state: suspended / demoted / deleted users, revoked tokens | Core `liveAuth.test.js`, `internalRoutes.test.js`; AI `test_live_auth.py` (via Core, cache TTL, grace period) | integration | pass |
| Session errors never mis-log-out (401 codes, 503 AUTH_UNAVAILABLE, 429/413/502/504) | FE `services/apiErrors.test.js` | unit | pass |
| Auth hardening, browser | Edge run 02, lockout and 429 in live check 04 | manual | 2026-10-12, passed (04: 20/20) |

## Module 2 — CV upload, parsing, skills

| Requirement | Tests | Type | Status |
|---|---|---|---|
| FE-1 / FE-2 file checks: signatures, encrypted, size, no text, `.doc` | AI `test_file_checks.py` | unit | pass; real-LibreOffice test **skipped** (not installed) |
| FR4.2 extraction of sections and dates | AI `test_date_parser.py`, `test_extraction.py` | unit | pass |
| FR4.6 certifications | AI `test_extraction.py::certifications` | unit | pass |
| needsReview flags match verify errors | AI `test_parsed_normaliser.py` | unit (property-style) | pass |
| Upload → parse → verify flow | AI `test_parse_flow.py`, `test_parse_integration.py`; Core `cvSourceParsed.test.js`; FE `validation/cvImport.test.js`, `components/cv/ParsedSummary.spec.jsx` | integration | pass |
| Server-owned CV status (six-value enum, `/internal` + key) | Core `internalAuth.test.js`, `internalRoutes.test.js`; AI `test_core_client.py`, `test_internal_routes.py`; GW `internal.test.js` | integration | pass |
| Parser, live | live check 08 | manual | 2026-10-12, 15/15 |
| FE-4 parse-time skill embeddings | AI `test_embeddings.py::parse-time embeddings` | integration | pass |
| FE-5 / FR-B9 profile skill re-embedding | Core `skillEmbeddingSync.test.js`; AI `test_embeddings.py::user skill profiles`; GW `embeddingsRoute.test.js`; FE `components/embeddings/SkillEmbeddingsCard.spec.jsx` | integration | pass |
| CON-8 skill normalisation and aliases | AI `test_embeddings.py::normalisation`, `test_skill_aliases.py`, `test_role_skill_descriptions.py::aliases` | unit | pass |
| Curated descriptions, seed set read-only | AI `test_skill_descriptions.py`, `test_embeddings_descriptions.py` | unit | pass |
| Frozen embedding config: model, text modes, threshold 0.73 by pair kind with guards | AI `test_embeddings_descriptions.py::threshold`, `test_professions.py::search_related` | unit | pass |
| Real model sanity: related > 0.73 > unrelated | AI `test_embeddings.py` slow test | integration (real model) | pass |
| Known false positives Redux ↔ Redis 0.744, React ↔ Python 0.776 | AI `test_embeddings.py` slow tests | integration (real model) | **xfail (strict)** — see TEST_LOG "Known expected failures" |
| Embeddings, live | live checks 09a (15/16, the 1 failure was in the check script) and 09a2 (13/13) | manual | 2026-10-13 / 2026-10-14 |

## Module 3 — profile (FR5.x) and Module 4 — CV generator (FR6.x)

| Requirement | Tests | Type | Status |
|---|---|---|---|
| FR5.1–FR5.13 profile field rules, partial saves, exact error paths | Core `profileValidation.test.js`; FE `validation/validateProfile.test.js`, `pages/ProfileBuilderPage.spec.jsx` | unit + integration | pass |
| Shared limits identical in Core, AI and frontend | Core `profileLimits.parity.test.js`; AI `test_profile_limits.py` | unit | pass |
| AI verify payload validation (422 shape, values not echoed) | AI `test_verify_validation.py` | integration | pass |
| FR6.1–FR6.5 CV generator settings and data | Core `generatedCvValidation.test.js` | integration | pass |
| FR6.8 / USE-3 minimum content (`PROFILE_INCOMPLETE`) | Core `generatedCvValidation.test.js`; FE `pages/CVGeneratorPage.spec.jsx` | integration | pass |
| Validation, live | live check 06 | manual | 2026-10-12, 13/13 |

## Module 5 — professions and matching groundwork

| Requirement | Tests | Type | Status |
|---|---|---|---|
| FE-2 profession database (O*NET + ESCO selection, cleaning, overrides survive re-imports) | AI `test_professions.py` | unit + integration | pass |
| FE-3 groundwork: FAISS role-skill index, `search_related`, `mutual_nn` | AI `test_professions.py::index`, `::search_related`, `test_role_skill_descriptions.py::test_index_renormalises_stale_stored_keys` | unit | pass |
| Credit rule (same key 1.0; described ≥ 0.73 + mutual 0.5; mixed ≥ 0.73 0.5) | documented in the frozen configuration; pair kinds tested in `test_professions.py::search_related` | unit | pass (rule itself not yet used by matching) |
| Background credit rate (unrelated profile credited ≤ 5 % and ≤ 0.5 × related) | AI `test_background_credit_rate.py` (slow); `AIServices/eval/background_credit_rate.py` | evaluation (real data) | 2026-10-15: chef 3.0 % vs web 12.2 % — pass |
| Role-skill description coverage | `AIServices/eval/role_skill_coverage.py` | evaluation (real data) | 2026-10-15: distinct 20.2 %, occurrences 38.2 % |
| FR7.2 only IT / related roles: ISCO 3521 excluded (ESCO re-import through the 9c pipeline) | 9c CLI dry run + publish on real data | manual | 2026-10-16: exactly 13 removed, 130 active, background check passed |
| FR7.1 the user's latest skills: merged profile skills, only when embeddings are done; re-normalised through today's aliases | AI `test_matching.py::test_user_skills_are_normalised_through_todays_aliases`, `::test_pending_embeddings_and_missing_profiles` | integration | pass |
| FE-3 / FE-4 skill-to-skill credit rule (matched 1.0; described + mutual 0.5; mixed 0.5; kind from description status) | AI `test_matching.py::test_credit_rule_…`, `::test_the_best_pair_…`, `::test_credits_agree_with_a_brute_force_reading_of_the_rule` | unit + integration | pass |
| FR7.2 / FR7.3 every active profession scored (search_related with k = all), ranked highest first | AI `test_matching.py::test_scores_every_profession_with_the_credit_rule`, `::test_search_related_is_asked_for_every_role_skill`, `::test_ranking_…` | integration | pass |
| Match % = credits over required skills (O\*NET in-demand, ESCO essential, topped up to 10) | AI `test_matching.py::test_onet_required_…`, `::test_short_lists_…`, `::test_esco_required_…`, `::test_match_percent_…` | unit | pass |
| Duplicate roles across sources merged on exact titles only | AI `test_matching.py::test_exact_titles_merge_…` | unit | pass |
| FR7.4 / FR7.5 / FR7.7 breakdown (held / related / missing), template explanation, stored gap list; low-match flag | AI `test_matching.py::test_explanation_…`, `::test_low_match_note_and_details`, `::test_scores_every_profession_…` | unit + integration | pass |
| Result cache per user, invalidated by skill, profession, index or taxonomy-file changes | AI `test_matching.py::test_the_cache_is_used_and_invalidated` | integration | pass |
| **security** — a user only ever gets their own matches (user id from the JWT only; other ids in query / body / headers ignored; `X-User-Id` only with the internal key) | Core `careerMatches.test.js::identity`; AI `test_matching.py::test_list_and_detail_routes` | integration | pass |
| FR7.10 distinct, safe errors: EMBEDDINGS_PENDING / MODEL_LOADING / INDEX_BUILDING / NO_PROFESSIONS (503 + Retry-After), MATCHING_UNAVAILABLE (503), MATCHING_TIMEOUT (504), PROFESSION_NOT_FOUND (404) | AI `test_matching.py::test_not_ready_states_…`, `::test_unknown_inactive_and_malformed_ids`; Core `careerMatches.test.js` (errors, validation) | integration | pass |
| Logging without personal data (user id hashed; no skills) | AI `test_matching.py::test_list_and_detail_routes`; Core `careerMatches.test.js::logging`; manual log scan | integration + manual | pass; 2026-10-16: 0 raw ids after the fix |
| Gateway route `/api/career-matches` → Core; `/internal/matching/*` blocked | GW `careerMatchesRoute.test.js` | integration | pass |
| Career matching API, live (gateway → Core → AI, real profile) | Module 5 Part 2 manual check (TEST_LOG) | manual | 2026-10-16: list, cached list, details, 404, 401 as expected |
| Deactivation reason: "not in dataset" vs "excluded by role filter" | AI `test_professions.py::test_publish_deactivates_…`, `::test_a_profession_no_longer_in_the_dataset_…`, `::test_isco_filter_reason_corrects_…` | integration | pass |

## Module 10 — admin

| Requirement | Tests | Type | Status |
|---|---|---|---|
| FE-3 / FR-B11 / REL-2 error logs, security events, alerts | Core `errorLogging.test.js`, `internalLogs.test.js`, `alerts.test.js`, `adminLogs.test.js`, `mask.test.js`; AI `test_error_logging.py`, `test_internal_logs.py`, `test_mask.py`; GW `errorReporting.test.js`; FE `pages/admin/AdminLogsPage.spec.jsx` | unit + integration | pass |
| Error logging, live | live check 05 | manual | 2026-10-12, 20/20 |
| FE-4 profession CRUD (pass-through, admin-only, AdminLog) | Core `adminProfessions.test.js`; AI `test_professions.py::routes` | integration | pass |
| FR12.4 import jobs, lock, heartbeat, recovery | AI `test_taxonomy_jobs.py` | unit + integration | pass |
| FR12.4 uploads: ZIP / CSV, required files named exactly, validation | AI `test_taxonomy_uploads.py` | unit + integration | pass |
| FR12.5 preview before publishing (diff, checks, staging indexes, UI = CLI) | AI `test_taxonomy_preview.py` | integration | pass |
| FR12.4 publish, snapshots, restore (202 + polling), rollback, crash recovery | AI `test_taxonomy_publish.py` | integration | pass |
| FR12.4 command-line importers: dry run writes nothing live and cancels its job, failed validation reported, `--i-understand-background-check` required to publish past a failed check, refused under the lock, "service running" warning, flags reach the run; audit record `created_by = "cli"` | AI `test_taxonomy_cli.py` | integration | pass |
| Crash recovery and clean-up run periodically and survive a failed round (`run_recovery`, `run_cleanup`) | AI `test_taxonomy_cli.py::test_recovery_loop_runs_periodically_and_survives_a_failure`, `::test_cleanup_loop_runs_periodically_and_survives_a_failure` | unit | pass |
| FR12.4 direct edits: overrides, skill taxonomy, seed read-only, vector repair | AI `test_taxonomy_edits.py` | integration | pass |
| Taxonomy through Core (admin identity from JWT, pass-through, AdminLog, abort) | Core `adminTaxonomy.test.js`; AI `test_taxonomy_uploads.py::test_upload_needs_a_valid_admin_header_before_reading_the_body`, `::test_client_disconnect_during_upload_leaves_no_job` | integration | pass |
| Taxonomy through the gateway (100 MB stream, 413, timeout, rate limit) | GW `taxonomyRoutes.test.js` | integration | pass |
| Taxonomy, real data | 9c Parts 2–7 manual checks (uploads, dry runs, publish/restore with 12 measures unchanged, edits restored identical, Core 403, gateway 413) | manual | 2026-10-15, all passed |
| Admin UI: five tabs, lock banner (who and what holds it), lock polled every 2 s only while held | FE `pages/admin/AdminTaxonomyPage.spec.jsx` | unit (component) | pass |
| Admin UI: Data sources — counts, versions, O*NET / ESCO file hints, attribution text, upload progress, 100 MB client check, 413 / 422 / 504 messages, upload disabled under the lock | FE `pages/admin/taxonomy/DataSourcesTab.spec.jsx` | unit (component) | pass |
| Admin UI: Preview & publish — loading / empty / error / running / failed / success; diff and checks; **publish button rules** (previewed only, not under the lock, amber background warning with chef and web rates needs “I understand”); 409 messages; polling every 2 s only while running, paused while the browser tab is hidden | FE `pages/admin/taxonomy/PreviewPublishTab.spec.jsx`; rules in `pages/admin/taxonomy/taxonomyRules.test.js` | unit (component + node) | pass |
| Admin UI: History — snapshots, restores, jobs; **restore dialog lists exactly what is undone** and needs RESTORE typed; 429 shown in the dialog; running restore polled until it finishes | FE `pages/admin/taxonomy/HistoryTab.spec.jsx` | unit (component) | pass |
| Admin UI: Professions — override markers, save sends only changed fields, reset to dataset value, no reset for manual professions, 409 busy, everything disabled under the lock | FE `pages/admin/taxonomy/ProfessionsTab.spec.jsx` | unit (component) | pass |
| Admin UI: Skill taxonomy — seed description read-only, Check (dry-run validation), save reports the re-embedded skill, 422 reasons, create, disabled under the lock | FE `pages/admin/taxonomy/SkillTaxonomyTab.spec.jsx` | unit (component) | pass |
| Error messages for 403 / 409 / 413 / 422 / 429 (with Retry-After) / 503 / 504 / no connection | FE `pages/admin/taxonomy/taxonomyRules.test.js` | unit | pass |
| Lock shows its holder; restore list includes the snapshot's own edit; edit snapshots name the edit; publisher named; profession categories for the edit form | AI `test_taxonomy_jobs.py::test_lock_shows_who_holds_it`, `test_taxonomy_edits.py::test_restore_dialog_lists_every_edit_it_undoes`, `::test_edit_routes`, `test_taxonomy_publish.py` (routes) | integration | pass |
| Admin UI, browser walkthrough (upload → validate → preview → cancel, override + reset, non-seed skill edit + restore, 409 and 422 cases, 100 MB client check) | 9c Part 8 checklist (TEST_LOG) | manual | 2026-10-16, 16/16 passed |

## Gateway and cross-cutting

| Requirement | Tests | Type | Status |
|---|---|---|---|
| SEC-3 / SDS §3.3.2 rate limits | GW `rateLimit.test.js`, `rateLimitConfig.test.js` (30 s per-test timeout: an app is built per case) | integration | pass |
| Body size limits and timeouts (413, 502, 504) | GW `limitsAndTimeouts.test.js` | integration | pass |
| Request IDs, helmet headers, CORS | GW `requestIdHeaders.test.js`; Core `requestId.test.js`; AI `test_request_id.py` | integration | pass |
| `X-Forwarded-For`, trust proxy | GW `forwarding.test.js` | integration | pass |
| Gateway, live | live check 04 | manual | 2026-10-12, 20/20 + 3 |
| **security** — `/internal/*` never reachable from outside | GW `internal.test.js`, `taxonomyRoutes.test.js`, `embeddingsRoute.test.js` | integration | pass |
| **security** — internal key checked in constant time, never logged | Core `internalAuth.test.js`; AI `test_internal_routes.py`, `test_core_client.py` | unit | pass |
| **security** — secrets, JWTs and credentials masked in logs | Core `mask.test.js`; AI `test_mask.py` | unit | pass |
| **security** — admin identity only from the verified JWT; spoofed `created_by` / `actor` ignored | Core `adminTaxonomy.test.js`; AI route tests in `test_taxonomy_uploads.py`, `test_taxonomy_publish.py`, `test_taxonomy_edits.py::test_edit_routes` (spoofed fields asserted absent) | integration | pass |
| **security** — ZIP safety (zip-slip, symlinks, bombs, entry counts) | AI `test_taxonomy_uploads.py::rejected uploads` | unit | pass |
| **data integrity** — tests never touch real data files | AI `tests/conftest.py` session guard (fails the run if any `app/data/*.json` changes) | unit | pass |
| **data integrity** — atomic publish, rollback, crash recovery, snapshot SHA-256 manifest | AI `test_taxonomy_publish.py` | integration | pass |
| **data integrity** — publish → restore leaves real data identical | 9c Part 4 manual check (12 measures), Part 5 and Part 8 walkthrough (file SHA-256, index state hash vs an independent backup) | manual | 2026-10-15 / 2026-10-16, identical |

## Evaluations

| Evaluation | Location | Data | Result |
|---|---|---|---|
| Benchmark v1 — model and text selection | `docs/evaluation/embedding-benchmark-2026-10-13/` | 245 labelled pairs | bge-small + description text: AUC 0.996, Recall@5 0.720 → chosen |
| Benchmark v2 — hard negatives, threshold | `docs/evaluation/embedding-benchmark-2026-10-14/` | 337 pairs, 92 hard negatives | bge-small AUC vs hard 0.990, Thr@P95 0.733, recall 0.94 → threshold 0.73; bge-small kept over the report's automatic MiniLM recommendation |
| Benchmark v3 — ESCO phrase / knowledge skills | `AIServices/eval/embeddings_v3/results/` | 153 pairs, 70 / 30 dev / held-out | held-out AUC vs hard: label only 0.985, first sentence 0.903, full description 0.892; guardrail not met → label-only ESCO text, single 0.73 threshold |
| Mixed threshold 0.61 (rejected) | 09b2 Part 4 | real role skills, web vs chef profile | 60.4 % vs 60.8 % credited → rejected |
| Background credit check | `AIServices/eval/background_credit_rate.py` | real index, chef vs web profile | 3.0 % vs 12.2 % → pass |
| Role-skill description coverage | `AIServices/eval/role_skill_coverage.py` | real professions | distinct 12.0 % → 20.2 %, occurrences 25.9 % → 38.2 % |
