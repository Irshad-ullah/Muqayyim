# 01 — Service separation and server-owned CV status

**Status:** implemented · **Date:** 2026-10-12 · **Affects:** CoreServices, AIServices, API Gateway, CoreServices frontend

## Summary

Before this change, CoreServices and AIServices shared one MongoDB database (`muqayyim`). CoreServices read the AI service's `cv_parsed_data` collection directly through a Mongoose model (`CvData.js`). The browser also set its own `cvStatus` through `PATCH /api/auth/cv-status`, so any user could mark themselves "Verified".

Now:

1. **Each service has its own database.** CoreServices uses `core_db` and AIServices uses `ai_db`. Both are on the same MongoDB server.
2. **CoreServices never touches AI collections.** When it needs parsed CV data (only the CV generator's fallback), it asks AIServices over internal HTTP.
3. **The server owns the CV status.** AIServices pushes every status change to CoreServices over an internal REST call protected by a shared key. No browser-facing API can change it.
4. **One status enum is used everywhere:** `not_uploaded | uploaded | processing | parsed | verified | failed`.

```
Browser ──► API Gateway :8080 ──► CoreServices :3000 (core_db)
                 │   /internal/* → 404     ▲ PUT /internal/users/:id/cv-status
                 │                         │ X-Internal-Key
                 └──► AIServices :8000 (ai_db) ─┘
                        ▲ GET /internal/cv/:userId/latest (X-Internal-Key)
                        └── CoreServices (CV generator fallback only)
```

## What changed

### CV status lifecycle

| Event (AIServices) | Status pushed to CoreServices |
|---|---|
| `POST /api/cv/upload` succeeds | `uploaded` |
| `POST /api/cv/parse/{file_id}` starts | `processing` |
| Parse succeeds | `parsed` |
| Parse fails (empty, corrupted or image-only file, extraction error) | `failed` |
| `PUT /api/cv/verify` (user confirms extracted data) | `verified` |

The AI-side `cv_parsed_data.parsing_status` uses the same values. The old value `completed` is now `parsed`.

**Delivery guarantees** (`AIServices/backend/app/services/core_client.py`):
- `notify_cv_status` makes up to 3 attempts. It uses a 5s timeout (1s to connect) and waits 0.5s, then 1s, between attempts. It does not retry a 4xx response. On final failure it logs `user_id` and `status` and never raises.
- Routes call `push_cv_status`. It delivers each user's updates in order, for example `processing` before `parsed`. It waits at most 1.5s for delivery. If CoreServices is slow or down, the retries carry on in the background, so the user's upload or parse still succeeds and is delayed by at most about 1.5s per status.
- The frontend re-reads the status from CoreServices after upload, parse and verify. While the status is `processing` it polls every 2s, stopping after 30s or when the status settles (`parsed`, `failed` or `verified`). It never sets the status itself.

### CoreServices

| File | Change |
|---|---|
| `backend/models/CvData.js` | **Deleted** |
| `backend/constants/cvStatus.js` | **New.** The six-value enum |
| `backend/middleware/internalAuth.js` | **New.** `requireInternalKey`: compares the `X-Internal-Key` header with `crypto.timingSafeEqual` and handles a length mismatch. Missing key → 401, wrong key → 403 |
| `backend/routes/internalRoutes.js`, `backend/controllers/internalController.js` | **New.** `PUT /internal/users/:userId/cv-status` with body `{ status }`. Invalid status → 400, unknown user → 404, success → 200 `{ cvStatus }` |
| `backend/services/aiServiceClient.js` | **New.** axios client (5s timeout) for `GET /internal/cv/:userId/latest`. Returns `null` when there is no CV or AIServices is unreachable |
| `app.js` | **New.** The Express app without DB connection or listen. Mounts `/api/*` and `/internal/*` separately, so tests can import it |
| `server.js` | Loads env, connects the DB, seeds the admin and listens (app setup moved to `app.js`) |
| `backend/config/db.js` | Uses `CORE_DB_NAME` (default `core_db`), with `DB_NAME` as a fallback |
| `backend/models/User.js` | `cvStatus` enum is now the six lowercase values; default `not_uploaded` |
| `backend/controllers/authController.js`, `backend/routes/authRoutes.js` | Removed `PATCH /api/auth/cv-status` and `updateCVStatus`. Removed the "self-heal" check that read `cv_parsed_data`. `GET /api/auth/cv-status` remains, read-only |
| `backend/controllers/profileController.js`, `backend/routes/profileRoutes.js` | Removed `GET /api/profile/cv-data`; the frontend now uses `GET /api/cv/latest` |
| `backend/services/cvSourceService.js` | The CV generator gets the parsed CV from AIServices over internal HTTP and uses it only when its status is `parsed` or `verified`. If AIServices is down, it builds the CV from profile data alone instead of returning 500 |
| `backend/admin/services/providers/cvMetricsProvider.js` | Counts by the new enum. `parsedCVs` now means `parsed` + `verified`. Adds `verifiedCVs` and `failedCVs` |
| `tests/*.test.js`, `package.json` | Jest + supertest added; `npm test` script; `axios` dependency |

### AIServices

| File | Change |
|---|---|
| `app/constants/cv_status.py` | **New.** The six-value enum |
| `app/services/core_client.py` | **New.** `notify_cv_status` and `push_cv_status` (see above) |
| `app/middleware/internal_auth.py` | **New.** `require_internal_key` dependency using `secrets.compare_digest` (401/403) |
| `app/routes/internal_routes.py` | **New.** `GET /internal/cv/{user_id}/latest` (internal key required) |
| `app/routes/cv_routes.py` | Status pushes at the points listed above. Records `processing`/`failed` on the user's CV record. **New** `GET /api/cv/latest` (JWT; user taken from the token) returns `{ success, cvData, status, uploadDate }` |
| `app/models/cv_model.py`, `app/schemas/cv_schema.py` | `parsing_status` defaults to `parsed`; verify uses `verified` |
| `app/config/settings.py`, `app/config/database.py` | `AI_DB_NAME` (default `ai_db`, with `DATABASE_NAME` as a fallback), `CORE_SERVICE_URL`, `INTERNAL_API_KEY` |
| `app/main.py` | Mounts the internal router |
| `tests/`, `pytest.ini` | **New** PyTest suite |

The existing verify endpoint (`PUT /api/cv/verify`, which checks the record belongs to the token's user) is reused, so no new verify route was added.

### API Gateway

| File | Change |
|---|---|
| `app.js` | **New.** The app without listen. Answers `/internal/*` with 404 **before** any proxy runs, so internal routes can't be reached from outside |
| `server.js` | Listen only |
| `tests/internal.test.js`, `package.json` | Jest + supertest; checks that `/internal/*` returns 404 and is never forwarded upstream |

### Frontend (`CoreServices/frontend`)

| File | Change |
|---|---|
| `src/constants/cvStatus.js` | **New.** Enum and display labels: Not Uploaded, Uploaded, Processing, Parsed, Verified, Failed |
| `src/components/CVStatusBadge.jsx` | All six statuses. The stepper is Not Uploaded → Uploaded → Processing → Parsed → Verified; Failed shows in red at the Processing step |
| `src/pages/CVParsingPage.jsx` | No status writes. Re-reads the user after upload, parse and verify, and polls while processing |
| `src/pages/DashboardPage.jsx`, `ProfilePage.jsx`, `admin/AdminUsersPage.jsx` | New enum values and labels; Parsed and Failed messages on the dashboard |
| `src/services/authService.js` | Removed `updateCVStatus` |
| `src/services/profileService.js` | Removed `getCVData` |
| `src/services/cvService.js` | Added `getLatestCV()` → `GET /api/cv/latest` |
| `src/components/profile/steps/Step2CVImport.jsx` | Imports from `/api/cv/latest`; only offers `parsed` or `verified` data |
| `src/components/profile/steps/Step6Review.jsx` | Shows the status label |

`AIServices/frontend` (the older standalone Module 2 UI) no longer calls `PATCH /api/auth/cv-status`.

## Environment variables

| Service | Variable | Example | Notes |
|---|---|---|---|
| CoreServices | `CORE_DB_NAME` | `core_db` | Replaces `DB_NAME` (still read as a fallback; **remove it** or it overrides the default) |
| CoreServices | `AI_SERVICE_URL` | `http://localhost:8000` | Replaces `CV_SERVICE_URL` |
| CoreServices | `INTERNAL_API_KEY` | 64 hex chars | Must equal the AIServices value |
| AIServices | `AI_DB_NAME` | `ai_db` | Replaces `DATABASE_NAME` (still read as a fallback) |
| AIServices | `CORE_SERVICE_URL` | `http://localhost:3000` | |
| AIServices | `INTERNAL_API_KEY` | same as Core | |

`MONGODB_URL` is unchanged and shared by both services. Generate the key with:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Templates: `CoreServices/.env.example`, `AIServices/backend/.env.example` (also `AIServices/.env.example`), `API Gateway/.env.example`. The internal key and JWTs are never logged.

## Running the migration

`scripts/migrate-split-databases.js` (repo root) copies:
- every collection in the source database except `cv_parsed_data` into `core_db` (users, profiles, generatedcvs, adminlogs, systemconfigs, professions, skilltaxonomies, interviewdomains, questionbanks)
- `cv_parsed_data` into `ai_db`

It also maps old values:
- `users.cvStatus`: `Not Uploaded` → `not_uploaded`, `Uploaded` → `uploaded`, `Processing` → `processing`, `Verified` → `verified`
- `cv_parsed_data.parsing_status` and `profiles.cvData.parsingStatus`: `completed` → `parsed`

It upserts by `_id`, so it is safe to re-run. It recreates secondary indexes (such as the unique email index) and **never modifies or deletes the source database**.

```bash
# from the repo root; reads MONGODB_URL from CoreServices/.env
node scripts/migrate-split-databases.js --dry-run   # print counts only
node scripts/migrate-split-databases.js             # copy

# optional overrides
SOURCE_DB_NAME=muqayyim CORE_DB_NAME=core_db AI_DB_NAME=ai_db node scripts/migrate-split-databases.js
```

Rollout order:
1. Stop the services.
2. Run the dry run, then the migration.
3. Update the `.env` files.
4. Start CoreServices, AIServices and the Gateway.

Once everything checks out, the old `muqayyim` database can be dropped by hand.

## Tests

| Suite | Command | Covers |
|---|---|---|
| CoreServices (Jest) | `cd CoreServices && npm test` | `requireInternalKey` (missing → 401, wrong → 403 including a length mismatch, correct → next); `PUT /internal/users/:id/cv-status` (no key, wrong key, invalid status → 400 with DB unchanged, valid → 200 with DB updated, unknown user → 404); `PATCH /api/auth/cv-status` → 404; `PUT /api/auth/profile` ignores `cvStatus`; a user JWT can't use `/internal` |
| API Gateway (Jest) | `cd "API Gateway" && npm test` | `/internal/*` → 404 and not proxied; `/api/*` still proxied |
| AIServices (PyTest) | `cd AIServices/backend && venv/Scripts/python -m pytest` | `notify_cv_status`: 3 attempts with backoff, then logs (key not logged); retry on 5xx, none on 4xx; ordered non-blocking `push_cv_status`. Parse flow: processing → parsed; processing → failed for a corrupted PDF (real parser) and for an extraction error; upload → uploaded; verify → verified; `/api/cv/latest`; internal route auth |

Core Jest tests use a throwaway `core_db_test` database on the local MongoDB, dropped after the run.

## SDS sections to update

| SDS section | What to change |
|---|---|
| **§3.3.3** (service/component interaction) | Replace "both services share one MongoDB database" with database-per-service: CoreServices → `core_db`, AIServices → `ai_db`, same cluster. Add the two internal REST interfaces: AIServices → CoreServices `PUT /internal/users/{userId}/cv-status`, and CoreServices → AIServices `GET /internal/cv/{userId}/latest`. Both use `X-Internal-Key` and are not exposed through the gateway. Remove the direct read of `cv_parsed_data` by CoreServices |
| **Table 3.1** (APIs / endpoints) | Remove `PATCH /api/auth/cv-status` and `GET /api/profile/cv-data`. Add `GET /api/cv/latest` (JWT), `PUT /internal/users/{userId}/cv-status` (internal), `GET /internal/cv/{userId}/latest` (internal), and `/api/generated-cvs/*` if not already listed. Mark `GET /api/auth/cv-status` read-only. Note that the gateway rejects `/internal/*` with 404 |
| **§3.5 schemas** | `users.cvStatus`: enum `not_uploaded, uploaded, processing, parsed, verified, failed`, default `not_uploaded`. `cv_parsed_data.parsing_status`: same enum (was `completed`/`verified`). Show `users`, `profiles`, `generatedcvs` and the admin collections under `core_db`, and `cv_parsed_data` under `ai_db`. Remove the CoreServices `CvData` model |
| **§4.1.1 Stage 6** (CV upload/parse/verify flow) | The frontend no longer reports status. After each step AIServices pushes the status to CoreServices (`uploaded` → `processing` → `parsed`/`failed` → `verified`) with retries. The UI re-reads the status from CoreServices and polls while it is `processing` |
| **Integration Test 1, row 2** | Expected result: after upload and parse, `GET /api/auth/profile` returns `cvStatus = parsed` (then `verified` after verification) **without any client status call**. A corrupted file gives `failed`. `PATCH /api/auth/cv-status` returns 404 |
| **State diagram 3.17** (CV status) | States: Not Uploaded → Uploaded → Processing → {Parsed → Verified, Failed}. Failed → Uploaded on re-upload. Every transition is triggered by AIServices, not the user. Update the state names to the lowercase enum, and add Parsed and Failed |

Also outdated: the architecture section of `README.md` still shows one shared `muqayyim` database and lists `CV_SERVICE_URL`.
