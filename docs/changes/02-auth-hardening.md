# 02 — Auth hardening: password policy, account lockout, 409 duplicates, change password

**Status:** implemented · **Date:** 2026-10-12 · **Affects:** CoreServices (backend and frontend), API Gateway
**Requirements:** SRS FR1.2, FR2.3, SEC-3 · SDS test table 5.4

## Summary

| Area | Before | After |
|---|---|---|
| Password rule | 6+ characters on the server; frontend hints only | **8–128 characters, at least one letter and one digit**, enforced everywhere a password is set |
| Failed logins | Not tracked | **5 consecutive failures lock the account for 15 minutes.** While locked, the correct password is refused with **423** |
| Duplicate email | 400 "Email already registered" (register), 400 (profile), 500 (admin edit) | **409 "Email already in use"** everywhere, including two registrations racing each other |
| Email case | Partly normalised | Trimmed and lowercased on register, login, forgot-password, profile and admin edits |
| Lock management | — | Admins see a **Locked** badge and can **Unlock** (recorded in AdminLog) |
| Change password | Not available ("Change" linked to forgot-password) | **`PUT /api/auth/password`** plus a Change Password section on the Account page |
| Client IP behind the gateway | CoreServices only saw the gateway's IP | Gateway forwards `X-Forwarded-For`; both services use an env-driven `trust proxy` |

Existing users with weaker passwords can still log in. The rule applies the next time a password is set. JWT format and existing sessions are unchanged.

## Password policy

There is one module, `CoreServices/backend/utils/passwordPolicy.js`:

- `validatePassword(password)` → `{ valid, errors[] }`. It reports every rule that fails. Non-strings are invalid.
- Constants: `PASSWORD_MIN_LENGTH = 8`, `PASSWORD_MAX_LENGTH = 128`, `PASSWORD_LETTER_REGEX`, `PASSWORD_DIGIT_REGEX`, `PASSWORD_RULES`.

It is applied at every place a password is set:

| Place | Field in errors |
|---|---|
| `POST /api/auth/register` | `password` |
| `POST /api/auth/reset-password/:token` | `password` |
| `PUT /api/auth/password` (new) | `newPassword` |
| `POST /api/admin/auth/create-admin` | `password` |
| Admin seed (`ADMIN_SEED_PASSWORD`, first boot only) | logs a clear error with guidance and does not create the account; existing admins are untouched |

A 400 response keeps the API's usual shape and adds field detail:

```json
{ "success": false, "message": "Password must contain at least one number",
  "field": "password", "errors": [{ "field": "password", "message": "Password must contain at least one number" }] }
```

The frontend mirror is `CoreServices/frontend/src/constants/passwordPolicy.js`, with the same constants and checklist. `tests/passwordPolicy.test.js` fails if the two copies ever disagree.

## Account lockout

User model fields added: `failedLoginAttempts` (default 0), `lockUntil` (default null), `lastLogin`, `passwordChangedAt`, and the method `isLocked()`.

Login flow (`authController.login`):
1. Normalise the email and look the user up. **Unknown email:** run `bcrypt.compare` against a fixed dummy hash (so timing doesn't reveal the email exists), then return the usual **401 "Invalid email or password"**.
2. **Locked** (`lockUntil` in the future): return **423** without checking the password:
   ```json
   { "success": false, "message": "Account temporarily locked due to too many failed attempts. Try again in 15 minutes.", "retryAfterMinutes": 15 }
   ```
3. **Wrong password:** one atomic `findOneAndUpdate` (an update pipeline) does three things. It increments `failedLoginAttempts`, restarts the count at 1 if a previous lock has expired, and sets `lockUntil = now + LOCK_DURATION_MINUTES` when the count reaches `MAX_LOGIN_ATTEMPTS`. Parallel requests can't skip the counter (tested with 10 concurrent attempts). The response is 401, or 423 if this attempt triggered the lock.
4. **Correct password:** reset the counter and lock, set `lastLogin`, and issue the JWT as before.
5. A deactivated account (`isActive: false`) still returns **403** after a correct password, as before.

A successful **password reset** or **password change** also clears the counter and lock.

**Security log:** `backend/utils/securityLog.js` → `logSecurityEvent(event, details)`. It currently writes `[Security] <event> {json}` to the console. Logged events are `Account locked` (userId, ISO time, client IP, attempts, lockUntil) and `Password changed` (userId, time, IP). Passwords and tokens are never logged. To move to a database log store later, change only this helper.

### Admin unlock
- `POST /api/admin/users/:id/unlock` (admin only; a non-admin gets 403). It clears the counter and lock and writes AdminLog `UNLOCK_USER` with `{ wasLocked, previousAttempts }`.
- `GET /api/admin/users` and `GET /api/admin/users/:id` include `isLocked` and `lockUntil`.
- UI: Admin → User Management shows an orange **Locked** badge under the status, and an **Unlock** button with confirmation.

## Duplicate email → 409

`backend/utils/apiErrors.js` provides `normalizeEmail`, `isDuplicateKeyError` (Mongo code 11000) and `emailInUse(res)`. The 409 response is `{ success: false, message: "Email already in use", field: "email" }`. It is used in register, `PUT /api/auth/profile`, admin `PUT /api/admin/users/:id` and admin create-admin. The unique index on `users.email` exists; `User.init()` in the tests builds it, and two simultaneous registrations give one 201 and one 409.

## Change password (new)

`PUT /api/auth/password` (JWT; the user comes from the token). Body: `{ currentPassword, newPassword }`.

| Case | Response |
|---|---|
| No / invalid token | 401 |
| Wrong `currentPassword` | **400** `{ field: "currentPassword", message: "Current password is incorrect" }`. This is deliberately not 401, so the frontend doesn't treat it as an expired session |
| `newPassword` fails policy | 400, `field: "newPassword"` |
| `newPassword` equals the current password | 400, `field: "newPassword"` |
| Success | **200** `{ success, message, token }`: a fresh JWT. The password is re-hashed, `passwordChangedAt` is set, and the lockout is cleared |

After success, a "Your password was changed" email is sent **without blocking the response**. If sending fails, the error is logged and the request still succeeds. `passwordChangedAt` is stored but **old tokens are not yet rejected**; that check comes with the per-request user lookup in the next task.

Frontend: Account page → **Change Password** card. It has current, new and confirm fields, a show/hide toggle, the policy checklist, and inline errors (including server field errors). Submit stays disabled until the form is valid. On success the new token is stored, a toast is shown, and the form clears. The card also links to forgot-password.

## Frontend messages

| Status | Where | Shown as |
|---|---|---|
| 400 (field errors) | Register, Reset password, Change password | Inline under the named field; submit disabled until the client-side policy passes |
| 409 | Register, Account email edit | "Email already in use" under the email field |
| 423 | Login | Orange alert above the form with the minutes remaining, plus a toast |
| 401 | Login | Always "Invalid email or password" (never reveals whether the email exists) |

## New environment variables

| Service | Variable | Default | Purpose |
|---|---|---|---|
| CoreServices | `MAX_LOGIN_ATTEMPTS` | `5` | Consecutive failures before a lock |
| CoreServices | `LOCK_DURATION_MINUTES` | `15` | Lock length |
| CoreServices | `TRUST_PROXY` | `loopback` | Express `trust proxy`, so `req.ip` is the real client |
| API Gateway | `TRUST_PROXY` | `loopback` | Same; needed for the upcoming gateway rate limiting |

`TRUST_PROXY` accepts:
- `loopback` (local: the gateway runs on the same machine)
- a hop count such as `1` (behind Railway/Render's proxy; use `2` on Core if requests also pass through the gateway)
- `true` or `false`
- a subnet list

The gateway now sends `X-Forwarded-For` (`xfwd: true`). I checked end to end: a request arriving with `X-Forwarded-For: 203.0.113.5` is logged by Core with that IP. All the variables are in the `.env.example` files with comments.

## HTTP statuses introduced

| Status | Endpoint(s) | Meaning |
|---|---|---|
| **409 Conflict** | register, `PUT /api/auth/profile`, `PUT /api/admin/users/:id`, `POST /api/admin/auth/create-admin` | Email already in use |
| **423 Locked** | `POST /api/auth/login` | Temporary lockout after too many failed attempts; includes `retryAfterMinutes` |

## Tests

`cd CoreServices && npm test` runs 65 tests, all passing:

- `tests/passwordPolicy.test.js`:
  - `abc12`, `abcdefgh` and `12345678` are invalid; `abcd1234` is valid
  - lengths 8–128; non-string input
  - the frontend copy gives the same verdicts
- `tests/authHardening.test.js`:
  - **Registration:** weak password → 400 with field errors; strong → 201; duplicate → 409; duplicate in another letter case → 409; simultaneous registrations → 201 and 409; email normalised
  - **Lockout:** 4 wrong then correct → 200 with the counter reset; 5 wrong → the 5th returns 423 and the correct password then gets 423; lock logged once without the password; parallel attempts can't bypass the counter; an expired lock lets the correct password in and resets the counter; a wrong password after an expired lock restarts at 1; unknown email gives the same 401 body as a wrong password; legacy weak passwords still log in
  - **Reset:** weak → 400; a successful reset clears the lock
  - **Profile:** email change to a taken email → 409
  - **Change password:** no token → 401; wrong current → 400 and the session still works; weak → 400; same as current → 400; success → 200 with a new token, the old password fails, the new one works, and `passwordChangedAt` is set; a mail failure still returns 200
- `tests/adminUnlock.test.js`: `isLocked`/`lockUntil` in list and detail; a non-admin unlock → 403; admin unlock → 200, an AdminLog `UNLOCK_USER` entry, and the user can log in; admin email edit to a taken email → 409; create-admin enforces the policy

`cd "API Gateway" && npm test` runs 6 tests, including the new `tests/forwarding.test.js` (X-Forwarded-For is forwarded; `trust proxy` defaults to loopback).

A manual browser run (Edge) covered:
- the register checklist, disabled submit, and 409 under the email field
- change password: wrong current password shown inline without logging out, then success
- lockout: the 423 banner, and the correct password refused while locked
- admin: Locked badge, Unlock, and the user logging in afterwards

## SDS updates needed

| SDS item | Update |
|---|---|
| **Table 5.4** (auth test cases) | Change the duplicate-email row to expect **409 "Email already in use"** (also with different letter case). Add rows: weak password (`abcdefgh`, `12345678`, `abc12`) → 400; 4 failed logins then correct → 200, counter reset; 5 failed logins → 423 "Account temporarily locked… Try again in 15 minutes."; correct password while locked → 423; login after the lock expires → 200; unknown email → 401 with the same message as a wrong password; admin unlock → user can log in and an AdminLog entry exists; non-admin unlock → 403; password reset clears the lock; change password with wrong current → 400 (session kept); change password success → 200 with a new token and the old password rejected |
| **§4.3 Security Techniques** | Add a **password policy** (8–128 characters, a letter and a digit; one shared validator on every password write; bcrypt cost 10). Add **account lockout** (5 consecutive failures → 15-minute lock, env-configurable; atomic counter; 423 response; correct password refused while locked; a dummy-hash compare for unknown emails to prevent user enumeration by timing; generic 401). Add **lockout logging** through `logSecurityEvent` with userId, time and client IP, never passwords. Add the **admin unlock** audit trail and the **trusted-proxy** client-IP handling |
| **State diagram 3.16** (account states) | Add **Temporarily Locked** as its own state. Active → Temporarily Locked on the 5th consecutive failed login. Temporarily Locked → Active when `lockUntil` passes, on admin Unlock, or on password reset. It is **separate from the admin-controlled Suspended/Inactive state** (`isActive = false`): a suspended account stays suspended regardless of the lock, and unlocking does not reactivate a suspended account |

## SRS: new requirement

The SRS has no change-password requirement. Add it under **Module 1: User Management, next to FE-5 ("view and edit profile details")**, e.g.:

> **FE-9:** Allow authenticated users to change their password by confirming their current password; the new password must meet the password policy (FR2.3), the user remains signed in, and a notification email is sent.

Matching functional requirement for the profile/account mockup table:

> **FR (Change Password):** The system shall allow a logged-in user to change their password after verifying the current password. *Business rule:* new password must satisfy FR2.3 and differ from the current one; a wrong current password does not end the session; a confirmation email is sent.
