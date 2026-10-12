# 04 — Gateway hardening: rate limits, size limits, timeouts, headers, request IDs

**Status:** implemented · **Date:** 2026-10-12 · **Affects:** API Gateway, CoreServices, AIServices, CoreServices frontend; removes `AIServices/frontend`
**Requirements:** SDS §3.3.2, Table 3.1, SRS SEC-3

## Summary

| Area | Before | After |
|---|---|---|
| Rate limiting | None | Per-IP limits on all `/api` routes and stricter ones on login, register, password reset and CV upload → **429 `RATE_LIMITED`** |
| Request size | Unlimited at the gateway | `Content-Length` check before proxying → **413 `PAYLOAD_TOO_LARGE`** (6 MB for CV upload, 1 MB elsewhere) |
| Upstream problems | 502 with an ad-hoc message; no timeout | **504 `UPSTREAM_TIMEOUT`** (30 s, or 60 s for upload) and **502 `UPSTREAM_UNAVAILABLE`**, always JSON |
| Security headers | None; `X-Powered-By: Express` leaked | `helmet` headers on every response; `X-Powered-By` removed, including from proxied responses |
| Request IDs | None | `X-Request-Id` on every request and response, forwarded to Core and AI, and present in gateway, rate-limit and security logs |
| Frontend URLs | Fell back to `:3000` / `:8000`, plus three env vars | One `VITE_API_BASE_URL`, used by every client; the frontend talks only to the gateway |
| Second frontend | `AIServices/frontend` (:5173) | **Removed**, along with its CORS origins, env vars, docs and the JS-readable `muqayyim_jwt` cookie it relied on |

Routes, auth logic and service behaviour are unchanged. JWTs are still verified in each service, not at the gateway.

## Middleware order (API Gateway)

```
request → X-Request-Id → helmet → CORS (+ OPTIONS preflight)
        → /internal/* → 404
        → rate limits (global /api, then route-specific)
        → size limit (Content-Length)
        → proxy (timeouts, JSON 502/504, strip downstream CORS/X-Powered-By)
```

No body parser runs before the proxies, so request bodies (for example CV uploads) are streamed untouched.

## Rate limits

Keyed by client IP (`req.ip`, which honours `TRUST_PROXY`). `/health` and OPTIONS preflight are never limited. `RATE_LIMIT_ENABLED=false` turns everything off (for example for load tests).

| Limit | Routes | Default | Env vars |
|---|---|---|---|
| Global | every `/api/*` request | 600 / 15 min | `RATE_LIMIT_GLOBAL_MAX`, `RATE_LIMIT_GLOBAL_WINDOW_MINUTES` |
| Login | `POST /api/auth/login` (admins also log in here; there is no separate admin login) | 10 **failed** / 15 min | `RATE_LIMIT_LOGIN_MAX`, `RATE_LIMIT_LOGIN_WINDOW_MINUTES` |
| Register | `POST /api/auth/register` | 10 / hour | `RATE_LIMIT_REGISTER_MAX`, `RATE_LIMIT_REGISTER_WINDOW_MINUTES` |
| Password reset | `POST /api/auth/forgot-password` **and** `POST /api/auth/reset-password/:token` (one shared budget) | 5 / hour | `RATE_LIMIT_PASSWORD_RESET_MAX`, `RATE_LIMIT_PASSWORD_RESET_WINDOW_MINUTES` |
| CV upload | `POST /api/cv/upload` | 20 / hour | `RATE_LIMIT_CV_UPLOAD_MAX`, `RATE_LIMIT_CV_UPLOAD_WINDOW_MINUTES` |

Invalid or non-positive values fall back to the defaults.

- **Login counts failed attempts only.** `skipSuccessfulRequests` works through the proxy, because the limiter reads the final response status that the proxy copies from Core. Tested: 15 successful logins followed by 10 failures are allowed, and the 11th failure gets 429. Once an IP is blocked, it gets 429 for the rest of the window, even with a correct password.
- **The login limit sits on top of the account lockout.** The lockout (5 failures → 15-minute lock, per *account*) stays in Core. The gateway limit is per *IP*, so it also stops one IP spraying many accounts.

**429 response**, with the draft-7 `RateLimit` and `RateLimit-Policy` headers plus `Retry-After`:
```json
{ "success": false, "code": "RATE_LIMITED", "message": "Too many requests. Please try again in 14 minutes.", "retryAfterSeconds": 840 }
```
Each hit is logged as one line with no bodies or tokens:
`[RateLimit] {"limit":"login","route":"POST /api/auth/login","ip":"198.51.100.12","requestId":"…"}`

> **Per-instance store.** The limits use `express-rate-limit`'s in-memory store, which is per gateway process. Running more than one gateway instance would need a shared store (for example Redis via `rate-limit-redis`) so the limits apply across instances. That isn't needed for a single instance.

## Request size limits

| Route | Limit (by `Content-Length`) | Env var |
|---|---|---|
| `POST /api/cv/upload` | 6 MB (multipart overhead on top of AIServices' 5 MB file limit) | `GATEWAY_MAX_UPLOAD_BYTES` |
| every other `/api` route | 1 MB | `GATEWAY_MAX_BODY_BYTES` |

Requests without `Content-Length` pass through; the services keep their own limits. **413 response:**
```json
{ "success": false, "code": "PAYLOAD_TOO_LARGE", "message": "The file is too large. CV files must be 5 MB or smaller." }
```
A body up to 4× the limit is drained and discarded first, so the client reliably receives the 413 rather than a connection reset while it is still sending. A larger declared size gets the 413 immediately with `Connection: close`, and the gateway never reads it.

## Timeouts and upstream errors

| Setting | Default | Env var |
|---|---|---|
| Upstream inactivity timeout | 30 s | `GATEWAY_PROXY_TIMEOUT_MS` |
| …for `POST /api/cv/upload` | 60 s | `GATEWAY_UPLOAD_TIMEOUT_MS` |

| Status | `code` | When |
|---|---|---|
| 504 | `UPSTREAM_TIMEOUT` | The service did not respond within the timeout |
| 502 | `UPSTREAM_UNAVAILABLE` | The service could not be reached (refused, DNS, reset) |

Both always return `{ success: false, code, message }` as JSON, never an HTML page or stack trace.

## Security headers

`helmet` defaults on every response (gateway-generated and proxied):
- `Strict-Transport-Security`
- `X-Content-Type-Options: nosniff`
- `X-Frame-Options: SAMEORIGIN`
- `Referrer-Policy: no-referrer`
- `Cross-Origin-Opener-Policy`
- `Cross-Origin-Resource-Policy`
- `X-DNS-Prefetch-Control`
- `X-Download-Options`
- `X-Permitted-Cross-Domain-Policies`
- `Origin-Agent-Cluster`

`Content-Security-Policy` is disabled because the gateway serves only JSON. `X-Powered-By` is disabled on the gateway and stripped from service responses. CORS now also allows `X-Request-Id` and exposes `X-Request-Id`, `Retry-After`, `RateLimit` and `RateLimit-Policy` to the frontend.

## Request ID flow

```
client ──(optional X-Request-Id)──► Gateway: keep if valid (UUID-like, 8–64 chars [A-Za-z0-9-]), else new UUID v4
   Gateway ── X-Request-Id ──► CoreServices: req.requestId           ──► echoed on response
                           └─► AIServices:  request.state.request_id ──► echoed on response
   Gateway response always carries X-Request-Id (also on 404/413/429/502/504)
```

The ID appears in:
- the gateway access log (`rid=…`)
- the `[RateLimit]` line
- Core's `logSecurityEvent` lines (`Account locked`, `Password changed`, `Password reset`)

Core and AI keep a valid incoming ID, or generate one for direct calls. Putting the ID into every service log line is the next task.

## Frontend

- **`src/config/api.js`:** `API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8080'`. All axios clients and `apiFetch` use it. `VITE_API_URL`, `VITE_CV_SERVICE_URL`, `VITE_CV_FRONTEND_URL` and every `:3000`/`:8000` fallback are gone; a grep finds only `config/api.js`.
- **The JS-readable `muqayyim_jwt` cookie is no longer written.** It only existed so the removed :5173 app could read the token, and existing copies are expired on load. Token storage in `localStorage` is unchanged.
- **`apiErrors.js`:**

  | Response | Effect |
  |---|---|
  | 429 `RATE_LIMITED` | Shows the server's message; does not log out and does not end the session |
  | 413 `PAYLOAD_TOO_LARGE` | Shows "The file is too large. CV files must be 5 MB or smaller." (or the server's message) |
  | 502 / 504 | "Service temporarily unavailable, try again"; no logout |

  Notices are shown once even when several requests fail together. `isHandledGlobally(err)` lets the login, register, reset, forgot-password and CV-parsing pages skip a duplicate toast. The login page no longer shows a rate-limit message as a password-field error.
- **Ported from the legacy UI:** removing the selected CV now clears the file input, so the same file can be picked again. The Remove click also no longer reopens the file picker.

## Removed: `AIServices/frontend`

Before deleting it, I checked what it had that the Core frontend didn't:
- `useCVParsing.js`: an unused hook.
- `getCVSummary()`: superseded by `/api/cv/latest`.
- A file-input reset, now ported to Core.

**Deleted:** the folder (20 tracked files plus its local `node_modules`/`.env`).

**Cleaned up:**
- :5173 CORS origins in the gateway, Core and the AI defaults and env examples.
- `MODULE2_FRONTEND_URL` (the gateway now reads `FRONTEND_URL`, with `MODULE1_FRONTEND_URL` still accepted).
- The stray `VITE_API_URL` in the AIServices env files.
- The frontend sections in the root README, the `CoreServices/frontend` README and the seven AIServices docs.

## Environment variables

| Service | Variable | Default |
|---|---|---|
| API Gateway | `RATE_LIMIT_ENABLED` | `true` |
| API Gateway | `RATE_LIMIT_{GLOBAL,LOGIN,REGISTER,PASSWORD_RESET,CV_UPLOAD}_MAX` / `_WINDOW_MINUTES` | see the limits table |
| API Gateway | `GATEWAY_MAX_BODY_BYTES` / `GATEWAY_MAX_UPLOAD_BYTES` | 1048576 / 6291456 |
| API Gateway | `GATEWAY_PROXY_TIMEOUT_MS` / `GATEWAY_UPLOAD_TIMEOUT_MS` | 30000 / 60000 |
| API Gateway | `FRONTEND_URL` (replaces `MODULE1_FRONTEND_URL`, still accepted) | `http://localhost:5174` |
| API Gateway | `TRUST_PROXY` (existing) | `loopback`; behind Railway/Render use the hop count, e.g. `1` |
| Frontend | `VITE_API_BASE_URL` (replaces `VITE_API_URL`, `VITE_CV_SERVICE_URL`, `VITE_CV_FRONTEND_URL`) | `http://localhost:8080` |
| — | removed: `MODULE2_FRONTEND_URL` | — |

New gateway dependencies: `express-rate-limit@^7` and `helmet@^7`. Request IDs use Node's built-in `crypto.randomUUID`.

## Error codes added

| Status | `code` | Source |
|---|---|---|
| 429 | `RATE_LIMITED` | Gateway |
| 413 | `PAYLOAD_TOO_LARGE` | Gateway |
| 502 | `UPSTREAM_UNAVAILABLE` | Gateway |
| 504 | `UPSTREAM_TIMEOUT` | Gateway |

## Tests

| Suite | Result | New coverage |
|---|---|---|
| API Gateway Jest | **35 passed** (28 new) | `rateLimit.test.js`: 11th failed login → 429 with `Retry-After`, `RateLimit` headers and `RATE_LIMITED`, and blocked requests aren't forwarded; another IP isn't blocked; successful logins don't count; the log line has no token or body; register at the 11th, password reset at the 6th (forgot + reset shared), CV upload at the 21st; other routes unaffected; `/health` and OPTIONS never limited. `rateLimitConfig.test.js`: `RATE_LIMIT_ENABLED=false` disables all limits; a configurable global limit; invalid env falls back to defaults. `limitsAndTimeouts.test.js`: 7 MB upload → 413 and not forwarded; 2 MB on `/api/profile` → 413; 4 MB upload forwarded intact; an absurd declared size → 413 with `Connection: close`; a hanging target → 504 within the configured timeout; target down → 502. `requestIdHeaders.test.js`: request ID generated, preserved or replaced, and seen by the target; helmet headers present and `X-Powered-By` stripped; CORS exposes the headers; :5173 rejected. `/internal` still 404 |
| CoreServices Jest | **83 passed** (3 new) | `requestId.test.js`: echo, generation, and the ID in the security log line |
| AIServices PyTest | **30 passed** (3 new) | `test_request_id.py`: echo, generation, and presence on auth error responses |
| Frontend `node --test` | **14 passed** (5 new) | 429 shows the message once without logging out; 413 message; 502/504 don't log out; `isHandledGlobally`; `apiError` |

A live run across all three services, plus the browser, passed all 20 checks plus 3 for "AI down":
- request IDs echoed by Core and AI, and present in the gateway log, `[RateLimit]` line and Core security log
- helmet headers present and `X-Powered-By` stripped
- normal CV upload and parse unaffected
- 7 MB → 413
- 5 failures → 423 lock; the 11th → 429, even with a correct password; another IP unaffected
- the browser only calls the gateway, with no `muqayyim_jwt` cookie
- the 429 message is shown once on the login page
- with AIServices stopped, upload shows "Service temporarily unavailable" and the user stays signed in

## SDS updates needed

| SDS item | Update |
|---|---|
| **§3.3.2** (API Gateway responsibilities) | The gateway is the single entry point. It (1) assigns and forwards an `X-Request-Id`; (2) sets security headers (helmet) and enforces CORS for the one web frontend; (3) blocks `/internal/*`; (4) applies per-IP rate limits (global, login, register, password reset, CV upload); (5) rejects oversized requests by `Content-Length`; (6) proxies with timeouts and maps upstream failures to JSON 502/504. State explicitly that **the gateway does not verify JWTs**: each service verifies the token and the user's live state on every request (see change 03). The rate-limit store is in memory per instance; scaling out needs a shared store such as Redis |
| **Table 3.1** (API Gateway row) | Responsibilities: routing, request IDs, security headers, CORS, `/internal` blocking, rate limiting, size limits, timeouts. Technologies: Express, http-proxy-middleware, helmet, express-rate-limit. Error codes: 429 `RATE_LIMITED`, 413 `PAYLOAD_TOO_LARGE`, 502 `UPSTREAM_UNAVAILABLE`, 504 `UPSTREAM_TIMEOUT`. Remove any reference to a second frontend |
| **§4.3 Security Techniques** | Add **rate limiting** (per-IP limits with defaults from the table above; login counts failed attempts only and complements the per-account lockout; `RateLimit`/`Retry-After` headers; logged with IP and request ID). Add **request size limits** (413 before proxying). Add **security headers** (helmet; `X-Powered-By` removed). Add **request correlation IDs** across services. Note that the JS-readable token cookie was removed |
| **§4.6 Deployment** | Remove the second frontend (`AIServices/frontend`, :5173). Components are now one web frontend (`CoreServices/frontend`, built with `VITE_API_BASE_URL` pointing at the gateway), the API Gateway, CoreServices, AIServices and MongoDB. Behind Railway/Render set `TRUST_PROXY` to the platform's hop count (usually `1`) so limits use the real client IP. With more than one gateway instance, add a shared rate-limit store |
