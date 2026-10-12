# 03 — Live auth checks: verify the user on every request

**Status:** implemented · **Date:** 2026-10-12 · **Affects:** CoreServices (backend and frontend), AIServices, API Gateway (tests)
**Requirements:** SDS B4, SRS SEC-2, state diagram 3.16

## Summary

Before this change a JWT was trusted on its own for up to 7 days. A suspended or demoted user kept access until it expired, changing or resetting a password did not end other sessions, and AIServices accepted any token with a valid signature, even for deleted users.

Now every authenticated request checks the user's **current state in the database**:

| Situation | CoreServices | AIServices |
|---|---|---|
| User suspended (`isActive: false`) | 403 `ACCOUNT_DEACTIVATED` on the next request | Same, within `AUTH_CACHE_TTL_SECONDS` (default 30s) |
| Admin demoted | Admin routes return 403 on the next request (database role) | Uses the database role |
| User deleted | 401 `USER_NOT_FOUND` | Same, within the TTL |
| Password changed or reset | Older tokens get 401 `TOKEN_REVOKED`; the change-password response's new token works immediately | Same, within the TTL |
| Temporarily locked (`lockUntil`) | Existing sessions keep working; only new logins are blocked | Same |

The token format and 7-day expiry are unchanged. Nothing reads the token's `role` claim for authorization any more.

## CoreServices

### Auth middleware (`backend/middleware/auth.js`)
1. Verify the signature and expiry, as before.
2. One projected, lean lookup: `User.findById(userId).select('role isActive passwordChangedAt').lean()`.
3. Reject with a code, otherwise set `req.user = { id, userId, role, isActive }`, all from the database. `userId` is an alias of `id` kept for the 42 existing handlers.

| Status | `code` | `message` |
|---|---|---|
| 401 | `NO_TOKEN` | No token provided. Please login. *(unchanged)* |
| 401 | `TOKEN_EXPIRED` | Token expired. Please login again. *(unchanged)* |
| 401 | `TOKEN_INVALID` | Invalid token. Please login again. *(unchanged)* |
| 401 | `USER_NOT_FOUND` | Your account no longer exists. Please login again. |
| 403 | `ACCOUNT_DEACTIVATED` | Your account has been suspended. Contact support. |
| 401 | `TOKEN_REVOKED` | Your session has ended. Please log in again. |

`requireAdmin` now reads `req.user.role`, which is the database role, so a forged or stale `role: "Admin"` claim gets nothing.

### Token revocation via `passwordChangedAt`
- A token is revoked when `iat < floor(passwordChangedAt / 1000)` (`backend/utils/passwordChangedAt.js`).
- **Change password** (`PUT /api/auth/password`) and **password reset** (`POST /api/auth/reset-password/:token`) set `passwordChangedAt` to **now − 1 s**. So all older sessions end, but the token issued in the change-password response (`iat = now`) is accepted straight away.
- A password reset is logged as `logSecurityEvent('Password reset', { userId, ip })`.
- Accounts that never changed their password have no `passwordChangedAt`, so all their existing tokens keep working.
- **Known edge:** the comparison is in whole seconds and backdated by one second, so a token issued within about the same second as a password change is not revoked. Real sessions are much older than that.

### Admin safety (`adminUserController.js`)
- Existing guards kept: an admin cannot deactivate, demote or delete themselves (400).
- **New guard, `isLastActiveAdmin`:** deactivating, demoting or deleting the last active admin returns 400. Through the API this is defense in depth: the acting admin must be an active admin (now checked against the database), and can't target themselves, so another active admin always exists. The guard protects future endpoints and scripts.
- Suspensions, reactivations and role changes were already logged to AdminLog (`DEACTIVATE_USER`, `ACTIVATE_USER`, `CHANGE_USER_ROLE`); tests now assert it.

### Internal endpoint
`GET /internal/users/:id/auth-state` (requires `X-Internal-Key`; the gateway answers `/internal/*` with 404):
- found → 200 `{ exists: true, isActive, role, passwordChangedAt }`
- unknown or malformed id → 404 `{ exists: false }`

## AIServices

- **`core_client.get_auth_state(user_id)`:** calls the endpoint above with a 2s timeout. 404 becomes `{exists: False}`; a network error, timeout or 5xx raises `CoreUnavailable`.
- **`services/auth_state_cache.py`:** an in-memory cache per user for `AUTH_CACHE_TTL_SECONDS`. If Core is unreachable, an **expired** entry may be used for up to **5 more minutes**, with a warning `CoreServices unreachable; using expired auth state for user <id> (age Ns)`. With no usable entry the request **fails closed**.
- **`middleware/auth.py`:** after verifying the JWT, applies the same rules and codes as Core and returns `{"user_id", "role"}` with the **database role**. Core unreachable with no usable cache gives 503 `AUTH_UNAVAILABLE` ("Service temporarily unavailable, try again."). Auth errors are returned as `{ success: false, code, message, detail }`, the same shape as Core, with `detail` kept for compatibility.
- Tokens and the internal key are never logged (checked in the live run's logs).

## Frontend (`CoreServices/frontend`)

- **`src/services/apiErrors.js`:** one handler for all clients (the three axios instances via `installAuthInterceptor`, and the fetch-based services via `apiFetch`).
  - 401 `TOKEN_REVOKED`/`TOKEN_EXPIRED`/`USER_NOT_FOUND`/`TOKEN_INVALID` and 403 `ACCOUNT_DEACTIVATED` fire **one** session-ended event, even when several requests fail together.
  - 503 `AUTH_UNAVAILABLE` fires a throttled "Service temporarily unavailable, try again" notice and does **not** log out.
  - Any other error is left to the page: login's plain 401 with no code, change-password's 400, and a 403 that isn't `ACCOUNT_DEACTIVATED` (e.g. "admin privileges required").
- **`AuthContext`:** on session-ended it clears the token and user, shows the server's message, and the existing route guards redirect to `/login`. On startup it re-validates the stored session with `/api/auth/profile` and exposes `sessionVerified`. `refreshProfile` no longer logs out on network errors.
- **`AdminRoute`:** waits for that fresh profile, then gates on its **database role**. A demoted admin who opens `/admin/...` is sent to `/dashboard`. The backend enforces the same rule regardless.
- Unit tests: `npm test` in `CoreServices/frontend` runs `node --test` with no extra dependencies.

## New environment variable

| Service | Variable | Default | Purpose |
|---|---|---|---|
| AIServices | `AUTH_CACHE_TTL_SECONDS` | `30` | How long a user's auth state from Core is cached. Suspensions and password changes reach AIServices within this window |

It is in `AIServices/.env.example` and `AIServices/backend/.env.example`.

## Tests

| Suite | Result | New coverage |
|---|---|---|
| CoreServices Jest (`npm test`) | 80 passed | `tests/liveAuth.test.js`: token codes; suspended user → 403 on a normal and an admin route; demoted admin → 403 although the token says Admin; forged role claim → 403; deleted user → 401 `USER_NOT_FOUND`; change password → old token `TOKEN_REVOKED`, new token 200, `passwordChangedAt` = now − 1s; reset → old token `TOKEN_REVOKED` and reset logged; locked user's session → 200; self-guards; `isLastActiveAdmin`; AdminLog for suspend, reactivate and role change. `tests/internalRoutes.test.js`: auth-state with no key → 401, wrong key → 403, correct payload, unknown or malformed id → 404 `{exists:false}` |
| AIServices PyTest | 27 passed | `tests/test_live_auth.py`: active user allowed with database role; inactive → 403; unknown → 401; revoked → 401 while a newer token is fine; Core down with no cache → 503; Core down with expired cache inside the grace period → allowed with a warning; beyond the grace period → 503; cache hit avoids a second call within the TTL; suspension visible after the TTL; token error codes without calling Core; `get_auth_state` client |
| API Gateway Jest | 7 passed | `GET /internal/users/:id/auth-state` → 404 and not proxied |
| Frontend `node --test` | 9 passed | `TOKEN_REVOKED` fires once with 3 failing requests; `ACCOUNT_DEACTIVATED` fires once with its message; other session codes; login's plain 401, change-password's 400 and a non-suspension 403 do not fire; 503 `AUTH_UNAVAILABLE` shows a notice without logging out; re-arming after login; `apiFetch` |

A live run across all three services (AI TTL set to 3s) covered:
- suspension blocking Core immediately and AI after the TTL
- immediate loss of admin access on demotion
- a password change revoking the older session in Core and in AI, with the new token working
- the lock leaving sessions alive
- Core down: a cached user still allowed with a warning, an uncached user getting 503
- in the browser: logout with the suspension message, logout with "session has ended", change-password's wrong current password not logging out, and a demoted admin redirected away from `/admin`

## SDS updates needed

| SDS item | Update |
|---|---|
| **§4.3 Security Techniques** | Add **per-request user verification**: every authenticated request loads `role`, `isActive` and `passwordChangedAt` with one indexed lookup. Authorization uses the database role, never the JWT role claim. Suspended users get 403 `ACCOUNT_DEACTIVATED` and deleted users 401 `USER_NOT_FOUND`. Add **token revocation via `passwordChangedAt`**: tokens issued before the last password change or reset are rejected with 401 `TOKEN_REVOKED`, and the changing session receives a fresh token. Add **cross-service verification**: AIServices checks the same state through the internal `auth-state` endpoint, caches it for `AUTH_CACHE_TTL_SECONDS` (bounded staleness, a 5-minute grace if Core is down) and fails closed with 503. Note that a temporary lock does not end existing sessions |
| **Algorithm 4** (request authentication) | After "verify JWT signature and expiry", insert: **(a)** look up the user by id (projection `role isActive passwordChangedAt`); **(b)** not found → 401 `USER_NOT_FOUND`; **(c)** `isActive = false` → 403 `ACCOUNT_DEACTIVATED`; **(d)** `iat < ⌊passwordChangedAt / 1000⌋` → 401 `TOKEN_REVOKED`; **(e)** `req.user ← {id, role, isActive}` from the database. The admin check then compares the **database** role. For AIServices, step (a) reads the cached auth state from CoreServices; Core unreachable with no cache → 503 `AUTH_UNAVAILABLE` |
| **Table 3.1** (Authentication Service) | Add `GET /internal/users/{id}/auth-state` (internal, `X-Internal-Key`, returns `{exists, isActive, role, passwordChangedAt}`). List the error codes `NO_TOKEN`, `TOKEN_EXPIRED`, `TOKEN_INVALID`, `USER_NOT_FOUND`, `ACCOUNT_DEACTIVATED`, `TOKEN_REVOKED` (and `AUTH_UNAVAILABLE` for AIServices). Note that `PUT /api/auth/password` and `POST /api/auth/reset-password/{token}` revoke existing sessions |
| **Diagram 3.16** (account states) | The **Suspended** state is now **enforced**: entering it (an admin deactivates) ends access on the user's next request in Core and within `AUTH_CACHE_TTL_SECONDS` in AIServices, rather than after token expiry. Show the transitions *Active → Suspended* and *Suspended → Active* triggered by admin actions, and keep **Temporarily Locked** as a separate state that blocks only new logins. Optionally show "Session revoked" as an event on password change or reset that ends all other sessions without changing the account state |
