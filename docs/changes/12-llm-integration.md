# 12 — LLM integration

**Requirements:** SRS SI-3 (LLM interaction: quizzes, interview questions, learning paths), Module 4 (AI-Powered CV
Generator; scope document BO-2), PER-3 (AI content within 15 s), SEC-2 / SEC-4, LI-6 (privacy) · provider: Google
Gemini (free tier), default model `gemini-3.5-flash-lite`.

| Part | Content | Status |
|---|---|---|
| 1 | Shared LLM client in AIServices | **done** |
| 2 | CV generator: consent, server-built facts, CV assist, truthfulness post-check, review step | **done** |
| 3 | Target-role tailoring, admin usage view | later |
| — | Modules 6–8 (learning paths, quizzes, interviews) use the client when they are built | later |

## Inventory (Step 0)

| Module / requirement | Where | State | What the LLM does | Scope |
|---|---|---|---|---|
| M4 CV generator (FE-1, FR6.1; BO-2) | `cvgen/CvEditor.jsx` (Generate / Improve on summary, experience, projects), `AiAssistButton.jsx`, `services/cvAssistService.js` | built with a disabled stub | Rephrase / organise / improve wording of the user's own facts; review before saving | Part 2 |
| M4 target-role tailoring (BO-2) | — | not built | Emphasise held skills a chosen career needs; never adds skills | Part 3 (later) |
| ATS check | `cvgen/templates.js`, `CvDocument.jsx` | ATS-safe layout only; no FR | Not an LLM task (deterministic keyword check) | proposal |
| M6 learning paths (FR8.2, SI-3.3) | `careers/CareerDetails.jsx` (button "coming soon"); `career_matches.gaps` | not built | Roadmap for the stored gaps | when M6 is built |
| M7 skill verification (FE-2, FR9.2/9.5/9.7, SI-3.1) | — | not built | Generate and grade quizzes, follow-ups | when M7 is built |
| M8 mock interview (FR10.2/10.6/10.8, SI-3.2) | Core `adminInterviewController.js` (manual question bank) | not built | Questions, answer analysis, feedback report | when M8 is built |
| M9 readiness (FR11.6) | — | not built | (mostly deterministic) | later |
| M10 admin metrics | `adminDashboardController.js` | built | Shows `llm_usage` (Part 3) | later |
| M2 parsing, M5 matching, skill descriptions | — | built, deterministic, **frozen** | Untouched. Proposals only (each needs its own benchmark): an LLM parse fallback; descriptions for undescribed skills | no |

## Provider facts (official Google docs, read 2026-10-17)

- Free-tier limits per model are no longer printed in the docs; they are shown per project in AI Studio
  (`aistudio.google.com/rate-limit`). Limits apply **per project, not per API key**; daily quotas reset at **midnight
  Pacific**; going over returns **429 RESOURCE_EXHAUSTED**.
- Recommended for new projects: `gemini-3.5-flash-lite` (default here) and `gemini-3.8-flash` (via `LLM_MODEL`); both
  have a free tier. Gemini 2.0 Flash is shut down; 2.5 models are limited to earlier users.
- **Free tier: Google's pricing page lists content as "used to improve our products"** (not on the paid tier) — the
  consent text in Part 2 says so explicitly.
- API: REST `POST {base}/models/{model}:generateContent`, key in the `x-goog-api-key` header; `systemInstruction`,
  `generationConfig.maxOutputTokens / temperature / responseMimeType`; usage in `usageMetadata.promptTokenCount /
  candidatesTokenCount`.

## Design (Part 1)

```
Core (later parts) ──X-Internal-Key──► AI feature route ──► app/services/llm/client.py ──► provider adapter
                                                              │ prompts/*.txt (versioned)       ├ gemini.py (REST, httpx)
                                                              │ privacy.minimise (data blocks)  └ fake.py (tests, offline)
                                                              │ limits (ai_db.llm_limits)
                                                              │ cache  (ai_db.llm_cache)
                                                              └ usage  (ai_db.llm_usage)
```

- **One shared client, AIServices only.** `generate_text(feature, prompt, user_id, values)` and
  `generate_json(feature, prompt, Schema, …)`; the frontend and Core never call the provider and never see the key.
- **Provider-agnostic:** `providers/gemini.py` (REST over the existing `httpx`, no SDK) and `providers/fake.py`
  (deterministic, scriptable, records every request; the only adapter tests use).
- **Settings** (`app/config/settings.py`, placeholders in `.env.example`): `LLM_ENABLED` (default false),
  `LLM_PROVIDER` (gemini | fake), `LLM_MODEL`, `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_TIMEOUT_S` (15), `LLM_MAX_OUTPUT_TOKENS`
  (1024), `LLM_MAX_RETRIES` (2), `LLM_RPM` / `LLM_TPM` / `LLM_RPD` (the project's limits), `LLM_LIMIT_FRACTION` (0.8),
  `LLM_USER_DAILY_QUOTA` (20), `LLM_CACHE_TTL_DAYS` (7). The LLM is off unless enabled **and** (for Gemini) a key is set;
  the startup log says which, never the key.
- **Reliability:**
  - timeout `LLM_TIMEOUT_S` per attempt (not retried);
  - retries only on 429 / 5xx, up to `LLM_MAX_RETRIES`, exponential backoff 1 s, 2 s, … (max 8 s) + jitter, honouring
    the provider's retry delay (`Retry-After` / `RetryInfo.retryDelay`); a requested wait over 20 s is reported as
    rate-limited instead of slept;
  - **global limiter** shared by every process through `ai_db.llm_limits` (Google counts per project): requests per
    minute, tokens per minute (estimate reserved before the call, corrected after) and requests per Pacific day, each at
    `floor(limit × 0.8)`; every attempt (incl. retries) takes a slot;
  - **per-user daily quota** (20 per Pacific day);
  - each counter is one conditional upsert, so concurrent requests cannot overshoot; a duplicate-key collision between
    two first inserts is re-checked (found by testing, below); a later refusal rolls back counters already taken;
  - **cache** of identical requests (`ai_db.llm_cache`, 7 days; the key includes the user, the feature, the prompt
    version, the model and the exact texts); a hit costs no provider call and no quota.
- **Errors** (safe messages; nothing else escapes): `LLM_DISABLED` 503, `LLM_UNAVAILABLE` 503, `LLM_TIMEOUT` 504,
  `LLM_RATE_LIMITED` 429 (with retry delay), `LLM_QUOTA_EXCEEDED` 429 (until Pacific midnight), `LLM_INVALID_OUTPUT` 502.
  Features catch them and degrade gracefully (Part 2: the user keeps their own text).
- **Structured output:** `responseMimeType: application/json`; the JSON Schema of the pydantic model is described in the
  prompt and the answer is validated locally (code fences tolerated); one corrective retry ("your previous answer was …
  return only the JSON object"); then `LLM_INVALID_OUTPUT`. Invalid answers are never cached.
- **Prompts as files:** `app/services/llm/prompts/<name>.txt`, first line `# version: <n>`; the version (`name@vN`) is in
  every usage record. `system_base.txt` (always the system instruction) holds the safety rules; `smoke.txt` is the
  connectivity check.

## Privacy

- **Data minimisation** (`privacy.py`, applied to every data block): whole `personal` / `contact` objects and keys such
  as `fullName`, `email`, `phone`, `address`, `location`, `links`, `url`, `linkedin`, `github`, `website`, `portfolio`,
  `photo` are dropped at any depth; e-mail addresses, URLs and phone numbers (≥ 10 digits, so date ranges are kept) are
  scrubbed from free text; `redact` terms (the user's own name, passed by the caller and never sent on) are replaced.
  Tech names such as ASP.NET, Node.js and socket.io are not mistaken for links. Features additionally send only the
  fields their action needs.
- **Consent** (Part 2): one-time, stored on the user in core_db; text: *"Your CV/profile text is sent to Google Gemini
  for processing. On the free tier, Google may use this content to improve its products."* Without consent the AI
  actions are off for that user.
- **Deletion:** on consent withdrawal or account deletion, Core calls `DELETE /internal/llm/user-data` (X-User-Id) and
  all of that user's cached outputs are deleted. Usage records hold no content and only a hash; quota counters are kept
  so withdrawing consent cannot reset the daily quota.
- **Logs:** feature, a 12-character user hash, status, attempts, tokens, latency — never prompts, responses or ids.
  PyMongo's debug logging (which writes whole commands, incl. CV text and cached outputs) is pinned to WARNING
  (`app/config/logging_setup.py`).
- **Usage records** (`ai_db.llm_usage`, 365 days): feature, user hash, provider, model, prompt version, status,
  attempts, tokens, latency — for the admin dashboard (`GET /internal/llm/usage`).

## Prompt injection

CV / profile / GitHub text is untrusted. It is only ever inserted through `data_block()`: minimised, serialised as JSON
and wrapped in `<<<DATA name>>> … <<<END DATA name>>>`; delimiter look-alikes inside the data are defused, so a CV
cannot close its own block. The system instruction (never built from user data) tells the model to treat data sections
as information only, never to follow instructions inside them, to use only facts from them, to take no actions and to
output no contact details. The model has no tools; its output is only ever a suggestion (Part 2 adds the truthfulness
post-check and the review step).

## Limits

The project's free-tier numbers for `gemini-3.5-flash-lite` were **not supplied** (the decision message left
`RPM = __, TPM = __, RPD = __`). Until they are set in `.env`, the conservative defaults apply: RPM 5, TPM 100,000,
RPD 100 → the limiter allows **4 requests / minute, 80,000 tokens / minute and 80 requests / Pacific day**; plus 20
calls per user per day. Changing `LLM_RPM` / `LLM_TPM` / `LLM_RPD` needs no code change.

## Internal routes (AIServices, X-Internal-Key; `/internal/*` is blocked at the gateway)

| Route | Purpose |
|---|---|
| `GET /internal/llm/status` | enabled / provider / model, provider and effective limits, today's requests, quota — never the key |
| `GET /internal/llm/usage?days=7` | per feature: calls, provider attempts, cache hits, errors, tokens, mean latency |
| `DELETE /internal/llm/user-data` | `X-User-Id`: delete that user's cached outputs |

## Testing

All normal tests use the fake adapter; a conftest guard makes the Gemini adapter fail if a test tries to reach the real
API (adapter tests inject an `httpx.MockTransport`, no network). `tests/test_llm_live.py` (marker `llm_live`, excluded
by default, `pytest -m llm_live`) makes one tiny smoke call with the real key.

## Part 2 — CV generator (Module 4)

**Flow:** CV editor (Generate / Improve on the summary, each experience entry and each project) → `POST /api/ai/cv-assist`
(Core, JWT) → consent check → facts built on the server → `POST /internal/llm/cv-assist` (AI, internal key + `X-User-Id`)
→ the shared client with `prompts/cv_assist.txt` (v1) → truthfulness post-check → back to the browser → **review step**
→ Accept puts the text into the editor; the CV is saved only when the user saves it as before.

**Consent** (`core_db.users.aiConsent`: granted, version, provider, grantedAt, withdrawnAt):
- The dialog (first AI click, or the Account page) shows in plain language what happens and the exact notice, served by
  Core so it cannot drift: *"Your CV/profile text is sent to Google Gemini for processing. On the free tier, Google may use
  this content to improve its products."* It adds that name, e-mail, phone, address, links and photo are never sent and
  that consent can be withdrawn on the Account page. **Agree** / **Not now**; "Not now" changes nothing and every non-AI
  CV feature keeps working.
- Consent counts only for the current notice version (`AI_CONSENT_VERSION`); a changed notice asks again (409
  `CONSENT_VERSION_CHANGED`). Without consent Core refuses with 403 `AI_CONSENT_REQUIRED` before anything reaches AI.
- **Withdrawal** (Account page, with a confirmation) turns AI off and asks AIServices to delete the user's cached outputs
  (`DELETE /internal/llm/user-data`, background with retries; a final failure is logged as `LLM_USER_DATA_DELETE_FAILED`,
  and the cache expires after 7 days anyway). **Account deletion** (admin) does the same.

**Data minimisation:** Core builds the profile context with `buildCvSource` on the server and sends only what the
section needs — summary: headline, skills, job titles / employers / dates, degrees / institutions, project names /
technologies, certification names / issuers; experience: that job's title, employer, dates and the skills; project: its
name, technologies and the skills — plus the current text of the field. The browser's entry is reduced to allowed fields.
Never sent: name, e-mail, phone, address / location, links, photo. The user's name goes to AIServices only as `redact`
terms, which scrub it from free text before the prompt is built; AIServices refuses any unexpected field (422).

**Prompt:** `cv_assist.txt` v1 — a fixed task per section and action (chosen in code), the writing rules (only facts from
the data; never add employers, titles, dates, degrees, skills, tools, certifications, metrics or numbers; keep numbers
exactly), the format (summary: one paragraph; experience: 2–5 bullets; project: 1–3 sentences or up to 4 bullets) and
JSON output `{text, insufficient_data}`. Profile facts and the current text are delimited data blocks.

**Truthfulness post-check** (`app/services/cv_assist/truthfulness.py`) flags, with the reason shown to the user: numbers
not in the input; known skills / tools (alias table and curated skills) not in the profile — short or everyday-word skills
(Go, R, Swift, REST, …) only with their exact spelling, a multi-word skill counted as present when all its words are in
the input in some form; employer / organisation names after "at / for / with / from / joined / by"; other capitalised
names mid-sentence; degree words; certification wording. Matching is by whole words. It is a safety net: the prompt
forbids invention and the user reviews every suggestion.

**Review step:** current text and suggestion side by side; flagged items highlighted with the reason (e.g. "employer not
in your profile", "number not in your input") and listed; **Accept**, **Discard**, **Edit before accepting**. Nothing is
saved automatically.

**Messages** (the user's text is never changed): per-user quota → "AI daily limit reached, try again tomorrow."; global
limit → "AI is busy, try again in a minute."; provider down / timeout / disabled / unusable answer → "AI is unavailable.";
each followed by "Your text was not changed."; not enough profile data → a notice, no suggestion. When AI is switched
off the buttons are disabled with "AI is unavailable right now". The "Soon" badge is removed (the feature works end to end).

**Routes:** Core `GET /api/ai/status`, `GET|POST|DELETE /api/ai/consent`, `POST /api/ai/cv-assist` (gateway `/api/ai` → Core,
normal limits); AI `POST /internal/llm/cv-assist`.

### Manual check (2026-10-17, real Gemini, the project's free-tier limits)

Instances with the new code: gateway :8180 → Core :3100 → a capture relay → AI :8100 (real databases; `.env` with
`LLM_ENABLED=true`, provider limits RPM 15 / TPM 250,000 / RPD 500 → effective 12 / 200,000 / 400). The real profile had
**no experience entries** (15 projects, empty summary), so the two experience checks and "improve summary" could not run;
three calls were made, 6 s apart.

| Call | Through the gateway | LLM (usage record) | Tokens in / out | Post-check flags (after the fixes below) |
|---|---|---|---|---|
| Summary — generate | 4,253 ms | 3,138 ms, 1 attempt | 1,212 / 88 | none |
| Project — generate | 5,662 ms | 2,045 ms | 677 / 32 | none (it restated name and technologies only: no description in the data) |
| Project — improve | 5,830 ms | 2,309 ms | 722 / 60 | "JSON" — skill not in your profile (the model expanded "JWT" to "JSON Web Token") |

- **Privacy, verified on the outgoing data** (the service logs no content): the text sent to Gemini was rebuilt exactly
  from Core's captured payloads with the same prompt code and scanned for the user's 15 personal values (name and its
  parts, e-mail, phone, LinkedIn / GitHub / website, project and certificate URLs): **none found**; none in Core's payload
  outside the `redact` list either. Logs: the AI usage lines and Core's `[CvAssist]` lines hold a user hash, section,
  status, tokens and time only.
- Consent was given for the check and withdrawn afterwards (the account's state is "off" again).
- **Found by the check and fixed:** (1) the post-check flagged "Comsats University Islamabad. Proficient" as an employer:
  a name ran across the sentence end and the institution *is* in the profile — names now stop at sentence ends; (2)
  "inventory management" was flagged although the input says "managing inventory" — a multi-word skill now counts as
  present when all its words are in the input (single words keep the strict rule: Java is not JavaScript). Both cases are
  regression tests; the three real outputs were re-checked offline with the fixed code (no new calls).
- **Found by the check (setup artefact, shows the fallback):** the withdrawal's background deletion went through the
  capture relay, which the script had already stopped, so all retries failed and Core logged
  `LLM_USER_DATA_DELETE_FAILED`; the three cached entries were then deleted through the same AIServices function (cache
  empty). Deletion is best-effort with retries, a logged failure and the 7-day expiry as the backstop.

## Suggested SDS text

| Section | Add or replace |
|---|---|
| **SI-3 (LLM interaction)** | "All language-model calls go through one client in AIServices (provider-agnostic; Google Gemini `gemini-3.5-flash-lite` by default). CoreServices and the browser never call the provider and never hold the key. The client enforces timeouts, retries on rate-limit and server errors with backoff, a global rate limiter at 80 % of the provider's per-project limits, a per-user daily quota, caching of identical requests, schema-validated structured output, and records usage (feature, tokens, latency, status) without storing prompts or responses." |
| **Privacy (LI-6 / SEC-4)** | "AI features require a one-time consent stating that CV/profile text is sent to Google Gemini and, on the free tier, may be used by Google to improve its products. Names, e-mail addresses, phone numbers, addresses, links and photos are never sent to the language model. Withdrawing consent or deleting the account deletes the user's cached AI outputs." |
| **Module 4 FE-1 / FR6.1 (AI-Powered CV Generator)** | "With the user's consent, the CV editor offers AI writing help (Generate / Improve) for the professional summary, each work-experience entry and each project. Suggestions are produced only from facts in the user's profile; any number, skill, employer, degree, certification or name that the input does not contain is flagged with the reason, and the user accepts, edits or discards each suggestion before it is used. Nothing is saved without the user saving the CV." |
| **Security (prompt injection)** | "User-supplied text is passed to the model only inside delimited data sections that the system instruction marks as data; instructions inside them are ignored, and model output is always reviewed by the user before it is saved." |
| **§3.5 (data design)** | Add `ai_db.llm_limits` (rate / quota counters, TTL), `ai_db.llm_cache` (user hash, feature, output, 7-day TTL), `ai_db.llm_usage` (per-call usage, 365-day TTL). |
| **PER-3** | Note: the LLM timeout is 15 s per attempt; retries after rate-limit or server errors can extend a request. |

## Files

**Part 2:** AIServices `app/services/cv_assist/{service,truthfulness}.py`, `app/services/llm/prompts/cv_assist.txt`, `app/routes/llm_routes.py`; tests `tests/test_cv_assist.py`. CoreServices `backend/constants/aiConsent.js`, `backend/models/User.js` (aiConsent), `backend/services/aiLlmClient.js`, `backend/controllers/aiController.js`, `backend/routes/aiRoutes.js`, `app.js`, `backend/admin/controllers/adminUserController.js`; tests `tests/aiAssist.test.js`. Frontend `src/services/{aiService,cvAssistService}.js`, `src/components/ai/{AiConsentDialog,AssistReview,AiConsentCard}.jsx`, `src/components/cvgen/{CvAssist,AiAssistButton,CvEditor}.jsx`, `src/pages/ProfilePage.jsx`; tests `cvAssistService.test.js`, `CvAssist.spec.jsx`, `AiConsentCard.spec.jsx`. Gateway `app.js`; tests `tests/aiRoute.test.js`.

**Part 1:**
- `AIServices/backend/app/services/llm/` — `client.py`, `errors.py`, `limits.py`, `cache.py`, `usage.py`, `privacy.py`,
  `prompts.py`, `prompts/{system_base,smoke}.txt`, `providers/{base,gemini,fake}.py`.
- `AIServices/backend/app/routes/llm_routes.py`; `app/main.py` (indexes, startup log, router);
  `app/config/settings.py`, `app/config/logging_setup.py`; `.env.example`.
- Tests: `tests/test_llm.py`, `tests/test_llm_live.py` (opt-in); `tests/conftest.py` (no real provider in tests);
  `pytest.ini` (`llm_live` marker).
