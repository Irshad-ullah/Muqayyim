# 09c — Admin taxonomy: dataset imports with preview, publish, snapshots, restore and direct edits

**Requirements:** SRS Module 10 FE-4 (profession and taxonomy updates), FR12.4 (update the profession / skill
database), FR12.5 (preview before publishing), CON-8 (public datasets only) · builds on 09b (professions, role-skill
index) and the frozen embedding configuration from 09a2 / 09b2.

**Commits (main, not pushed):** Part 1 `d7a0596` · Part 2 `47361bd`, `9ca7e0d` · Part 3 `95abfad` · Part 4 `e5e5524`,
`a1060aa` · Part 5 `f5cf51e`, `ce47708` · Part 6 `7492aa7` · Part 7 `ed52928`, `a713844` · Part 8 `30ada9f` (record
`399b120`) · Part 9 (this document, the CLI tests) — see `git log`.

## Summary

Before 09c the profession database could only be refreshed by running a script on the server (09b). Now an admin does it
from the admin panel, and every change can be seen before it goes live and undone afterwards:

- **Upload** a new O\*NET or ESCO release: one ZIP, or only the CSV files that are needed. Only those files are read; the
  rest of a ZIP is skipped and its names are not kept.
- **Validate** in the background: required files (named exactly when missing), columns, UTF-8, row counts.
- **Preview (FR12.5):** the new data is built in staging collections and compared with the live data — professions
  added / removed / changed (and admin overrides that are kept), required skills added / removed, new skills without a
  description, per-category counts — plus description coverage and the background credit check on the new data. Nothing
  live changes.
- **Publish:** a snapshot of the whole state is taken first, the staged collections are swapped in atomically, the
  role-skill index is rebuilt and checked; any failure rolls back to the snapshot.
- **Restore** any kept snapshot (whole state: professions, ESCO skills, the five taxonomy data files, the index). The
  confirmation lists exactly which imports and edits it undoes; the current state is saved first, so a restore can itself
  be undone.
- **Direct edits** without a dataset: profession title / description / category / active as **admin overrides** that
  survive re-imports (with "reset to dataset value"), and the skill taxonomy (descriptions, aliases, categories). The
  283 benchmark seed descriptions are read-only. Each edit takes its own snapshot; a description change re-embeds only
  that skill.
- The **command-line importers** (`scripts/import_onet.py`, `scripts/import_esco.py`) use the same job pipeline, so
  both paths give identical results.

### Requirement → feature → test

| Requirement | Feature | Tests (TEST_CATALOG has the full list) |
|---|---|---|
| Module 10 FE-4 / FR12.4 — admins update professions and skills from O\*NET / ESCO releases | Upload, validation, publish with snapshot, atomic swap, index rebuild, rollback | AI `test_taxonomy_uploads.py`, `test_taxonomy_publish.py`; Core `adminTaxonomy.test.js`; GW `taxonomyRoutes.test.js`; FE `DataSourcesTab.spec.jsx`, `PreviewPublishTab.spec.jsx`; manual 9c Parts 2, 4, 8 |
| FR12.5 — preview before publishing | Staged build, diff, coverage and background check; nothing live written; publish only from a previewed job whose base is unchanged | AI `test_taxonomy_preview.py` (incl. UI and CLI paths identical), `test_taxonomy_publish.py::…live data changed…`; FE publish-button rules; manual dry runs (Part 3) |
| FR12.4 — direct corrections | Admin overrides with reset, skill taxonomy edits, seed read-only, per-edit snapshot | AI `test_taxonomy_edits.py`; FE `ProfessionsTab.spec.jsx`, `SkillTaxonomyTab.spec.jsx`; manual Parts 5, 8 |
| Undo (reliability) | Snapshots (5 publish, 10 edit), whole-state restore, restore of a restore, crash recovery | AI `test_taxonomy_publish.py` (restore, crash between renames, crashed restore, retention); FE `HistoryTab.spec.jsx`; manual Part 4 (12 measures identical), Part 8 |
| CON-8 — public datasets only, attribution | Only the six (+1 optional) dataset files are read; attribution shown | AI `test_only_required_files_are_extracted`, `test_missing_file_errors_name_only_the_required_files`; FE attribution test |
| Security | Admin-only at Core, identity from the JWT only, internal key, ZIP safety, size limits, rate limit | Core `adminTaxonomy.test.js`; AI route tests (spoofed `created_by` / `actor` ignored), ZIP tests; GW `taxonomyRoutes.test.js` |
| Data integrity | Atomic transitions, the taxonomy lock, snapshot SHA-256 manifest, tests never touch real data | AI `test_taxonomy_jobs.py`, `test_taxonomy_publish.py`, `tests/conftest.py` session guard |

## Architecture

```
Browser (admin)                       API Gateway :8080                 CoreServices :3000                       AIServices :8000
Admin → Professions & Skills  ──►  /api/admin/taxonomy/*  ──────►  /api/admin/taxonomy/*  ───────────►  /internal/admin/taxonomy/*
 (React, 5 tabs)                   upload: streamed, 100 MB,         adminAuthMiddleware (JWT, live        X-Internal-Key required
                                   5 min timeout; others 1 MB;       admin check); X-Admin-Id from the     X-Admin-Id required on changes
                                   publish/restore 5 per 15 min      JWT; streams the upload; AdminLog      jobs, pipeline, snapshots, lock
                                   /internal/* → 404                 after AI answers; 503/504 if AI down   ai_db + work directory
```

- The gateway never parses the upload body; it counts bytes and forwards the stream.
- Core checks the admin before a single upload byte is forwarded, removes `Authorization`, cookies and any identity
  fields, and sends the admin id from the verified JWT as `X-Admin-Id` with the internal key.
- AIServices does the work. Long steps (validation, preview, publish, restore) run in the background and answer `202`;
  the UI polls.

### Endpoints

Core path = `/api/admin/taxonomy` + path (admin JWT); AI path = `/internal/admin/taxonomy` + path (internal key).

| Method | Path | What | Answer |
|---|---|---|---|
| GET | `/sources` | Loaded versions and counts per source, last import, attribution, lock | 200 |
| GET | `/lock` | Who holds the taxonomy lock (operation, actor, since), or `null` | 200 |
| POST | `/jobs` | Upload (multipart: `source`, `dataset_version`, `files`) → validation starts | 202 · 400 · 411 · 413 · 422 |
| GET | `/jobs`, `/jobs/{id}` | List (page, status, source) / one job (poll) | 200 · 404 |
| POST | `/jobs/{id}/preview` | Stage, diff, checks (background) | 202 · 409 |
| GET | `/jobs/{id}/diff?section=&page=` | Diff rows of one section | 200 · 409 |
| POST | `/jobs/{id}/publish` | `{acknowledge_background_warning}` → publish (background) | 202 · 409 · 422 |
| POST | `/jobs/{id}/cancel` | Cancel; staged data deleted | 200 · 409 |
| GET | `/snapshots`, `/snapshots/{id}` | Kept snapshots / one, with what a restore would undo | 200 · 404 |
| POST | `/snapshots/{id}/restore` | Whole-state restore (background) | 202 · 404 · 409 |
| GET | `/restores`, `/restores/{id}` | Restore progress and result (poll) | 200 · 404 |
| GET | `/professions`, `/professions/{id}` | Search (page, search, category, active, source) + the category list | 200 · 404 |
| PATCH | `/professions/{id}` | Title / description / category / active (override on imported ones) | 200 · 404 · 409 · 422 |
| POST | `/professions/{id}/reset` | Reset overrides to the dataset values (`fields` or all) | 200 · 409 |
| GET | `/skills`, `/skills/{name}` | Skill taxonomy (search, category) | 200 · 404 |
| POST | `/skills/validate` | Dry run of a change (nothing written) | 200 |
| POST / PUT | `/skills`, `/skills/{name}` | Create / update description, aliases, category | 201 / 200 · 409 · 422 |

Every changing route is refused with `409 TAXONOMY_BUSY` (and the lock holder) while another operation holds the lock.
Core adds `503 TAXONOMY_UNAVAILABLE` (AI unreachable), `504 TAXONOMY_TIMEOUT` and `499 CLIENT_ABORTED`; the gateway adds
`413 PAYLOAD_TOO_LARGE` and `429 RATE_LIMITED`.

### Collections (ai_db)

| Collection | Contents |
|---|---|
| `professions`, `esco_skills` | The live data (09b). |
| `professions__staging_<job>`, `esco_skills__staging_<job>` | A job's staged data, built with the **same indexes** as the live collections; swapped in by `renameCollection` on publish, dropped on cancel / failure / clean-up. |
| `import_jobs` | One per upload: source, version, status, `created_by`, `published_by`, file summary, validation errors, diff summary, checks, snapshot id, progress, events (every transition). |
| `import_job_diffs` | The full diff rows (`job_id`, section, seq, item), paged by the UI. |
| `taxonomy_locks` | The single lock document (`_id: "taxonomy"`): owner, **actor**, job id, acquired / heartbeat / expiry times. |
| `taxonomy_snapshots` | One record per snapshot: reason (publish / pre-restore / edit), pool, `created_by`, **note** (edits), job id, source versions, counts, state hash, fingerprint, size. |
| `restore_jobs` | One per restore: snapshot, status (restoring → restored / failed / rolled_back), progress, result, `created_by`. |
| `service_heartbeats` | The AI service's heartbeat (used by the CLI to warn that a running service's index is out of date). |

### Work directory and snapshot layout

`TAXONOMY_WORK_DIR` (default `~/.muqayyim/taxonomy/`):

```
staging/<job_id>/            the job's staged dataset files (only the expected names); removed after publish,
                             cancel or failure, and by the hourly clean-up after TAXONOMY_STAGING_TTL_HOURS (24)
snapshots/<snapshot_id>/     snapshot_id = <UTC yyyymmddThhmmss>-<random>, written to .tmp-<id> then renamed
  professions.jsonl.gz       all professions (canonical extended JSON, one document per line)
  esco_skills.jsonl.gz       all ESCO skills
  index/role_skills.faiss    the role-skill index and its metadata (state hash, count)
  index/role_skills.meta.json
  data/                      skill_descriptions.json, skill_aliases.json, skill_categories.json,
                             onet_name_map.json, esco_name_map.json
  manifest.json              SHA-256 and size of every file; checked before any restore
```

Retention: the newest 5 in the **publish** pool (publish and pre-restore snapshots, `TAXONOMY_SNAPSHOTS_KEEP`) and the
newest 10 in the **edit** pool (`TAXONOMY_EDIT_SNAPSHOTS_KEEP`).

## Job lifecycle

| From | Allowed next statuses |
|---|---|
| `uploaded` | `validating`, `cancelled` |
| `validating` | `validated`, `failed` |
| `validated` | `previewing`, `cancelled` |
| `previewing` | `previewed`, `failed` |
| `previewed` | `publishing`, `cancelled`, `previewing` (re-preview after the live data changed) |
| `publishing` | `published`, `failed`, `rolled_back` |
| `published`, `failed`, `rolled_back`, `cancelled` | — (final) |

Every transition is a single conditional update (`{job_id, status: from}`), so two concurrent requests can't both move a
job; the loser gets `409 JOB_STATE`. Each transition is appended to the job's `events`. Background failures store a
safe message only (no file contents, no stack).

Publishing a previewed job checks, in order: the job is `previewed`; the background warning is acknowledged if there is
one (`422 BACKGROUND_ACK_REQUIRED`); the lock is free (`409 TAXONOMY_BUSY`); **under the lock**, the live data's
fingerprint still equals the one the preview was built against (`409 LIVE_DATA_CHANGED`). Then: snapshot → swap →
index rebuild → post-publish checks (the rebuilt index's state hash must match the published data) → `published`; any
failure restores the snapshot → `rolled_back` (or `failed` if even that is impossible, with an error log).

### The lock and heartbeat

- One lock for every operation that changes live data: publish, restore, direct edits, recovery (`taxonomy_locks`).
  Uploads, validation and previews don't take it (they only write staging data).
- Acquiring is one upsert that matches only a missing or expired lock; a live lock makes it fail → `TaxonomyBusy` with
  the holder (without its secret holder token).
- While held, a heartbeat renews `expires_at` every 60 s (`TAXONOMY_LOCK_HEARTBEAT_SECONDS`) with a 5 min TTL
  (`TAXONOMY_LOCK_TTL_SECONDS`). A holder that died (crashed process) stops renewing; after 5 min the lock can be taken
  again, and the dead holder can no longer renew or release the newer lock.
- The lock records `owner` (`job:<id>`, `cli:<id>`, `edit:<what>`, `restore:<id>`, `recovery:…`) and `actor` (admin id,
  `cli` or `system`) — the admin UI shows both in its banner and disables every changing button.

### Crash recovery

At startup and then every 60 s (`TAXONOMY_RECOVERY_INTERVAL_SECONDS`) the service recovers work whose process died:

- `validating` / `previewing` jobs → `failed` ("Interrupted by a service restart"); CLI previews still running in their
  own process are left alone.
- `publishing` jobs (incl. a crash **between the two collection renames**) → the snapshot is restored → `rolled_back`.
- `restoring` restores → the pre-restore snapshot is restored → `rolled_back`.
- Recovery waits while a live lock is held (the operation may still be running in another process). A failed round is
  logged and retried next round. Hourly clean-up removes expired staging folders and orphan staging collections, never
  those of running jobs.

## Safety measures

**ZIP safety and limits.** Refused with `422` and nothing kept: paths that leave the folder (zip-slip: `..`, absolute
paths, drive letters, both slash styles — `ZIP_UNSAFE`), symlink entries, more than 500 entries
(`TAXONOMY_MAX_ZIP_ENTRIES`), a file that is not a ZIP, a ZIP and CSVs together, the same expected file twice. More than
500 MB uncompressed (`TAXONOMY_MAX_UNZIPPED_MB`) is refused with `413 ZIP_TOO_LARGE`, checked against the declared sizes
**and** the bytes actually written while extracting (a zip bomb can lie in its header). Only the expected file names are
extracted; the job records why it was refused.

**Streaming and the 413 behaviour.** The gateway streams the upload (no body parser) with its own limit of 100 MB
(`GATEWAY_MAX_TAXONOMY_UPLOAD_BYTES`) and a 5 min timeout (`GATEWAY_TAXONOMY_UPLOAD_TIMEOUT_MS`); every other route
keeps the 1 MB JSON limit. A declared `Content-Length` over the limit gets `413` at once; with `Expect: 100-continue`
the 413 replaces "100 Continue", so no body is sent at all (101 MB → 413 in 7.5 ms, 0 bytes). Without `Expect`, or for
chunked uploads, bytes are counted and the upload stopped at the limit; the gateway then discards at most 2 s / 16 MB
before answering, because answering a still-sending client at once made it see a connection reset instead of the 413
(found by testing in Part 7). Nothing of a refused upload is forwarded. AIServices checks the limit again
(`TAXONOMY_MAX_UPLOAD_MB`, while copying) and Core streams without buffering.

**Identity from the JWT only.** Core's `adminAuthMiddleware` verifies the token and the user's live admin status (03),
then sets `X-Admin-Id` from the token. Client-supplied identity is ignored everywhere: the `created_by` form field, body
fields `actor` / `created_by`, and an `X-Admin-Id` header from the browser (stripped by Core). AIServices trusts
`X-Admin-Id` only together with a valid `X-Internal-Key`, requires it on every changing route (checked before the upload
body is read), and reserves `cli`, `system` and `unknown`. `/internal/*` is never proxied by the gateway.

**AdminLog.** Core writes one entry per changing action **after** AI answers, including refusals and failures:
`TAXONOMY_UPLOAD`, `TAXONOMY_PREVIEW`, `TAXONOMY_PUBLISH` (with the acknowledgement flag), `TAXONOMY_CANCEL`,
`TAXONOMY_RESTORE` (restore id), `TAXONOMY_EDIT` (target, field **names** only, snapshot id), `TAXONOMY_VALIDATE`. The
result's status and code are stored; request bodies, values and file contents never are. A failed log write keeps the
response and is itself recorded as an error (`ADMIN_LOG_WRITE_FAILED`). A client that aborts an upload gets no job and a
`499 CLIENT_ABORTED` entry.

**Rate limit.** Publish and restore are limited to 5 per 15 min (`RATE_LIMIT_TAXONOMY_PUBLISH_MAX`,
`RATE_LIMIT_TAXONOMY_PUBLISH_WINDOW_MINUTES`) at the gateway, with `Retry-After` (exposed to the browser).

## Notes and decisions

1. **Alias keys and Module 5 — normalise at match time.** A skill's canonical key comes from the alias table at the
   moment it is stored. After an admin alias edit (or a release changing aliases), keys stored earlier can be stale:
   role skills in `professions.skills[].key` until the next import, and user skills in `user_skill_profiles` /
   `cv_parsed_data.skills_canonical` until the profile is saved again. The role-skill index already re-normalises
   stored names when it builds (`role_skills.current_skill`). **Module 5 must normalise both sides with the current alias
   table when it matches** (same key = 1.0 credit) and not compare stored keys directly.
2. **Refused access.** A non-admin call to any `/api/admin/taxonomy/*` route is refused by Core with 403 before anything
   reaches AIServices (an upload's body is not forwarded). It is recorded only as the gateway's access log line, the same
   as for every other admin route; no AdminLog or security event is written for it.
3. **Publish / restore rate limit keyed by IP, by design.** Keying by user would need the gateway to verify tokens, which
   means giving it the JWT signing secret; the secret stays in the services that verify tokens (Core, AI). Publish and
   restore are admin-only in Core anyway, so the limit is a brake, not the access control. If per-admin limiting is ever
   needed it belongs in Core after `adminAuthMiddleware`. (The gateway would key by user id only if `JWT_SECRET` were set
   for it, which the deployment deliberately does not do; at startup it logs "publish/restore rate limit keyed by IP;
   per-user limiting is not configured by design".)
4. **CLI audit record.** CLI imports don't pass through Core, so they get no AdminLog entry. Their audit record is the
   job itself: `import_jobs.created_by = "cli"` (or the `--actor` given), its events, its snapshot, and `published_by`.
5. **Legacy Core `/api/admin/skills` (and `/api/admin/professions`) — clean-up candidate.** These older CRUD routes
   on Core's own collections predate 09b/09c, are not used by the frontend, and are not the source of truth for matching
   (`ai_db.professions` and the AI skill taxonomy are). They were left unchanged in 09c to keep its scope; remove them in
   a later clean-up.
6. **AI-side changes made for the admin UI (Part 8).**
   - The lock records its `actor`, so the banner can say who holds it.
   - Edit snapshots record a `note` naming the edit (e.g. `skill "Tomcat": description`).
   - The restore detail names the publisher of each undone import (`published_by`).
   - **Fix:** the restore detail left out the restored snapshot's own edit — an edit (or pre-restore) snapshot is taken
     just before its change, so restoring it undoes that change too (`$gt` → `$gte`).
   - The profession list returns the category list for the edit form.
7. **Vector repair after a restore (Part 5).** The vector cache is not part of a snapshot; after every restore,
   `repair_vectors()` re-embeds any skill whose restored text has no vector (on real data the repaired vector was
   bit-identical to the original).

## Known limitations

1. **The frozen embedding configuration.** The preview's background credit check and the index rebuild rely on the
   configuration frozen in 09b2 and must not be tuned before Module 5's end-to-end evaluation: `BAAI/bge-small-en-v1.5`;
   user and curated skills embedded as "Name: description", ESCO skills by label; one related threshold **0.73** for
   both pair kinds (`get_related_threshold`, guarded); mutual nearest neighbours (K = 10) required only for
   described ↔ described pairs; the background check passes when the unrelated (chef) profile is credited for ≤ 5 % of
   role skills and ≤ 0.5 × the related (web) profile (currently 3.0 % vs 12.2 %). A release that fails it can only be
   published with the explicit acknowledgement.
2. **A CLI publish doesn't update a running service's in-memory index** (09b limitation 5, still true). The CLI warns
   when the service's heartbeat is fresh; rebuild with `POST /internal/index/rebuild` or restart the service.
3. **One import at a time per source is not enforced:** two jobs can be previewed in parallel; the second publish is
   refused with `LIVE_DATA_CHANGED` because the first one changed the live data, and must be previewed again.
4. **The lock is not polled while it is free.** The admin page polls the lock (and jobs, restores) every 2 s only while
   something runs; an operation another admin starts is noticed on the next request (409 with the holder) or reload.
5. **Snapshots are local files** under the work directory of the AI host. They are not a backup: losing that disk loses
   the undo history (keep normal database backups).
6. **The background check needs the embedding model.** If it isn't ready the preview records "check unavailable",
   which counts as a warning and needs the acknowledgement to publish.
7. **No end-to-end automated test across gateway → Core → AI.** Each hop is tested against a stub of the next; the full
   chain was checked manually (Parts 6–8).

## Verification

See `docs/testing/TEST_LOG.md` (sections "9c Part 1" … "9c Part 9" and the 9c summary) and `docs/testing/TEST_CATALOG.md`
(Module 10 rows). In short: AI 392 → 517 tests, Core 229 → 247, Gateway 46 → 62, frontend 25 + 21 → 31 + 70; manual checks
on the real datasets in Parts 2–8 (validation counts identical to 09b, empty-diff dry runs, publish → restore identical
in 12 measures, edits restored with identical file hashes, Core 403, gateway 413, browser walkthrough 16/16).

## Suggested SDS updates

| Section | Add or replace |
|---|---|
| **Module 10 FE-4** (replace the 09b text) | "Administrators update the profession and skill database from O\*NET and ESCO releases in the admin panel. An upload (one ZIP or the required CSV files, up to 100 MB) is validated in the background; a preview builds the new data separately and shows the professions and required skills added, removed and changed, admin overrides kept, new undescribed skills, description coverage and the background credit check, without changing live data. Publishing takes a snapshot, swaps the new data in atomically, rebuilds the role-skill index and rolls back automatically on any failure. Any of the last five publish snapshots and ten edit snapshots can be restored; the confirmation lists the imports and edits that will be undone. Administrators can also correct professions (title, description, category, active — kept as overrides across re-imports, with reset to the dataset value) and the skill taxonomy (descriptions, aliases, categories; the benchmark seed descriptions are read-only)." |
| **FR12.5** | "The system shall show a preview of every dataset import (differences against the live data and the coverage and background-credit checks) and shall publish only a previewed import whose base data has not changed since the preview." |
| **§3.3 / component diagram** | Add the import pipeline in AIServices (uploads, pipeline, publishing, snapshots, editing, lock) and the Core pass-through `/api/admin/taxonomy/*` (streamed upload, AdminLog). |
| **§3.5 (data design)** | Add `import_jobs`, `import_job_diffs`, `taxonomy_locks`, `taxonomy_snapshots`, `restore_jobs`, `service_heartbeats` and the staging collections (fields as in "Collections" above); add the work directory and snapshot layout. |
| **Table 3.1 (APIs)** | Add the endpoints table above (Core `/api/admin/taxonomy/*`, AI `/internal/admin/taxonomy/*`). |
| **State diagram (new): import job** | `uploaded → validating → validated → previewing → previewed → publishing → published`; `validating/previewing → failed`; `publishing → rolled_back/failed`; `uploaded/validated/previewed → cancelled`; `previewed → previewing`. |
| **Activity diagram 3.6** (replace the 09b version) | Admin uploads → [rejected] show reason → validate → [invalid] show errors → preview → admin reviews diff and checks → [background warning] admin acknowledges → publish: snapshot → swap → rebuild index → post-checks → [fail] roll back to snapshot → done. Restore: choose snapshot → review what is undone → type RESTORE → snapshot current state → restore → repair vectors. |
| **Security (§ NFR / SEC-3)** | Taxonomy uploads limited to 100 MB at the gateway (413 before the body is sent), ZIP contents checked (paths, links, entry count, uncompressed size); acting admin taken only from the verified token; every change recorded in the admin log (no values or file contents); publish and restore rate-limited to 5 per 15 min. |
| **Reliability (REL)** | Changes to live taxonomy data are serialised by a lock with heartbeat and expiry; interrupted publishes and restores are rolled back automatically at startup and every minute. |
| **CON-8** (append) | "Dataset files other than O\*NET `occupation_data`, `job_titles`, `software_skills` and ESCO `occupations`, `skills`, `occupationSkillRelations` (and optionally `digitalSkillsCollection`) are not read or stored. Attribution: O\*NET 31.0 Database, USDOL/ETA, used under CC BY 4.0, modified; ESCO v1.2.1 © European Union." |
| **Test table (§5.4)** | Add the 9c rows from `docs/testing/TEST_CATALOG.md` (Module 10). |

## Files

- AIServices: `app/services/taxonomy/` (`jobs.py`, `lock.py`, `heartbeat.py`, `uploads.py`, `pipeline.py`,
  `publishing.py`, `snapshots.py`, `editing.py`, `skills_editor.py`, `cli.py`), `app/routes/taxonomy_routes.py`,
  `app/main.py` (startup recovery, loops), `scripts/_profession_cli.py`; tests `tests/test_taxonomy_*.py`.
- CoreServices: `backend/admin/controllers/adminTaxonomyController.js`, `backend/admin/routes/adminRoutes.js`;
  tests `tests/adminTaxonomy.test.js`.
- API Gateway: `middleware/sizeLimit.js`, `middleware/rateLimits.js`, `app.js`, `config.js`; tests `tests/taxonomyRoutes.test.js`.
- Frontend: `src/pages/admin/AdminTaxonomyPage.jsx`, `src/pages/admin/taxonomy/*`, `src/services/taxonomyService.js`,
  route and sidebar entry; specs alongside.
