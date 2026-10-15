# Muqayyim — test log

The history of every test run and manual check for the project, one section per change, in order.
For the requirement-by-requirement view see [TEST_CATALOG.md](TEST_CATALOG.md). From 2026-10-15 every full
run is also appended automatically to [test-runs.md](test-runs.md) by `scripts/run_all_tests`.

**How to read the sources of each entry**

- **Reconstructed** — rebuilt afterwards only from the git history, the change notes in `docs/changes/`, the
  evaluation reports in `docs/evaluation/` and the test files. Where none of these records a number, the entry says
  **not recorded**; nothing is estimated.
- **Recorded** — the 9c entries: copied from the actual test output at the time the change was made (the work
  session's run results), not reconstructed.
- **Automatic** — from 2026-10-15 on: `docs/testing/test-runs.md` and `docs/testing/runs/*.json`.

Personal data is masked: test accounts are "test user" / "admin", ids and emails are not reproduced.

## Suite counts over time

AI = AIServices pytest (normal run), AI slow = `pytest -m slow` (real embedding model), Core = CoreServices Jest,
GW = API Gateway Jest, FE node = frontend `node --test`, FE Vitest = frontend Vitest. "—" = suite did not exist yet;
"n/r" = not recorded.

| Change | Commit | AI | AI slow | Core | GW | FE node | FE Vitest | Source |
|---|---|---|---|---|---|---|---|---|
| Baseline (before Problem 1) | `1102853`…`0b48ec1` | — | — | — | — | — | — | reconstructed |
| 01 Service separation | `344889d` | n/r | — | n/r | n/r | — | — | reconstructed |
| 02 Auth hardening | `1254517` | n/r | — | 65 | 6 | n/r | — | reconstructed |
| 03 Live auth checks | `c54171d` | 27 | — | 80 | 7 | 9 | — | reconstructed |
| 04 Gateway hardening | `a432975` | 30 | — | 83 | 35 | 14 | — | reconstructed |
| 05 Error logging | `a14b4da` | 44 | — | 115 | 42 | 14 | 6 | reconstructed |
| 06 Profile validation | `e830220` | 53 | — | 208 | 42 | 19 ¹ | 13 | reconstructed |
| 08 Parser completeness | `4254e18` | 187 + 1 skipped | — | 210 | 42 | 24 | 16 | reconstructed |
| 09a Skill embeddings | `7058c22` | 236 + 1 skipped | 1 | 220 | 46 | 25 | 20 | reconstructed |
| 09a2 Stage 1 (descriptions) | `00da5d7` | 265 | n/r | n/r | n/r | n/r | n/r | reconstructed |
| 09a2 Stage 2 (bge-small) | `92b54e6` | 289 + 1 skipped | 1 + 1 xfailed | 220 | 46 | 25 | 21 | reconstructed |
| Threshold 0.73 (benchmark v2) | `cee7507` | n/r | n/r ² | n/r | n/r | n/r | n/r | reconstructed |
| 09b Professions + FAISS index | `3483abe` | 340 + 1 skipped | n/r | 229 | n/r | n/r | n/r | reconstructed |
| 09b2 Parts 1–2 (role-skill descriptions) | `e8e57a8` | 388 + 1 skipped | n/r | n/r | n/r | n/r | n/r | reconstructed |
| 09b2 Part 3 (benchmark v3) | `49d18a3` | n/r | n/r | n/r | n/r | n/r | n/r | reconstructed |
| 09b2 Part 4 (frozen configuration) | `cc560fa` | 392 + 1 skipped | 2 + 2 xfailed | n/r | n/r | n/r | n/r | reconstructed |
| 9c Part 1 (import jobs) | `d7a0596` | 410 + 1 skipped | n/r | 229 | 46 | 25 | 21 | recorded |
| 9c Part 2 (uploads) | `47361bd` | 444 + 1 skipped | n/r | n/r | n/r | n/r | n/r | recorded |
| 9c Part 2 follow-up | `9ca7e0d` | 446 + 1 skipped | n/r | n/r | n/r | n/r | n/r | recorded |
| 9c Part 3 (preview) | `95abfad` | 461 + 1 skipped | 2 + 2 xfailed | n/r | n/r | n/r | n/r | recorded |
| 9c Part 4 (publish, snapshots) | `e5e5524` | 482 + 1 skipped | n/r | n/r | n/r | n/r | n/r | recorded |
| 9c Part 4 follow-up (async restore) | `a1060aa` | 484 + 1 skipped | n/r | n/r | n/r | n/r | n/r | recorded |
| 9c Part 5 (direct edits) | `f5cf51e` | 496 + 1 skipped | n/r | n/r | n/r | n/r | n/r | recorded |
| Vector repair after restore | `ce47708` | 498 + 1 skipped | n/r | n/r | n/r | n/r | n/r | recorded |
| 9c Part 6 (Core pass-through) | `7492aa7` | 506 + 1 skipped | n/r | 247 | n/r | n/r | n/r | recorded |
| 9c Part 7 (gateway) | `ed52928` | n/r | n/r | n/r | 62 | n/r | n/r | recorded |
| Gateway info line | `a713844` | n/r | n/r | n/r | 62 | n/r | n/r | recorded |
| Test record | `99f540a` | 506 + 1 skipped | 2 + 2 xfailed | 247 | 62 | 25 | 21 | automatic |
| 9c Part 8 (admin UI) | Part 8 commit | 508 + 1 skipped | 2 + 2 xfailed | 247 | 62 | 31 | 70 | automatic |

¹ From the "Before" column of the 08 change note. ² The 09a2 note records React ↔ Python and Redux ↔ Redis as
strict xfails in the slow test but gives no run count for this commit.

## Known expected failures

| Test | Status | Why |
|---|---|---|
| `tests/test_embeddings.py` slow test, **Redux ↔ Redis** | strict `xfail` (cosine 0.744 > 0.73) | A known false positive of `BAAI/bge-small-en-v1.5` on the calibrated seed descriptions (benchmark v1). Fixing it would mean editing the 283 seed descriptions the threshold was calibrated on, which is not allowed. Strict: if a change ever pushes it below 0.73 the test reports XPASS and the note must be updated. |
| `tests/test_embeddings.py` slow test, **React ↔ Python** | strict `xfail` (cosine 0.776 > 0.73) | Found by benchmark v2 (hard negatives). Two very common developer skills whose descriptions share vocabulary. In matching it is filtered by the mutual-nearest-neighbour rule (09b live check: `mutual_nn: false`). |
| `tests/test_file_checks.py` real-LibreOffice test | skipped | LibreOffice is not installed on the development machine, so the real `.doc` conversion cannot run (08). This test belongs to the pending `.doc`-removal change, scheduled after 9c, which will remove or replace it. |

---

## Baseline — before Problem 1 (reconstructed)

**Commits:** `1102853` (2026-05-07) … `0b48ec1` (2026-10-12): first two modules, renaming and Module 3, fixes, the
Admin module, untracking `.env` files, Module 4 (CV generator).

**Automated tests:** none. The change note for Problem 1 introduces the Jest + supertest suites (Core, Gateway) and
"a new PyTest suite" (AI), so no automated suite existed before it.

**Manual checks:** not recorded.

## 01 — Service separation and server-owned CV status (reconstructed)

**Date / commit:** 2026-10-12 · `344889d` · note: `docs/changes/01-service-separation.md`

**Automated tests:** suite counts not recorded. New suites and groups:
- CoreServices Jest (new): `requireInternalKey` (401 / 403 incl. a length mismatch / next); `PUT /internal/users/:id/cv-status` (key checks, invalid status → 400 with the DB unchanged, valid → 200, unknown user → 404); `PATCH /api/auth/cv-status` → 404; profile updates ignore `cvStatus`; a user JWT cannot use `/internal`.
- API Gateway Jest (new, `tests/internal.test.js`): `/internal/*` → 404 and never proxied; `/api/*` still proxied.
- AIServices pytest (new): `notify_cv_status` retries with backoff (key never logged), ordered non-blocking pushes; parse flow processing → parsed / failed (corrupted PDF, extraction error); `/api/cv/latest`; internal route auth.

**Manual checks:** not recorded.

**Problems found by testing:** not recorded.

## 02 — Auth hardening (reconstructed)

**Date / commit:** 2026-10-12 · `1254517` · note: `docs/changes/02-auth-hardening.md`

**Automated tests:** Core **65** passed; Gateway **6** passed; AI and frontend not recorded.
- `passwordPolicy.test.js` — invalid/valid passwords, length bounds, frontend copy gives the same verdicts.
- `authHardening.test.js` — registration (weak → 400, duplicate → 409 incl. letter case and simultaneous), lockout (5th wrong → 423, parallel attempts can't bypass, expiry), reset clears the lock, profile email conflict → 409, change password.
- `adminUnlock.test.js` — lock state in list/detail, admin-only unlock with an AdminLog entry, create-admin policy.
- `forwarding.test.js` (Gateway) — `X-Forwarded-For` forwarded; `trust proxy` defaults to loopback.

**Manual checks:** a browser run (Edge): register checklist and 409 under the email field; change password (wrong current password inline, then success); lockout 423 banner; admin Locked badge and Unlock. Result: described as covered; no pass count recorded.

## 03 — Live auth checks (reconstructed)

**Date / commit:** 2026-10-12 · `c54171d` · note: `docs/changes/03-live-auth-checks.md`

**Automated tests:** Core **80**, AI **27**, Gateway **7**, frontend `node --test` **9** — all passed.
- `liveAuth.test.js` — token codes; suspended user → 403 on normal and admin routes; demoted admin → 403 despite the token's role; forged role claim → 403; deleted user → 401 `USER_NOT_FOUND`; password change/reset revoke old tokens (`TOKEN_REVOKED`); admin self-guards; AdminLog for suspend / reactivate / role change.
- `internalRoutes.test.js` — the internal auth-state endpoint (no key → 401, wrong key → 403, payload, unknown id → 404).
- `test_live_auth.py` — AI's verification through Core: inactive/unknown/revoked users, Core down with and without a cached state (grace period), cache TTL.
- Gateway — the internal auth-state path → 404, not proxied.
- Frontend — session error codes fire once; non-session errors don't log out; 503 `AUTH_UNAVAILABLE` notice.

**Manual checks:** not recorded.

## 04 — Gateway hardening (reconstructed)

**Date / commit:** 2026-10-12 · `a432975` · note: `docs/changes/04-gateway-hardening.md`

**Automated tests:** Gateway **35** (28 new), Core **83** (3 new), AI **30** (3 new), frontend `node --test` **14** (5 new).
- `rateLimit.test.js` — login / register / password-reset / CV-upload limits with `Retry-After` and `RateLimit` headers; other IPs and routes unaffected; `/health` and OPTIONS never limited.
- `rateLimitConfig.test.js` — `RATE_LIMIT_ENABLED=false`, configurable limits, invalid env falls back to defaults.
- `limitsAndTimeouts.test.js` — 7 MB upload → 413, 2 MB profile body → 413, 4 MB upload streamed intact, absurd declared size → 413 with `Connection: close`, hanging target → 504, target down → 502.
- `requestIdHeaders.test.js` / Core `requestId.test.js` / AI `test_request_id.py` — request IDs generated, preserved and echoed; helmet headers; `X-Powered-By` stripped; CORS.
- Frontend — 429 / 413 / 502 / 504 messages without logging out.

**Manual checks:** a live run across the three services and the browser: **20 of 20 checks passed, plus 3 for "AI down"** (request IDs in every log, helmet headers, CV upload unaffected, 7 MB → 413, lockout then 429 on the 11th attempt, the browser only calls the gateway, the 429 message shown once, AI stopped → "Service temporarily unavailable" while signed in).

## 05 — Central error logging, security events and alerts (reconstructed)

**Date / commit:** 2026-10-12 · `a14b4da` · note: `docs/changes/05-error-logging.md`

**Automated tests:** Core **115** (32 new), AI **44** (14 new), Gateway **42** (7 new), frontend **14** `node --test` + **6** Vitest (Vitest introduced).
- Core: masking (nested keys, JWT / Bearer / URL credentials, truncation, cycles); unhandled errors → clean 500 with requestId and a stored, masked entry; DB connection errors → critical; `/internal/logs` auth and validation; alerts (one email per critical error to active admins, throttling, `ALERTS_ENABLED=false`); the admin log API (merge, filters, partial results when AI is down, acknowledge → AdminLog).
- AI: masking; clean 500 with a stored entry in `ai_db_test`; DB errors → critical + alert; corrupted CV → warning; TTL index; internal log endpoints.
- Gateway: 502 / 504 reported to Core's log; unhandled errors → JSON 500; batching; spike detection.
- Frontend (`AdminLogsPage.spec.jsx`): entries from all services, filters, ISO dates, stack drawer, acknowledge, partial notice, security tab.

**Manual checks:** a live run across the three services and the browser (alerts off): **20 of 20 checks passed** (Core handler error stored with a reference, corrupted CV as an `ai_db` warning, a security event, exactly one rate-limit spike, dashboard card, merged list, filters, stack drawer and acknowledge, security tab, AI stopped → gateway 502 stored and partial notices).

## 06 — Server-side validation of profiles, CV generator and CV verification (reconstructed)

**Date / commit:** 2026-10-12 · `e830220` · note: `docs/changes/06-profile-validation.md`

**Automated tests:** Core **208** (from 115), AI **53** (from 44), Gateway **42** (unchanged), frontend Vitest **13** (from 6); frontend `node --test` **19** (from the "Before" column of the 08 note).
- `profileValidation.test.js` (54) — every FR5.1–FR5.8 rule with exact field paths, wrong types → 400 (the CastError regression), partial saves, email immutability, import-shaped payloads, existing invalid data still loads.
- `generatedCvValidation.test.js` (16) — CV generator settings, sizes, entries, `PROFILE_INCOMPLETE`.
- `profileLimits.parity.test.js` (23) and AI `test_profile_limits.py` — the shared `profileLimits.json` is identical in Core, AI and the frontend.
- AI `test_verify_validation.py` — the 422 shape, limits, values not echoed.
- Frontend — a server error on a nested field shows under that field; client checks; `PROFILE_INCOMPLETE` links.

**Changed tests:** `authHardening.test.js` used one-letter names that FR5.1 now rejects; they use two-letter names.

**Manual checks:** live check through the gateway on alternate ports (Core :3100, AI :8100, Gateway :8180): **13 of 13 passed** (name rules, the former 500 now a 400, exact error paths, date normalisation, skill de-duplication, summary-only save, email key rejected, GitHub username rule, `PROFILE_INCOMPLETE`, the AI verify 422 shape). Test users and data removed afterwards.

## 08 — CV parser completeness (reconstructed)

**Date / commit:** 2026-10-12 · `4254e18` · note: `docs/changes/08-parser-completeness.md`

**Automated tests:** AI **187 passed + 1 skipped** (from 53), Core **210**, Gateway **42**, frontend `node --test` **24**, Vitest **16**.
- `test_file_checks.py` (21) — file signatures (renamed PNG/DOCX/PDF), encrypted files, size, `NO_TEXT_FOUND`, `DOC_UNSUPPORTED` without LibreOffice, mocked conversion, temp cleanup; the real-LibreOffice test is **skipped (not installed)**.
- `test_date_parser.py` (42) — table-driven over every supported date format and invalid input.
- `test_extraction.py` (43) — experience/education dates, headers, needsReview, certifications, project heuristics.
- `test_parsed_normaliser.py` (28) — property-style: every verify error is a field the entry flags.
- `test_parse_integration.py` (2) — PDF and DOCX upload → parse → verify only on flagged fields → verified.
- Core `cvSourceParsed.test.js`; frontend `cvImport.test.js`, `ParsedSummary.spec.jsx`.

**Changed tests:** junk-byte "PDFs" now hit `INVALID_FILE_TYPE`; placeholder `%PDF` → `%PDF-1.4`; the fake extractor gained `extract_certifications`; one verify test sends dates.

**Manual checks:** live check through the gateway (Core :3100, AI :8100, Gateway :8180): **15 of 15 passed** — PNG named `.pdf`, encrypted PDF, `.doc` without LibreOffice, image-only PDF, a full PDF upload → parse → the frontend's import mapping → profile save, verify, the DOCX path. Test data removed afterwards.

## 09a — Skill embeddings (reconstructed)

**Date / commit:** 2026-10-13 · `7058c22` · note: `docs/changes/09a-skill-embeddings.md`

**Automated tests:** AI **236 passed, 1 skipped, 1 deselected (slow)**; AI slow **1 passed**; Core **220**; Gateway **46**; frontend `node --test` **25**, Vitest **20**.
- `test_embeddings.py` (49) — normalisation and aliases, the embedder (384-dim, unit length, deterministic; the real model can't load in unit tests), the vector cache, parse-time embeddings, user skill profiles (no weights, no profile vector), API, the re-embed script.
- Slow test — real model: cos(React, Next.js) > cos(React, Accounting).
- Core `skillEmbeddingSync.test.js` — merged skills pushed in order with the internal key; retries; saves never wait.
- Gateway — `/api/embeddings/*` proxied to AI; internal paths blocked.
- Frontend — `EMBEDDINGS_PENDING` / `MODEL_LOADING` never log out; the skill map card.

**Manual checks:** live check (UI :5175 → gateway :8180 → Core :3100 / AI :8100, real model): **15 of 16 passed**. The one failure was in the check script itself (Recharts splits a two-word label into two `<tspan>` elements); the label displays correctly. Evidence: save 200 in 53 ms, profile embedded 156 ms after the save, 6 unit-length 384-dim vectors, `/me/map` 31 ms, parse-time embedding about 100 ms after the response. Test data removed afterwards.

## 09a2 — Embedding model selection: curated descriptions and bge-small (reconstructed)

**Date / commits:** 2026-10-14 · `00da5d7` (Stage 1, 985 curated descriptions) · `92b54e6` (Stage 2, model switch) · note: `docs/changes/09a2-embedding-model-selection.md`

**Automated tests:** after Stage 1, AI **265**; after Stage 2, AI **289 passed, 1 skipped, 2 slow deselected**; AI slow **1 passed + 1 xfailed** (Redux ↔ Redis); Core **220**; Gateway **46**; frontend **25** / **21**.
- `test_embeddings_descriptions.py` (24) — description text, provider chain, an invalid curated file fails fast, cache identity by embedded text, re-embedding on a changed description, model/mode separation, the unknown-skills endpoint, 384 and 768 dimensions, the threshold guard, the re-embed migration.
- `test_skill_descriptions.py` — the curated file passes `check_skill_descriptions.py`; the 283 seed entries are unchanged; the file is never the CV parser's vocabulary; "linear regression" / "sanity testing" do not produce "Linear" / "Sanity".
- `test_skill_aliases.py` — every previous canonical name is an alias of the new one.

**Evaluation:** benchmark v1 (`docs/evaluation/embedding-benchmark-2026-10-13/`) — see TEST_CATALOG.

**Manual checks:** text-format check reproduces the benchmark's similarities within **0.0003** on average; model load **1.0–1.2 s** (cached), RAM **568 MB** with the model loaded, **21 ms per described skill**; re-embed run: 7 keys, dry run wrote nothing, real run embedded 7 and updated 1 profile in 0.37 s. Live check (UI :5175 → gateway :8180 → Core :3100 / AI :8100): **13 of 13 passed** (status card "bge-small-en-v1.5", "6 of 7 skills described", unknown-skills endpoint, closest pairs React ↔ Next.js 0.89). Test data removed afterwards.

## Threshold 0.72 → 0.73 after benchmark v2 (reconstructed)

**Date / commit:** 2026-10-14 · `cee7507` · note: 09a2 "Revision (v2)"

**Automated tests:** suite counts not recorded. The threshold assertions in `test_embeddings_descriptions.py` and the slow tests in `test_embeddings.py` were updated; React ↔ Python (0.776) became a second strict xfail.

**Evaluation:** benchmark v2 (`docs/evaluation/embedding-benchmark-2026-10-14/`, 337 pairs incl. 92 hard negatives) — see TEST_CATALOG.

**Manual checks:** the slow real-model test asserts cos(React, Next.js) 0.889 > 0.73 > cos(React, Accounting) 0.646 and cos(Celery, Cooking) 0.580 < 0.73.

## 09b — Profession database (O*NET + ESCO) and the FAISS role-skill index (reconstructed)

**Date / commit:** 2026-10-14 · `3483abe` · note: `docs/changes/09b-professions-and-index.md`

**Automated tests:** AI **340 passed, 1 skipped** (+51 in `test_professions.py`); Core **229** (+9 in `adminProfessions.test.js`); others not recorded.
- `test_professions.py` — dataset file and column validation (BOM, multi-line labels, `_en` and plain names), label cleaning, O*NET and ESCO selection rules, preview writes nothing, publish, deactivation of missing professions, admin overrides survive re-imports, index states / persistence / state-hash rebuild, `search_related` with controlled geometry and `mutual_nn`, CRUD routes.
- `adminProfessions.test.js` — the Core pass-through: admin-only, field mapping, AdminLog, error mapping, AI down → 503.

**Manual checks (real datasets, real model, local MongoDB):**
- Dry runs: O*NET 30 occupations (15-1299.00 excluded), 874 role skills / 171 distinct; ESCO 113 occupations, 6,762 relations, 1,313 distinct skill names, **13,939** ESCO skills (21 duplicate rows collapsed).
- Real imports: O*NET 15 s, ESCO 27 s; index **1,441** distinct role skills, build 0.41 s; files 2.2 MB + 1.3 MB; ~6 MB memory; full re-embed ~7 s.
- Services on alternate ports: index loaded from disk while the model loaded; admin pass-through create / 409 / soft delete; `/internal` → 404 through the gateway.
- Sample user React, Python, Docker, Figma: React → Python 0.776 with `mutual_nn: false` (the known false positive filtered).
- Test data removed; imported data kept.

## 09b2 Parts 1–2 — Role-skill description coverage (reconstructed)

**Date / commit:** 2026-10-15 · `e8e57a8` · note: `docs/changes/09b2-role-skill-descriptions.md`

**Automated tests:** AI **388 passed, 1 skipped** (5 of 5 full runs); professions + role-skill tests **20 of 20** loop runs (99 tests each).
- `test_role_skill_descriptions.py` — 22 alias cases, 7 "ambiguous word is not an alias" cases, ESCO and O*NET label maps, map targets described, the frozen-description exception.
- `test_index_renormalises_stale_stored_keys`.
- **Changed expectations:** description count bound ≤ 1,000 → ≤ 1,200; cleaning case "Epic Systems" → Epic EHR.

**Manual checks:** coverage measured before and after (`AIServices/eval/role_skill_coverage.py`): distinct described 12.0 % → 20.2 %, occurrences 25.9 % → 38.2 %, O*NET 80.0 % → 99.4 %, ESCO essential 4.7 % → 5.1 %. Real re-import: 23 O*NET and 66 ESCO professions updated, none added or removed; index 1,428 skills.

**Problems found by testing:**
- **Index build crashed on stale stored keys** (`KeyError: 'sas language'`) during the real re-import after an alias change → the build re-normalises stored names (fixed in `e8e57a8`).
- **Intermittent test failure** in `test_mutual_nearest_neighbour_flag` (1 in 9 runs): the stub embedder seeded unknown skills with Python's per-process `hash()` → SHA-256 seeding and orthogonal dimensions (fixed in `e8e57a8`; 20/20 and 5/5 runs after).

## 09b2 Part 3 — Benchmark v3: embedding ESCO phrase and knowledge skills (reconstructed)

**Date / commit:** 2026-10-15 · `49d18a3`

**Automated tests:** suite counts not recorded (the commit adds evaluation code and data only).

**Evaluation:** 153 hand-labelled pairs, 70 / 30 dev / held-out split; label-only ESCO text wins; guardrail not met — see TEST_CATALOG.

## 09b2 Part 4 — Frozen embedding configuration (reconstructed)

**Date / commit:** 2026-10-15 · `cc560fa`

**Automated tests:** AI **392 passed, 1 skipped**; AI slow **2 passed + 2 xfailed**.
- Threshold by kind with guards (other model, name text, ESCO description text), unknown kind → error; `search_related` reports the kind with one threshold; `test_background_credit_rate.py` (slow).

**Manual checks:**
- **0.61 mixed threshold rejected on real data:** share of undescribed role skills credited at 0.61 — web profile 60.4 %, chef profile 60.8 % (98 % of "artificial intelligence engineer"); at 0.73 — 6.0 % vs 2.8 %.
- **Background credit check:** chef 3.0 % vs web 12.2 % (ratio 0.25) → pass.
- Sample users with the real model and index: React → Python 0.776, described, not mutual → no credit.

**Problems found by testing:** the 0.61 mixed threshold (accepted on the held-out benchmark set) credited an unrelated profile as much as a related one — the benchmark negatives were not representative of real ESCO phrases. Rejected before commit.

## Housekeeping (git history only)

**Commit:** `4c69996` — removed a one-time `_gen_doc.py`, updated the 09b change notes. No tests recorded.

## 9c Part 1 — Taxonomy import jobs, lock, heartbeat (recorded)

**Date / commit:** 2026-10-15 · `d7a0596`

**Automated tests:** AI **410 passed, 1 skipped**; Core **229**; Gateway **46**; frontend **25** + **21**.
- `test_taxonomy_jobs.py` (18) — job lifecycle, illegal transitions refused, concurrent transitions (exactly one wins), background failure recorded without file contents, recovery after restart, the lock (exclusive, concurrent acquire, heartbeat renewal past the TTL, a dead holder's lock expires and can no longer renew or release a newer lock), service heartbeat, routes.

**Manual checks:** none.

## 9c Part 2 — Uploads, staging, ZIP safety, validation (recorded)

**Date / commits:** 2026-10-15 · `47361bd` · follow-up `9ca7e0d`

**Automated tests:** after `47361bd`: AI **444 passed, 1 skipped**; other suites not recorded. After `9ca7e0d`: AI **446**.
- `test_taxonomy_uploads.py` — accepted ZIPs (extra files skipped, a top-level folder), individual CSVs, version labels; validation failures stored in the job (missing files named exactly, wrong columns, not UTF-8, empty files); rejected uploads (zip-slip variants, symlinks, zip bomb, too many entries, duplicates, size limit while copying, not a ZIP); cancel; cleanup (finished, expired, orphan directories; running jobs untouched); routes.

**Manual checks:**
- Real ESCO v1.2.1 ZIP: 9.58 MB compressed, 49.39 MB uncompressed, 19 entries; uploaded 202 in 0.52 s, validated, 15 extra files ignored; rows 3,043 / 13,960 / 126,051 / 1,284 (identical to 09b).
- Follow-up, `AIServices/data/raw/` CSVs as individual parts: O*NET 1,016 / 54,269 / 31,821 rows and ESCO 3,043 / 13,960 / 126,051 / 1,284 rows, validated; ESCO without `skills_en.csv` → "Missing required file(s): skills_en.csv. ESCO needs …". Test jobs deleted.

## 9c Part 3 — Preview (FR12.5) (recorded)

**Date / commit:** 2026-10-15 · `95abfad`

**Automated tests:** AI **461 passed, 1 skipped**; AI slow **2 + 2 xfailed**; other suites not recorded.
- `test_taxonomy_preview.py` (15) — preview leaves live data untouched, staging collections carry the live indexes, diff sections (added / removed / changed / kept override / links / undescribed / categories), pagination, real checks on staged data, background warning and unavailable check, failed preview cleans up, cancel drops staged data, orphan cleanup, **UI path and CLI path give identical staged data and diff**, routes.

**Manual checks:** CLI dry runs of O*NET and ESCO on real data through the job pipeline: empty diff in every section, coverage identical (1,428 skills, 20.2 %), background check on the staged data chef 3.0 % / web 12.2 % (pass); the live index files and the newest live profession unchanged. Test jobs deleted.

**Problems found by testing:** the background check divided by zero when every role skill is described (empty sweep) → guarded; its `SystemExit` would have stopped the service from a background task → `CheckUnavailable`.

## 9c Part 4 — Publish, snapshots, restore, crash recovery (recorded)

**Date / commits:** 2026-10-15 · `e5e5524` · follow-up `a1060aa` (restore returns 202 and is polled)

**Automated tests:** after `e5e5524`: AI **482 passed, 1 skipped**; after `a1060aa`: AI **484**; other suites not recorded.
- `test_taxonomy_publish.py` — atomic swap of the staged data, identical index lists before and after, acknowledgement rule, live data changed since the preview, concurrent publish refused, rollback after a failure part-way, a rollback that cannot complete ends `failed`, **crash between the two renames recovered at startup**, recovery waits for a live lock, restore (and undoing a restore), data files restored, damaged snapshot refused, retention pools, CLI publish and its refusal, UI and CLI publishes give identical live data, routes; after `a1060aa` also polling, a restore failing part-way and a crashed restore.

**Manual checks:**
- Crash check on `ai_db_test` only: the half-swapped state (5 professions incl. 2 ESCO, 0 ESCO skills) was restored exactly at startup; job `rolled_back`; state hash OK.
- Real data, after an independent `mongodump` backup: O*NET publish from `data/raw/onet` (empty diff) and restore of the pre-publish snapshot through the running service; before / after publish / after restore identical in **all 12 measures** (counts, content hashes of every document, fingerprint, index state hash, FAISS file SHA-256, the five data files' SHA-256, coverage, background rates); profession search 200 with 21 matches. Test jobs and snapshots deleted.

**Problems found by testing:** the "live data changed" check ran before the lock was taken (found by the concurrent-publish test) → checked under the lock, fixed before commit.

## 9c Part 5 — Direct edits: profession overrides and skill taxonomy (recorded)

**Date / commits:** 2026-10-15 · `f5cf51e` · fix `ce47708`

**Automated tests:** after `f5cf51e`: AI **496 passed, 1 skipped**; after `ce47708`: AI **498**; other suites not recorded.
- `test_taxonomy_edits.py` — overrides survive re-imports and reset to the dataset value, deactivate / reactivate, refused edits leave no snapshot, **a description edit re-embeds only that skill**, **seed descriptions are read-only (409)**, alias edit and collision, create with validation, files keep their format, restoring the edit snapshot undoes edits, edits need the lock, a failed edit is undone; after `ce47708` the vector repair (with and without the model).
- **Session guard** in `tests/conftest.py`: the run fails if any real `app/data/*.json` file changed (tests use temporary copies).
- **Changed expectation:** the 09b test refusing title edits on imported professions now expects them to work as overrides.

**Manual checks** (real data, through the running service, after a fresh `mongodump` backup): a title override and its reset; a non-seed description edit (re-embedded only that skill); an alias edit; a seed edit → **409 `SEED_READ_ONLY`**; restore of the first edit snapshot. After the restore, the five data files' SHA-256, the index state hash and the FAISS file were identical to before, and `git status` showed no change under `app/data/`. Test snapshots deleted.

**Problems found by testing:** after restoring the old description, the skill had no vector for its restored text (the vector cache is not part of a snapshot) → `repair_vectors()` after every restore (`ce47708`); on the real data the re-embedded vector was bit-identical to the original (max difference 0.0). Also: the description checker took 2.4 s per call → substring pre-filter, 0.3 s, identical results.

## 9c Part 6 — Core pass-through, streamed uploads, audit (recorded)

**Date / commit:** 2026-10-15 · `7492aa7`

**Automated tests:** AI **506 passed, 1 skipped**; Core **247**; other suites not recorded.
- Core `adminTaxonomy.test.js` (18) — non-admin uploads refused before anything reaches AI, every route admin-only, uploads streamed with the verified admin id and only the allowed headers (no Authorization, no cookies), identity fields stripped, AI status/code passed through unchanged (7 cases), AI unreachable → 503, AdminLog for each action incl. refused ones, a failed log write keeps the response, a client abort stops the AI request with no job.
- AI — a spoofed `created_by` form field and body `actor` are ignored; missing or reserved admin ids refused before the body is read; a client disconnect leaves no job; `/sources`.

**Manual checks** (through the running Core → AI, temporary users): non-admin upload of the ESCO CSVs → **403 in 18 ms** with 384 KB of 42 MB sent, no job; admin upload with a spoofed form field and header → validated, `created_by` = the JWT admin; cancel; AdminLog shows `TAXONOMY_UPLOAD` (202) and `TAXONOMY_CANCEL` (200). Test job and temporary users deleted. Refused non-admin attempts record nothing beyond the request log, as for every other admin route.

## 9c Part 7 — Gateway: streamed upload, size limit, timeout, rate limit (recorded)

**Date / commits:** 2026-10-15 · `ed52928` · `a713844` (info line)

**Automated tests:** Gateway **62** (both commits); other suites not recorded.
- `taxonomyRoutes.test.js` (16) — default limits, upload streamed byte for byte, Content-Length over the limit → 413 with nothing forwarded, **every other admin route keeps 1 MB** (2 MB JSON → 413), chunked uploads counted and stopped at the limit, `Expect: 100-continue` → 413 before the body, upload timeout vs normal timeout, publish/restore rate limit (per user with a valid token, otherwise IP; forged / expired / `alg=none` tokens), `/internal/*` blocked.

**Manual checks** (gateway with the new code on :8180 → Core :3000 → AI :8000): ESCO CSVs 41 MB streamed in 1.2 s, validated, cancelled; 101 MB dummy → **413 in 7.5 ms with 0 body bytes sent** (curl's `Expect: 100-continue`) and **413 in 79 ms after 16.5 MB** without `Expect`, none of it forwarded; non-admin → 403. Test job and temporary users deleted.

**Problems found by testing:** an early 413 reached a still-sending client as a connection reset (Node closes a `Connection: close` request's socket as soon as the response is written) → the body is discarded up to 2 s / 16 MB and then answered (fixed before commit).

## Test record (recorded)

**Date:** 2026-10-15 · adds `scripts/run_all_tests.{py,ps1,sh}`, this log, `TEST_CATALOG.md`, `test-runs.md` and the
`CLAUDE.md` rule. The first automatic run is in [test-runs.md](test-runs.md).

## 9c Part 8 — Admin UI: Professions & Skills (recorded)

**Date:** 2026-10-16 · commit: see `git log` ("9c Part 8") · run: [test-runs.md](test-runs.md) entry of 2026-10-16 (Part 8 working tree)

**Automated tests** (run 2026-10-16 00:27, Part 8 working tree on `dd2fce2`, all PASS): AI **508 passed, 1 skipped**; AI slow **2 passed + 2 xfailed**; Core **247**; Gateway **62**; frontend `node --test` **31** (+6), Vitest **70** (+49). The interim run at 00:22 in test-runs.md predates the last polling fixes.
- FE `pages/admin/AdminTaxonomyPage.spec.jsx` (3) — five tabs; lock banner names the operation and the admin; lock polled every 2 s only while held.
- FE `pages/admin/taxonomy/DataSourcesTab.spec.jsx` (7) — counts and versions, O*NET / ESCO hints, attribution, upload progress and hand-over, 100 MB client check, 413 / 422 / 504 messages, disabled under the lock.
- FE `pages/admin/taxonomy/PreviewPublishTab.spec.jsx` (16) — loading / empty / error / failed / running / success, 409 messages, **publish button rules** (amber warning with chef and web rates, "I understand" required, never under the lock), polling only while running (incl. a just-uploaded job), paused while the tab is hidden.
- FE `pages/admin/taxonomy/HistoryTab.spec.jsx` (8) — snapshots, **restore dialog lists exactly what is undone and needs RESTORE typed**, 429 in the dialog, running restore polled until finished.
- FE `pages/admin/taxonomy/ProfessionsTab.spec.jsx` (8) — override markers, changed fields only, reset to dataset value, manual professions, 409 busy, disabled under the lock.
- FE `pages/admin/taxonomy/SkillTaxonomyTab.spec.jsx` (7) — seed read-only, Check, save reports re-embedding, 422 reasons, create, disabled under the lock.
- FE `pages/admin/taxonomy/taxonomyRules.test.js` (6, `node --test`) — publish rules, background warning, running states, lock label, error messages for 403 / 409 / 413 / 422 / 429 / 503 / 504, upload file checks.
- AI `test_taxonomy_jobs.py::test_lock_shows_who_holds_it`; `test_taxonomy_edits.py::test_restore_dialog_lists_every_edit_it_undoes`; extra assertions in `::test_edit_routes` (profession categories) and `test_taxonomy_publish.py` (publisher in the restore detail).

**Backend changes made for the UI:** the lock records its `actor`; edit snapshots record a `note` naming the edit; the restore detail names the publisher; the profession list returns the categories.

**Problems found by testing (fixed before commit):**
- **Restore dialog missed an edit:** `undone_by_restore` listed only edits whose snapshot was strictly newer than the restored one, but an edit snapshot is taken just before its own edit, so restoring it undoes that edit too (same for a pre-restore snapshot) → `$gte`; found by `test_restore_dialog_lists_every_edit_it_undoes`.
- **Field lost its label:** the "reset to dataset value" button sat inside the field's `<label>`; a button is labelable, so the label named the button and the input had no accessible name → label linked by `htmlFor`, tag outside it; found by `ProfessionsTab.spec.jsx`.
- **Just-uploaded job not polled:** an upload returns the job as `uploaded` and validation starts a moment later, but `uploaded` was not a polled state, so the page stayed on "Uploaded" → added; found while tracing the upload flow, test added.

**Manual check:** pending — browser walkthrough by the user (checklist below). Independent backup taken first: `~/.muqayyim/taxonomy/manual-backup-2026-10-16-part8` (mongodump of ai_db, 13 collections, plus the data and index files with SHA-256).

Walkthrough checklist (results to be added here):
1. Restart the AI service on :8000 (the UI uses the new lock / snapshot / category fields; Core, gateway and the Vite dev server need no restart). Sign in as admin.
2. Sidebar → Professions & Skills (no longer "Soon"). Data sources: O*NET and ESCO cards show versions, profession counts, ESCO skills and last update; both attribution lines are shown.
3. Switch Source between O*NET and ESCO: the hint lists exactly the needed files, the version field changes.
4. Choose a file over 100 MB: the size message appears and Upload is disabled.
5. Upload a text file renamed `fake.zip` as ESCO: a "Not accepted" box with the reason (422); no job appears.
6. Upload the three O*NET CSVs from `AIServices/data/raw/onet` (O*NET 31.0): progress bar, then the Preview & publish tab opens; the status moves Uploaded → Validating → Validated by itself; rows 1,016 / 54,269 / 31,821.
7. DevTools → Network: job requests every 2 s while it runs, none once it is Validated; switching to another browser tab during a run pauses them.
8. Run preview: "Building preview" with progress, then Ready to publish; every diff section 0, coverage live = new, background check passed (chef 3.0 % · web 12.2 %), no amber box. **Do not publish.**
9. Open the same job in a second browser tab, then Cancel job in the first: Cancelled. In the second tab click Cancel job: a 409 "Not possible now" message.
10. Professions: search "software developers", edit the title (add " (test)"), Save: toast, "Admin override" tag, row shows "override: title".
11. Click "reset to dataset value": the title returns, the tag disappears.
12. Skill taxonomy: open React (lock icon): description read-only with the seed note; aliases editable.
13. Open Tomcat (no lock icon): change the description, Check (passes), Save: "Saved — re-embedded Tomcat".
14. History: three "Before edit" snapshots with notes (title edit, reset, Tomcat description). Restore… on the newest: the dialog lists exactly one edit (skill "Tomcat": description — by your admin user id); Restore stays disabled until RESTORE is typed.
15. Confirm: "Restoring" banner and the lock banner ("Restoring a snapshot — by …"); while it runs, Save on the Professions tab is disabled (a second tab gets "Taxonomy busy" if you are quick). When it finishes: toast, Tomcat's description is the original again.
16. Optional: sign in as a job seeker and open `/admin/professions` → redirected away.
