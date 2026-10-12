# 05 — Central error logging, security events, critical alerts, admin log view

**Status:** implemented · **Date:** 2026-10-12 · **Affects:** CoreServices (backend and frontend), AIServices, API Gateway
**Requirements:** SRS FR-B11, REL-2, Module 10 FE-3, FR12.4

## Summary

Before this change, errors were only printed to the console: nothing was stored, admins had no view of them, there was no alerting, and some 500 responses leaked internal error text. Now:

- **Every service stores its errors.** Core and Gateway entries go to `core_db.error_logs`, AI entries to `ai_db.error_logs`. Each entry is masked and expires after `LOG_RETENTION_DAYS`.
- **Clients never see internals.** A 500 is `{ success: false, code: 'INTERNAL_ERROR', message, requestId }`, never a stack trace or exception text. Of Core's 53 hand-written 500s, 49 now go through one helper; 9 of those used to leak `error.message`.
- **Security events** are stored in `core_db.security_events` as well as the console.
- **Critical errors email all active admins,** throttled per service and error type.
- **Admin → Error Logs** shows errors from all services in one place, with filters, details and acknowledgement, plus security events. The dashboard shows 24-hour counts.

Writing a log never throws and never delays a request. If MongoDB is unavailable, the entry goes to the console instead.

## Log schema (`error_logs`)

| Field | Notes |
|---|---|
| `timestamp` | Date; TTL index (`LOG_RETENTION_DAYS`) |
| `level` | `warning` · `error` · `critical` |
| `service` | `core` · `ai` · `gateway` |
| `module` | e.g. `auth`, `profile`, `cv-generator`, `admin`, `internal`, `mailer`, `internal-client`, `database`, `process`, `unhandled`, `cv-parsing`, `cv-upload`, `proxy`, `rate-limit`, `gateway` |
| `errorType` | exception class (`TypeError`, `ServerSelectionTimeoutError`, …) or short code (`UPSTREAM_TIMEOUT`, `RATE_LIMIT_SPIKE`, `CV_TEXT_EXTRACTION_FAILED`, …) |
| `message` | masked, ≤ 1000 characters |
| `stack` | masked, ≤ 4000 characters; **only returned by the admin detail endpoint** |
| `requestId` | `X-Request-Id` of the failing request |
| `userId` | when known (from the verified JWT) |
| `method`, `path` | path **without** query string |
| `statusCode` | HTTP status sent, when applicable |
| `acknowledged`, `acknowledgedBy`, `acknowledgedAt` | set by an admin |

Indexes: `{ timestamp: -1 }`, `{ service, level, timestamp: -1 }`, and the TTL index `timestamp_ttl`.

**`security_events`** (core_db): `timestamp`, `event`, `userId`, `ip`, `requestId`, `details` (masked). It has the same TTL, plus indexes on `{ timestamp: -1 }`, `{ event, timestamp }` and `{ userId, timestamp }`.

The TTL index is checked when each service starts. If `LOG_RETENTION_DAYS` has changed, it is updated in place with `collMod` rather than dropped and rebuilt.

## What is logged, and at which level

| Level | Core | AI | Gateway (stored in Core) |
|---|---|---|---|
| **critical** | MongoDB connection failure or loss (`database`); `unhandledRejection` and `uncaughtException` (`process`, then exit as Node expects); any 500 caused by a DB connection error | MongoDB connection failure at startup; any unhandled error caused by a DB connection error (`ServerSelectionTimeoutError`, `ConnectionFailure`, …) | `unhandledRejection` / `uncaughtException` |
| **error** | Any unhandled error (final Express error middleware, module `unhandled`); every route handler's 500 (`handleServerError`, module per file); mailer send failures (`mailer`) | Unhandled exceptions (global handler, `unhandled`); upload, verify and summary failures | 502 `UPSTREAM_UNAVAILABLE` and 504 `UPSTREAM_TIMEOUT` (`proxy`); unhandled gateway errors (`gateway`) |
| **warning** | AIServices unreachable or failing for Core's calls (`internal-client`) | CV parsing failures: corrupted, empty or image-only file and extraction errors (`cv-parsing`, user-caused but recorded per FR-B11/REL-2); CV-status sync to Core failing after retries; auth-state lookup failing because Core is unavailable (`internal-client`, at most one per minute) | `RATE_LIMIT_SPIKE`: one entry when an IP hits rate limits more than 20 times in 10 minutes (individual 429s are not logged) |

Malformed JSON request bodies are client errors and return 400 `INVALID_JSON`; they are not logged.

### How entries reach storage
- **Core and AI** write directly to their own collection, fire-and-forget. A failed write falls back to one console line, without the stack.
- **The Gateway** has no database. It batches entries (up to 20, or every 1 s) and sends them to Core's `POST /internal/logs` with `X-Internal-Key` and a 2 s timeout. If Core is unreachable they go to the console.
- **`POST /internal/logs`** (Core, internal key required) accepts one entry or an array of at most 50. Each entry is validated (`level` and `message` required), restricted to the known fields, masked, and stored with `service: 'gateway'`. Responses: 401 without a key, 403 with a wrong one, 400 for more than 50 entries or an invalid entry, 202 when accepted.

## Masking rules

These are implemented the same way in `CoreServices/backend/utils/mask.js` and `AIServices/backend/app/utils/mask.py`:

- **Keys:** any key matching `/pass(word)?|token|secret|authorization|api[-_]?key|internal[-_]?key|cookie/i`, at any depth in objects and arrays, has its value replaced with `[REDACTED]`.
- **Strings:**
  - JWTs (`eyJ…`) and other three-segment base64url tokens → `[REDACTED_JWT]`
  - `Bearer …` / `Basic …` → `Bearer [REDACTED]`
  - credentials in URLs (`scheme://user:password@host`) → the password is redacted
  - `password=…`, `token: …`, `api_key=…` (and the other sensitive keys) as key/value pairs inside text → the value is redacted
- **Length:** messages are limited to 1000 characters, stacks to 4000.
- **Never stored:** request bodies, headers, file contents or query strings. Only known fields are written, and the gateway's entries are re-masked by Core.

The masking is checked by tests, and a live run scanned every stored entry for the test passwords, JWTs and the internal key. None were found.

## Critical alerts

- **Who gets them:** every active admin. Core keeps the admin email list cached in memory (refreshed every 10 minutes, and whenever admin accounts change), so an alert still goes out when MongoDB itself is down.
- **AI-side critical errors:** AIServices calls Core's `POST /internal/alerts` (internal key required), and Core sends the email.
- **Throttle:** at most one email per (service, errorType) per `ALERT_THROTTLE_MINUTES`, kept in memory in Core.
- **Content:** service, module, error type, masked message, request ID and UTC time. Never the stack.
- **Off switch:** `ALERTS_ENABLED=false` disables them.
- **Failure handling:** if the alert email itself fails, that is written to the console only, never to the error log, so a mail outage can't cause an alert loop.

## Admin screens and API

**Admin API** (Core, admin role only; non-admins get 403):

| Endpoint | Purpose |
|---|---|
| `GET /api/admin/logs/errors` | Core, Gateway and AI entries merged newest first. Filters: `service`, `level`, `module`, `from`, `to`, `search` (message / errorType / requestId), `acknowledged`, `page`, `limit` (≤ 100). If AIServices is unreachable: Core results plus `partial: true` and a `notice` |
| `GET /api/admin/logs/errors/:service/:id` | Full entry including the stack |
| `PATCH /api/admin/logs/errors/:service/:id/acknowledge` | Marks the entry acknowledged (AI entries via the internal endpoint) and writes AdminLog `ACK_ERROR_LOG` |
| `GET /api/admin/logs/security` | Security events; filters `event`, `userId`, `from`, `to`; paginated |
| `GET /api/admin/logs/summary` | Last 24 h counts by service and level (AI via an internal call; `partial` if unreachable) |

AIServices' internal endpoints (internal key, never proxied): `GET /internal/logs/errors` (same filters), `GET /internal/logs/errors/{id}`, `PATCH /internal/logs/errors/{id}/acknowledge`, `GET /internal/logs/summary`.

**Admin UI:**
- **Error Logs** (new sidebar item, `/admin/logs`):
  - a table of time, level badge, service, module, type, truncated message, request ID and acknowledged
  - filters for service, level, module, date range, search and unacknowledged only, with pagination
  - clicking a row opens a drawer with the full message, stack trace, request ID (with a copy button) and an Acknowledge button
  - a notice when results are partial
- **Security Events tab:** the same pattern (filters for event, user ID and date range), with a details drawer.
- **Dashboard:** an "Errors in the last 24 hours" card with critical, error and warning counts, a link to Error Logs, and a notice when the counts are partial.

## Environment variables

| Service | Variable | Default | Purpose |
|---|---|---|---|
| CoreServices | `LOG_RETENTION_DAYS` | `30` | TTL for `error_logs` and `security_events` |
| CoreServices | `ALERTS_ENABLED` | `true` | Email admins on critical errors |
| CoreServices | `ALERT_THROTTLE_MINUTES` | `15` | One email per (service, errorType) per window |
| AIServices | `LOG_RETENTION_DAYS` | `30` | TTL for `ai_db.error_logs` |
| API Gateway | `INTERNAL_API_KEY` (new for the gateway) | — | Sends logs to Core; must equal Core's key. Without it, gateway errors go to the console only |
| API Gateway | `RATE_LIMIT_SPIKE_THRESHOLD` / `RATE_LIMIT_SPIKE_WINDOW_MINUTES` | `20` / `10` | Spike warning rule |

## Tests

| Suite | Result | New coverage |
|---|---|---|
| CoreServices Jest | **115 passed** (32 new) | **Masking:** nested keys and arrays, JWT / Bearer / URL credentials / key=value in text, truncation, cycles. **Error handling:** a route that throws → 500 `INTERNAL_ERROR` with requestId, no internals in the body, entry stored with every field, path without query, JWT masked; a DB connection error → critical; a failing log write still returns the 500 (console fallback); a handler 500 stores module, user and requestId; malformed JSON → 400, not logged; the TTL index is created and updated in place. **`/internal/logs`:** 401 / 403 / 400 (more than 50 entries, invalid), batch accepted, stored masked and as `gateway`, extra fields dropped. **Alerts:** critical → one email to active admins only, without the stack; a repeat within the window → no email; a different error type → a new email; errors and warnings never alert; `ALERTS_ENABLED=false` → none; a failed alert email doesn't create log entries; `/internal/alerts` is authenticated and throttled. **Admin API:** non-admin 403; merge order, merged pagination, filters, limit cap; AI down → `partial` with Core results (and Core logs an `internal-client` warning); detail with stack; acknowledge writes AdminLog; security events; summary |
| AIServices PyTest | **44 passed** (14 new) | Masking; unhandled exception → clean 500 with requestId and an entry in a real `ai_db_test` (stack stored, JWT masked); DB error → critical plus an alert request; a failing log write → console fallback; corrupted CV → `cv-parsing` warning; CV-status sync failure → warning; Core unavailable for auth-state → one warning per minute; TTL index from `LOG_RETENTION_DAYS` and updated in place; internal log endpoints (auth, filters, pagination, detail with stack, acknowledge, summary) |
| API Gateway Jest | **42 passed** (7 new) | 502 and 504 → entry POSTed to `/internal/logs` with the internal key; unhandled error → JSON 500 with a reference and an entry; batching (20 + 5); Core unreachable → console without the key; 30 limit hits from one IP → exactly one `RATE_LIMIT_SPIKE`; the detector re-arms after the window |
| Frontend | **14 `node --test` + 6 Vitest** | `AdminLogsPage.spec.jsx` (new, Vitest + Testing Library + jsdom): renders entries from all services; service, level, unacknowledged, module and search filters call the API with the right params; dates are sent as ISO; clicking a row loads the stack and acknowledging updates the row; partial notice; security tab and event filter |

A live run across all three services and the browser (Edge, alerts off) passed all 20 checks:
- a Core handler error stored and returned as `INTERNAL_ERROR` with a reference
- a corrupted CV recorded as an `ai_db` warning
- a security event stored
- exactly one rate-limit spike entry
- the dashboard card, the merged list from all three services, the service filter, the drawer with stack and Acknowledge (AdminLog written)
- the security tab
- with AI stopped: a gateway 502 stored in Core and partial notices on the page and the dashboard

## SDS updates needed

| SDS item | Update |
|---|---|
| **§3.5 schemas** | Add **`error_logs`** (core_db and ai_db) and **`security_events`** (core_db) with the fields and indexes above, including the TTL index on `timestamp` (`LOG_RETENTION_DAYS`, default 30). State that Gateway entries are stored in core_db with `service: 'gateway'`, and that stacks are stored but only exposed to admins |
| **Table 3.1** (Admin Panel / monitoring) | Add `GET /api/admin/logs/errors`, `GET /api/admin/logs/errors/{service}/{id}`, `PATCH …/acknowledge`, `GET /api/admin/logs/security`, `GET /api/admin/logs/summary`. Add the internal endpoints `POST /internal/logs`, `POST /internal/alerts` (Core) and `GET/PATCH /internal/logs/…` (AI). Add the 500 shape `{ success, code: 'INTERNAL_ERROR', message, requestId }` |
| **§4.3 Security Techniques** | Add **centralised, masked error logging** (no credentials, tokens, bodies, headers or file contents; JWT and credential redaction; size limits), **no stack traces to clients** (reference request ID instead), the **security event audit trail**, **critical alerting** to admins with throttling, and **log retention** via TTL |
| **Module 10 FE-3** ("monitoring of system health and error logs") | Status: **implemented**. System Health (existing) plus Error Logs and Security Events (new): view, filter, inspect and acknowledge errors from Core, AIServices and the Gateway in one place, with 24 h counts on the dashboard and email alerts for critical errors. FR12.4 ("logs include timestamps and error types; sensitive data masked") is met |

## Notes

- **Per-instance memory:** the alert throttle and the gateway spike detector are in memory, so each process tracks its own. That's correct for a single instance of each service.
- **A known gap found in the live run:** sending a malformed value to `PUT /api/profile` (for example `experience: "not-an-array"`) returns 500 instead of a 400 validation error. That behaviour predates this change; it's now logged as `CastError` in module `profile` and should get input validation separately.
