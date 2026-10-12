# 06 — Server-side validation for profiles, CV generator settings and CV verification

**Status:** implemented · **Date:** 2026-10-12 · **Affects:** CoreServices (backend and frontend), AIServices
**Requirements:** SRS FR5.1–FR5.13, FR6.1–FR6.8, USE-3

## Summary

Until now, profile data was stored almost exactly as the client sent it. `PUT /api/profile` checked only an allowlist of top-level keys and ran with `runValidators: false`. Wrong types crashed the request with a 500 (a Mongoose `CastError`), and none of the SRS field rules were enforced. Now:

- **Every profile write is validated** with Zod, using one schema per profile section. A request validates only the sections it includes, but each of those sections completely. The trimmed and normalised output is what gets stored.
- **One error shape** for all of these errors: `400 { success:false, code:'VALIDATION_ERROR', message, errors:[{ field:'experience[1].endDate', message }] }`. AIServices uses the same shape with status 422.
- **Wrong types return 400, not 500.** Mongoose `CastError` and `ValidationError` are mapped to the same 400 and logged as `warning`. Mongoose constraints stay in place as a second line of defence.
- **One set of limits**, stored in `CoreServices/backend/validation/profileLimits.json`. A JS copy lives in the frontend and a Python copy in AIServices, and parity tests fail if any copy drifts.
- **The CV generator** strictly validates the template, settings, title and snapshot (≤ 200 KB, checked with the profile field rules). Saving also enforces FR6.8: without a name plus at least one of experience, education, projects or skills, the server returns `400 PROFILE_INCOMPLETE` with `missing:[…]`.
- **The Profile Builder** runs the same checks before saving. It shows errors (its own or the server's) inline under the right field and jumps to the first step that has one. Experience and education can now be edited in Step 2; before, they could only be imported.
- **Existing data still loads.** Validation applies on write only. `scripts/report-invalid-profiles.js` lists what would fail on the next save, without changing anything.

## Design decisions

| Decision | Choice | Why |
|---|---|---|
| Library | **Zod 3** (new dependency of CoreServices) | Joi was not a dependency. `express-validator` suits flat fields, not nested arrays of entries with cross-field rules. |
| Partial updates | Validate only the sections present, each one in full. Nested objects (`personalInfo`, `skills`, `projects`, `githubData`) replace the stored object as a whole. | Each wizard save sends whole sections, so behaviour is unchanged. A summary-only save cannot touch or invalidate other sections. |
| Unknown top-level keys | **Rejected (400)**: `"Unknown field"`, or a specific message for `email` and `name`. Read-only keys from `GET` (`_id`, `__v`, `userId`, `createdAt`, `updatedAt`) are ignored. | Silently dropping a misspelled key looks like a save that lost data. Ignoring read-only keys means clients can send back what they fetched. |
| Stored date format | **`YYYY-MM`**, or **`YYYY`** when only the year is known (CV imports). Empty string means "not given". "Present" is never stored; it becomes `current: true` with an empty end date. | Turning a parsed "2019" into "2019-01" would invent a month. One canonical form makes comparisons reliable. |
| Accepted date input | `YYYY-MM`, ISO `YYYY-MM-DD[T…]`, `MM/YYYY`, `Jan 2022` / `January 2022`, `YYYY`, `Present` / `Current` / `Now` / `Ongoing` | These cover what users type and what the CV parser produces. All are normalised on save. |
| Date comparison | At the precision both sides share (`2019` vs `2019-06` is compared by year). Start may equal end. | Year-only dates are allowed. |
| Accent colour | Enum of the five named professional colours (legacy `blue`/`indigo` → navy, `green` → teal). **No custom hex.** | Chosen during planning (the earlier Module 4 decision). |
| Email | Never editable through `/api/profile`. An `email` key, at the top level or inside `personalInfo`, returns 400. Changing email stays on `PUT /api/auth/profile`. | FR5.1 |
| Name | The 2–100 character rule applies on `POST /api/auth/register` and `PUT /api/auth/profile`, because the name lives on the User, not the Profile. A `name` key on `/api/profile` returns 400. | FR5.1 |
| Mongoose errors | 400 `VALIDATION_ERROR` with field paths. Logged at **`warning`** (`errorType` `MONGOOSE_CAST_ERROR` / `MONGOOSE_VALIDATION_ERROR`), with paths only and no values. | It is client input, not a server fault, so it must not count as an error or trigger alerts. It is still logged, because with the request schemas in front, each one marks a gap in the schemas. |

## Rules (field → rule → SRS)

Paths use the API's field names. "Text" means: control characters stripped, then trimmed. Single-line fields also turn tabs and newlines into spaces.

| Field | Rule | SRS |
|---|---|---|
| User `name` (auth register / account) | Required, 2–100 characters, inner whitespace collapsed | FR5.1 |
| `email` (profile API) | Not accepted, top level or `personalInfo.email` | FR5.1 |
| `personalInfo.phone` | Optional. 7–20 characters of digits, spaces, `+ - ( )`, with at least 7 digits | FR5.1 |
| `personalInfo.location` | ≤ 100 | FR5.1 |
| `personalInfo.website` / `linkedin` / `github` | Optional http(s) link, ≤ 300. Bare domains get `https://`. Other schemes (`javascript:`, `ftp:`) are rejected. | FR5.1 |
| `summary` | ≤ 500 (multi-line) | FR5.2 |
| `experience` | ≤ 30 entries | FR5.3 |
| `experience[].title` | Required, ≤ 100 | FR5.3 |
| `experience[].company` | Required, ≤ 150 | FR5.3 |
| `experience[].location` | ≤ 100 | FR5.3 |
| `experience[].startDate` | Required date, not "Present", not after the current month | FR5.3 |
| `experience[].endDate` | Required unless `current`. Not after the current month. On or after the start. "Present" sets `current: true`. | FR5.3 |
| `experience[].current` | Boolean | FR5.3 |
| `experience[].description` | ≤ 1000 (multi-line) | FR5.3 |
| `education` | ≤ 15 entries | FR5.4 |
| `education[].degree` | Required, ≤ 100 | FR5.4 |
| `education[].institution` | Required, ≤ 150 | FR5.4 |
| `education[].field` / `gpa` | ≤ 100 / ≤ 20 | FR5.4 |
| `education[].startDate` / `endDate` | Optional dates, start on or before end. The end may be up to 10 years ahead (expected graduation). An end of "Present" is stored as empty. | FR5.4 |
| `skills.manual` / `cv` / `extracted` | Each skill is text of 1–50 characters (empty entries dropped). Case-insensitive de-duplication across all three lists keeps the first spelling (manual, then CV, then GitHub). At most 100 in total. | FR5.5 |
| `POST /api/profile/extract-skills` | Same skill rules. The merged result must be ≤ 100. | FR5.5 |
| `certifications` | ≤ 30 entries | FR5.6 |
| `certifications[].name` / `issuer` | Both required, ≤ 100 / ≤ 150 | FR5.6 |
| `certifications[].url` | Optional http(s) link | FR5.6 |
| `certifications[].date` | Optional date, not in the future | FR5.6 |
| `projects.manual` / `github` / `cv` / `selected` | ≤ 50 entries each | FR5.7 |
| `projects.*[].name` | Required, ≤ 100 (the SRS "title") | FR5.7 |
| `projects.*[].description` | ≤ 1000 | FR5.7 |
| `projects.*[].url` | A github.com link must be a repository: `https://github.com/<owner>/<repo>`, optionally ending in `/` or `.git` (the owner follows the FR5.8 username rule). Any other link must be http(s) (a live demo). `projects.github[].url` must be a repository link. | FR5.7 |
| `projects.*[].technologies` / `languages` / `topics` | ≤ 30 entries of 1–50 characters, de-duplicated | FR5.7 |
| `githubData.username`, `POST /api/profile/github` | 1–39 characters: letters, digits and single hyphens, with no hyphen at the start or end. Checked before GitHub is called. | FR5.8 |
| `githubData.repos` | List of objects, ≤ 100 | FR5.8 |
| `cvData.parsingStatus` | Empty, or one of the shared CV status values | FR5.9 |
| `cvData.parsedData` | Object, ≤ 200 KB | FR5.9 |
| `cvImportedAt`, `githubData.lastSynced` | A valid date-time or null | FR5.9 |
| Request body | ≤ 1 MB (413 `PAYLOAD_TOO_LARGE`) | general |

### CV generator (`POST` / `PUT /api/generated-cvs`)

| Field | Rule | SRS |
|---|---|---|
| `title` | ≤ 100 (the default `"<name> CV"` is cut to fit) | FR6.1 |
| `template` | `classic`, `modern` or `compact` (empty means `classic`) | FR6.2 |
| `settings.accentColor` | `slate`, `black`, `navy`, `teal` or `burgundy` (legacy keys mapped) | FR6.3 |
| `settings.fontFamily` / `fontSize` | `sans`/`serif` and `small`/`medium`/`large` | FR6.3 |
| `settings.sectionOrder` / `hiddenSections` | Known section keys only, each at most once. Sections left out of the order are appended. | FR6.4 |
| `data` | Required object, ≤ 200 KB as JSON | FR6.5 |
| `data.personal.fullName` | 2–100 characters when present | FR6.8 |
| `data.personal.email` / `phone` / links | Valid email ≤ 254, the FR5.1 phone rule, http(s) links | FR6.5 |
| `data.summary` | ≤ 500 | FR6.5 |
| `data.skills` | ≤ 20 groups (category ≤ 50). Items follow the skill rules, ≤ 100 in total. | FR6.5 |
| `data.experience` / `education` / `projects` / `certifications` | The same entry rules and maximum counts as the profile. Projects also accept `liveUrl` (http(s)). | FR6.5 |
| **Completeness** | A name, **and** at least one of experience, education, projects or skills. Otherwise `400 { code:'PROFILE_INCOMPLETE', message, missing:['name' \| 'experience','education','projects','skills'] }`. A summary alone is no longer enough. | FR6.8 |

Completeness is checked before the field rules, so a user missing their name is told that first. The frontend shows links to where each missing item is added: name → Account settings, experience and education → Profile Builder CV step, projects → Projects step, skills → Skills step. These use `/profile-builder?step=…`.

### AIServices (`PUT /api/cv/verify`)

| Field | Rule |
|---|---|
| `file_id` | `^[A-Za-z0-9-]{1,64}$` (uuid form, no path characters) |
| `verified_data.skills` | ≤ 100 entries; `name` 1–50 characters |
| `verified_data.experience` | ≤ 30 entries; `title` 1–100, `company` 1–150, `duration` ≤ 100 |
| `verified_data.education` | ≤ 15 entries; `degree` 1–100, `institution` 1–150, `year` ≤ 10 |
| `verified_data.projects` | ≤ 50 entries; `name` 1–100, `description` ≤ 1000, `technologies` ≤ 30 entries of 1–50 characters (empty entries dropped) |

Strings are trimmed and control characters stripped before the length checks. The response schemas stay unconstrained, so a parse result always serialises. Freshly parsed data is fitted to these limits before it is stored (`app/utils/limits_fit.py`: text is cut, lists are capped, over-long skill names are dropped), so verifying a parse result unchanged never fails.

## Error format

```json
HTTP 400
{
  "success": false,
  "code": "VALIDATION_ERROR",
  "message": "End date must be after the start date (and 1 more)",
  "errors": [
    { "field": "experience[1].endDate", "message": "End date must be after the start date" },
    { "field": "skills.cv[3]", "message": "Skill must be at most 50 characters" }
  ]
}
```

- `field` uses JS-style paths: dots for keys, `[n]` for list indexes, relative to the request body. Section-level problems (too many entries, too many skills in total) use the section path, e.g. `experience` or `skills`.
- `message` repeats the first error and says how many more there are.
- Submitted values are never echoed back. This includes Mongoose messages, which do contain values, and FastAPI's default `input` field.
- AIServices uses the same body with **HTTP 422**, and paths such as `verified_data.experience[1].title`. A body that is not valid JSON returns `400 INVALID_JSON` from both services.
- The other response shapes are unchanged, apart from the new `errors` (and `missing` for `PROFILE_INCOMPLETE`). Generated-CV 400s previously had `errors` as a list of strings; it is now the object list above.

## Limits (`profileLimits.json`)

| Limit | Value |
|---|---|
| Name | 2–100 |
| Titles / names (job title, degree, field, project, certification) | 100 |
| Company / institution / issuer | 150 |
| Descriptions | 1000 |
| Summary | 500 |
| Location | 100 |
| Links | 300 |
| Skill | 1–50, ≤ 100 in total |
| Technologies per project | 30 |
| Entries: experience / education / certifications / projects (per list) / GitHub repos | 30 / 15 / 30 / 50 / 100 |
| Phone | 7–20 characters, ≥ 7 digits |
| GitHub username | 1–39 |
| CV title / headline / skill groups / category | 100 / 100 / 20 / 50 |
| CV snapshot, `cvData.parsedData` | 200 KB |
| Request body | 1 MB |

**Parity.** The JSON is the source of truth. Three tests check the copies against it:
- `CoreServices/tests/profileLimits.parity.test.js` checks that:
  - the frontend constants equal the JSON;
  - the frontend `validation/profileRules.js` is the backend `rules.js` apart from its import;
  - the rule functions return the same results on both sides;
  - the client validator reports the same error fields as the server on 16 fixtures.
- `AIServices/backend/tests/test_profile_limits.py` checks that the Python constants equal the JSON. It is skipped only if CoreServices is not checked out alongside.

## Files

**CoreServices backend**
- `backend/validation/profileLimits.json`, `profileLimits.js`: the limits.
- `backend/validation/rules.js`: framework-free checks (dates, links, phone, GitHub username, skills, name).
- `backend/validation/profileSchemas.js`: the section schemas, `validateProfileUpdate`, `ALLOWED_FIELDS`.
- `backend/validation/cvSchemas.js`: generated-CV payload and the FR6.8 completeness check.
- `backend/validation/formatErrors.js`: Zod and Mongoose errors → `errors[]`.
- `controllers/profileController.js`: all three write endpoints validated; `runValidators: true`.
- `controllers/generatedCvController.js`: strict payload validation and `PROFILE_INCOMPLETE`.
- `controllers/authController.js`: the name rule on register and account update.
- `utils/serverError.js`, `middleware/errorHandler.js`: Mongoose errors → 400, logged as a warning.
- `models/Profile.js`: `maxlength` and `required` on the main fields (degree and issuer are now required).
- `models/GeneratedCv.js`: title ≤ 100.
- `utils/cvSanitizer.js`: now only normalises the CV *source* (`GET /source`); the old lenient settings and template coercion was removed.

**CoreServices frontend**
- `src/constants/profileLimits.js`, `src/validation/profileRules.js`, `src/validation/validateProfile.js`.
- `components/profile/FieldErrors.jsx`: inline error, aria wiring and the step summary.
- `components/profile/EntriesEditor.jsx`: editable experience and education (new in Step 2).
- Steps 1–5: inline errors. Step 1 gains a Website field and a 500-character summary limit, and requires the issuer for certifications. Step 2 turns parsed durations into dates. Step 3 checks the username before fetching.
- `pages/ProfileBuilderPage.jsx`:
  - runs the client checks;
  - maps server `errors[].field` to the right step;
  - jumps to the first step with an error;
  - clears a section's errors when it is edited;
  - supports `?step=`.
- `pages/CVGeneratorPage.jsx`, `components/cvgen/cvModel.js`: client checks with the profile rules, the `PROFILE_INCOMPLETE` notice with links, and server errors listed.
- `RegisterPage.jsx`, `ProfilePage.jsx`: client-side name rule.
- `services/apiErrors.js`, `profileService.js`, `cvGeneratorService.js`: errors keep `code`, `errors` and `missing`.

**AIServices**
- `app/constants/profile_limits.py`, `app/middleware/validation.py` (the `RequestValidationError` handler), `app/utils/limits_fit.py`.
- `app/schemas/cv_schema.py`: `Verified*Schema` with the limits.
- `app/main.py`, `app/routes/cv_routes.py`: handler registered, and parse results fitted to the limits.

**Repo:** `scripts/report-invalid-profiles.js`.

## Existing data: `scripts/report-invalid-profiles.js`

The script is read-only and does no writes. It runs the same schemas over every stored profile and saved CV, and prints counts per field and rule (`--ids` also lists document ids). It prints no names, emails or other content.

Run on 2026-10-12 against the local `core_db`:

```
Profiles: 2 of 4 would fail validation on their next save
     6  experience[].endDate — End date is required unless this is your current role
     6  experience[].startDate — Start date is required
     2  projects.cv[].name — Project name must be at most 100 characters
     2  projects.selected[].name — Project name must be at most 100 characters

Saved CVs: 1 of 1 would fail validation on their next save
     1  data.projects[].name — Project name must be at most 100 characters
```

What these mean:
- **Experience dates:** all 6 stored experience entries came from the old CV import, which put the duration in `description` and left the dates empty. On their next save, the user is taken to Step 2 with the date fields marked.
- **Project names:** the CV parser produced project "names" longer than 100 characters. New parses are cut to the limit (`limits_fit.py`); the existing ones need shortening on the next save.
- **Nothing was changed.** Every document still loads.

## Tests

| Suite | Before | After | New coverage |
|---|---|---|---|
| CoreServices Jest | 115 | **208** | `profileValidation.test.js` (54): every FR5.1–FR5.8 rule with exact field paths; 8 wrong-type cases → 400 (the CastError regression); summary-only partial save; email can't change the account email; name rule; CV-import and GitHub-apply shaped payloads; extract-skills; existing invalid data still loads; Mongoose CastError/ValidationError → 400 and a warning log without values. `generatedCvValidation.test.js` (16): settings, size, entry rules, update path, `PROFILE_INCOMPLETE`. `profileLimits.parity.test.js` (23). |
| AIServices pytest | 44 | **53** | `test_verify_validation.py`: standard 422 shape, limits, counts, types, `file_id`, invalid JSON, values not echoed. `test_profile_limits.py`: parity with Core's JSON, fitting parse output. |
| Frontend `node --test` | 14 | **19** | Import date parsing, step mapping, labels, FR6.8 completeness, CV field rules. |
| Frontend Vitest | 6 | **13** | A server error on `experience[1].endDate` jumps to the CV step and shows under that field (`aria-invalid`, `aria-describedby`, step summary). Also: client checks block the request; editing clears errors; `?step=`; the `PROFILE_INCOMPLETE` links. |
| API Gateway Jest | 42 | 42 | unchanged |

The production build succeeds. Two test files changed: `authHardening.test.js` registered users named "A", "B" and "N", which FR5.1 now rejects, so they use two-letter names.

**Live check** through the gateway on alternate ports (Core :3100, AI :8100, Gateway :8180): 13 of 13 passed. The run covered:
- registration with 2- and 1-character names;
- the former 500 is now a 400, with nothing logged as an error;
- an exact error path;
- date normalisation and skill de-duplication;
- a summary-only save;
- the email key rejected;
- the GitHub username rule;
- `PROFILE_INCOMPLETE`, a duplicate section key and a valid CV;
- the AI verify 422 shape.

The test users and their data were removed afterwards.

## SDS updates needed

**§4.3 Input Sanitisation** (replace the current paragraph):

> All user-submitted profile, CV-generator and CV-verification data is validated on the server before it is stored. CoreServices uses Zod schemas (`backend/validation/`), one per profile section; AIServices uses Pydantic models with the same limits. Every string is stripped of control characters and trimmed. Lengths, list sizes, formats (dates, http(s) links, GitHub repository URLs, phone numbers, GitHub usernames) and cross-field rules (start ≤ end, no future dates, end date required unless current) are enforced, and the normalised value is what gets stored. Links are restricted to http(s), so `javascript:` and similar schemes cannot reach the UI or the PDF. Request bodies are capped at 1 MB at the gateway and in CoreServices; CV snapshots and parsed-CV data are capped at 200 KB. Mongoose schema constraints (`required`, `maxlength`, `enum`, with `runValidators`) are a second line of defence. The limits are defined once (`profileLimits.json`) and kept identical in the frontend and AIServices by parity tests.

**§5.3 Validation: add a decision table**

| Situation | Response | Logged |
|---|---|---|
| Field fails a rule, or has the wrong type | 400 `VALIDATION_ERROR` with `errors[{field, message}]` (AI: 422) | No (normal client error) |
| Unknown top-level profile key, or `email` / `name` on the profile API | 400 `VALIDATION_ERROR` | No |
| Read-only key (`_id`, `userId`, `createdAt`, …) in a profile body | Ignored | No |
| CV payload without a name or without any of experience/education/projects/skills | 400 `PROFILE_INCOMPLETE` with `missing[]` | No |
| Mongoose `CastError` / `ValidationError` reached despite the schemas | 400 `VALIDATION_ERROR` | `warning` (paths only), marks a schema gap |
| Body is not JSON | 400 `INVALID_JSON` | No |
| Body over 1 MB | 413 `PAYLOAD_TOO_LARGE` | No |
| Stored document violates a newer rule | Loads normally; rules apply on the next write | No (see `report-invalid-profiles.js`) |

**FR5.13 / FR6.8: note them as enforced server-side.**
- FR5.13 (validate profile input): enforced by CoreServices on every write path. These are `PUT /api/profile`, `POST /api/profile/save` (the wizard save, CV import apply and GitHub apply), `POST /api/profile/github` and `POST /api/profile/extract-skills`. Client-side checks only mirror them for usability. No admin endpoint writes profile fields.
- FR6.8 (minimum content to generate a CV): enforced by `POST`/`PUT /api/generated-cvs`, which return `400 PROFILE_INCOMPLETE`. The generator UI shows the same check, with links to the missing sections.

## Notes

- **Plan deviation:** `cvData` and `cvImportedAt` stay client-writable. Step 2 sends them on import, so making them server-owned would have broken the import flow. They are validated instead (CV status enum, 200 KB cap, date-time).
- **Fix found along the way:** `projects.selected` gets duplicate technologies when a repo's language is also one of its topics, so the wizard now de-duplicates them. Editing a GitHub project in Step 5 never matched its card (the repo id is a number, the key a string), which is now fixed.
- **Fix found along the way:** the generated-CV update handler mapped *any* `CastError` to 404. It now does so only for the `_id` path; other cast errors are 400.
- Experience and education had no editing UI. Step 2 now has an editor for both, because without one users could not fix the dates the new rules require.
