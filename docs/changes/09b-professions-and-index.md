# 09b — Profession database (O*NET + ESCO) and the role-skill FAISS index

**Status:** implemented · **Date:** 2026-10-14 · **Affects:** AIServices (professions, importers, role-skill index), CoreServices (admin profession endpoints)
**Requirements:** Module 5 FE-2 / FE-3 (groundwork), Module 10 FE-4, FR12.5 (preview before publishing), CON-8
**Builds on:** [09a — skill embeddings](09a-skill-embeddings.md), [09a2 — bge-small + descriptions, threshold 0.73](09a2-embedding-model-selection.md)

## Summary

- **New profession database:** `ai_db.professions` is built **only from public datasets**, plus admin-created ("manual") professions:
  - **O*NET 31.0:** 30 ICT occupations, each with up to 30 hot or in-demand technologies;
  - **ESCO v1.2.1:** 113 ICT occupations, with their essential and optional skills.
  - **Also stored:** all **13,939 ESCO skills** (`ai_db.esco_skills`).
- **Importers are reusable services:**
  - `preview_import(...)` validates and reports what would change, without writing anything (FR12.5);
  - `publish_import(...)` writes, embeds and rebuilds the index.
  - The CLI scripts call these functions, and so will next task's admin page.
- **Role-skill index:** each distinct skill of the active professions has **its own vector**, held in a **FAISS** index (`IndexIDMap(IndexFlatIP(384))`).
  - The index is persisted to disk, validated by a state hash on startup, rebuilt in the background and swapped in atomically.
  - `search_related()` returns related role skills: cosine ≥ the 0.73 threshold, the user's own skills excluded (those are exact matches), each with a **mutual-nearest-neighbour flag**.
  - It uses no averaged role or user vectors.
- **CoreServices `/api/admin/professions`** is now a **pass-through** to AIServices:
  - paths and envelopes are unchanged, plus compatibility fields;
  - AdminLog entries are kept;
  - if AIServices is down, it returns 503 `PROFESSIONS_UNAVAILABLE`;
  - the Core `Profession` model is removed.
- **Not in this task:** matching endpoints, scoring and any UI. The admin page comes in the next task.

## Data model

### `ai_db.professions`

```
{ profession_id: "onet:15-1254.00" | "esco:<uuid>" | "manual:<id>",   unique
  title, alt_titles[≤15], description, category,
  source: 'onet' | 'esco' | 'manual', source_code, source_version ("O*NET 31.0" | "ESCO v1.2.1" | "manual"),
  skills: [{ name, key, type: 'essential' | 'optional' | 'technology',
             hot, in_demand, original_label, element_name? }],
  active, inactive_reason,
  disabled_by_admin?, category_set_by_admin?, created_by?, updated_by?,
  created_at, updated_at }
indexes: profession_id (unique), source, category, skills.key (multikey)
```

**Skill names and duplicates:**
- `name` and `key` come from the shared normaliser (`normalise_skill`), so a role skill and a user skill with the same canonical key are an exact match.
- Skills are **de-duplicated by key; the strongest type wins:** essential > technology (hot or in-demand) > technology > optional.

**Active and inactive professions:**
- A profession with **fewer than 5 skills** is stored but inactive (`inactive_reason: "only N skills (minimum 5)"`).
- **Admin overrides survive re-imports:** a deactivation or delete (`disabled_by_admin`) and a changed category (`category_set_by_admin`) are kept.
- A profession that **disappears from a dataset** is **deactivated** (`"not in O*NET 31.0"`), never deleted.
- `PROFESSION_SOURCES` (default `onet,esco,manual`) selects which sources' active professions the index uses.

**Categories:** there are 9, in `app/data/role_categories.json`:
- Development, Data & AI, Infrastructure & Cloud, Security, Design, Quality & Testing, Management & Product, Support & Networking, Other.
- A category comes from the most specific SOC or ISCO prefix, then from title keywords, else "Other".

### `ai_db.esco_skills` (all 13,939)

`{ uri (unique), label, alt_labels[], description, skill_type, reuse_level, digital, source_version, updated_at }`

**Duplicates:** `skills_en.csv` has 13,960 rows but repeats **21 URIs**: the same skill with a later `modifiedDate`. The newest row wins, and the report states the duplicate count.

### `ai_db.profession_imports`

One summary document per published import: `{ source, version, actor, occupations, active, written, added, updated, removed, at }`, for the future admin history view.

## Importers

| | O*NET 31.0 (`AIServices/data/raw/onet/`) | ESCO v1.2.1 (`AIServices/data/raw/esco/`) |
|---|---|---|
| Files | `occupation_data.csv`, `job_titles.csv`, `software_skills.csv` | `occupations`, `skills`, `occupationSkillRelations`, `digitalSkillsCollection` (each with or without `_en`) |
| Selection | SOC codes starting `15-12`, `15-2051` (`ONET_SOC_PREFIXES`), **minus `15-1299.00` "Computer Occupations, All Other"** (`ONET_SOC_EXCLUDE`; listed in the report) | ISCO groups starting `251`, `252`, `351`, `352`, `2166` (`ESCO_ISCO_PREFIXES`) |
| Alt titles | Job Title + Short Title, case-insensitive dedupe, never the title itself, max 15 | `altLabels` (multi-line), max 15 |
| Skills | software rows with Hot Technology = Y **or** In Demand = Y; max 30 (`ONET_SKILLS_CAP`), in-demand first, then hot; type `technology` | essential / optional relations joined by URI |
| Cleaning | name map (`app/data/onet_name_map.json`), " software" suffix, AWS rule, acronym collapse ("JavaScript Object Notation JSON" → JSON), vendor prefix strip only when the rest is a known skill, curated spelling | qualifier strip when the base is known ("Python (computer programming)" → Python), curated spelling |
| Kept for traceability | `original_label`, `element_name` | `original_label` |

**Robust reading:**
- Columns are always read by **header name**.
- A UTF-8 BOM and multi-line quoted fields are handled.
- `validate_files()` checks every required file and column **before** anything is read. It returns one error that lists all problems, e.g. `missing file: software_skills.csv`, `job_titles.csv: missing column(s) ['Job Title']; found [...]`.

**`ImportReport`** (returned by both functions, printed as JSON by the scripts) contains:
- `ok`, `errors`, `warnings`;
- `occupations`, `active`, `inactive`, `skills`, `distinct_skills`;
- **`added` / `updated` / `removed`** occupation IDs compared with the current DB, plus `unchanged`;
- `stats`, which is source-specific:
  - O*NET: kept and excluded occupations, % mapped to curated names, % described, top 30 unmapped labels;
  - ESCO: per-ISCO counts, relation and skill-type counts, digital count, duplicates, % described, top 30 undescribed skills;
- for publish only: `written` (inserted / updated / unchanged / deactivated / esco_skills) and `index`.

**Scripts** (from the repo root; all take `--dry-run`):
- `AIServices/scripts/import_onet.py`
- `AIServices/scripts/import_esco.py`
- `AIServices/scripts/migrate_manual_professions.py`: moves `core_db.professions` into `ai_db` as `manual:<Core _id>`. core_db held **0 documents**, so it reported "nothing to migrate".

**Dataset files** are git-ignored. `AIServices/data/raw/README.md` has the download steps and the attribution:

> This product uses the O*NET 31.0 Database by the U.S. Department of Labor, Employment and Training Administration (USDOL/ETA), used under the CC BY 4.0 licence (https://creativecommons.org/licenses/by/4.0/). The data was modified for this product.
>
> ESCO v1.2.1 © European Union, https://esco.ec.europa.eu

**ESCO descriptions:** `EscoDescriptionProvider` is appended to the description chain (after the curated file) **only when `ESCO_DESCRIPTIONS_ENABLED=true`**. The default is off, because the 0.73 threshold was measured on curated descriptions.

## Role-skill embeddings and the FAISS index

**Embeddings:**
- After an import or a profession change, the distinct role-skill keys of the active professions are embedded through the **existing** `get_skill_vectors`. That means the same `skill_vectors` cache, the same model and the same "Name: description" text.
- Embedding runs in batches of 256 and only for cache misses. If the model is still loading, the build waits for it in the background.

**`RoleSkillIndex`** (`app/services/professions/role_index.py`):
- **Index:** `faiss.IndexIDMap(faiss.IndexFlatIP(dim))` over unit vectors, so the inner product is the cosine. FAISS id *i* is `keys[i]`.
- **Sidecar:** key → name, and key → `[{profession_id, title, type, hot, in_demand}]`.
- **Files** in `AIServices/data/index/` (git-ignored):
  - `role_skills.faiss`;
  - `role_skills.meta.json`: `{ model, text_mode, state_hash, built_at, dim, count, keys, names, roles }`.
  - Both are written to temp files and then `os.replace`d.
- **`state_hash`** = sha256 of the model, the text mode, every active profession's (id, key, type, hot, in_demand) and every role skill's embedded-text hash. So a new or changed profession, a description change or a model switch invalidates the saved index.
- **Startup** (`ROLE_INDEX_AUTOLOAD`): if the meta still matches, the files are loaded with no model needed. Otherwise the index is rebuilt in the background.
- **Rebuilds:** a new snapshot is built and then swapped in. Concurrent rebuild requests coalesce: one more run follows if something changed meanwhile.
- **States:** `empty`, `building`, `waiting_for_model`, `ready`, `no_professions`, `failed`.
  - A query before the first index exists → `IndexUnavailable("INDEX_BUILDING")`, which becomes 503 in Module 5.
  - With no active professions → `NO_PROFESSIONS`.
  - During a rebuild, the previous snapshot keeps serving.
- **`search_related(user_keys, user_matrix, k=50)`:**
  - **Threshold and filtering:** the threshold comes from `get_related_threshold()`, which raises `ThresholdUnavailable` for an unmeasured model or text mode. Role skills the user already has are excluded.
  - **Each result:** `{user_key, role_key, role_name, similarity, mutual_nn, roles}`, sorted by similarity.
  - **`mutual_nn`** is true when the role skill is among the user skill's `MUTUAL_NN_K` (10) nearest role skills **and** the user skill is among the role skill's 10 nearest user skills.
- **`roles_for_skill(key)`:** the professions that need a skill.
- **`/health`** now includes:
  - `professions`: active per source, distinct role skills, % described;
  - `roleSkillIndex`: state, count, dim, model, built_at, last build time.

## Admin CRUD

**AIServices** (`/internal`, `X-Internal-Key`, blocked at the gateway):

| Route | Notes |
|---|---|
| `GET /internal/professions` | `page`, `limit ≤ 100`, `search` (title / alt titles / code, case-insensitive), `category`, `active`, `source` → `{success, data, pagination}` |
| `GET /internal/professions/{id}` | 404 `NOT_FOUND` |
| `POST /internal/professions` | always `manual`; Pydantic validation (422 `VALIDATION_ERROR`), unknown category 400, duplicate manual title 409 `DUPLICATE_PROFESSION` |
| `PATCH /internal/professions/{id}` | manual: all fields. O*NET / ESCO: **only `category` and `active`**, else 409 `IMPORTED_PROFESSION` (they are updated by re-importing) |
| `DELETE /internal/professions/{id}` | soft delete: `active:false`, `inactive_reason:"deleted by admin"`, `disabled_by_admin:true` |
| `POST /internal/index/rebuild` | `?wait=true` to build synchronously; else background |
| `GET /internal/index/status` | index health |

Every write schedules a background index rebuild.

**CoreServices `/api/admin/professions`:**
- **Paths:** GET, POST, PUT `/:id` and DELETE `/:id` are unchanged, and admin authentication is unchanged.
- **Requests:** Core accepts the old field names (`code`, `alternativeTitles`, `requiredSkills` as strings or `{name,type}`, `isActive`) and the new ones, and drops anything else. PUT → AI PATCH. `source` in a create is ignored, since admin professions are always manual.
- **Responses** keep `{success, data, pagination}` / `{success, message:'Profession deleted'}`. They add `_id` (= `profession_id`), `code`, `alternativeTitles`, `requiredSkills` (names) and `isActive` to the AI document.
- **Errors:**
  - AI 4xx passes through with its code;
  - AI 422 becomes Core's 400 `VALIDATION_ERROR` with `errors`;
  - unreachable, timeout or 5xx → **503 `PROFESSIONS_UNAVAILABLE`**, and no AdminLog entry is written.
- **AdminLog:** `CREATE_PROFESSION`, `UPDATE_PROFESSION` (with the changed field names) and `DELETE_PROFESSION` use `resourceId = profession_id`.
- **Unchanged:** the `/api/admin/skills` (SkillTaxonomy) endpoints.

## Verification

### Automated tests

| Suite | Before | After |
|---|---|---|
| AIServices pytest | 289 passed, 1 skipped | **340 passed, 1 skipped** (+51 in `tests/test_professions.py`) |
| CoreServices Jest | 220 | **229** (+9 in `tests/adminProfessions.test.js`) |

**AI tests** (fixtures in `tests/fixtures/onet` and `tests/fixtures/esco` use the exact dataset headers, a BOM, multi-line altLabels, both `_en` and plain names, and a duplicated ESCO URI):
- **File validation:** missing files and columns are listed; header reads handle the BOM.
- **Label cleaning:** 11 O*NET and 3 ESCO cases.
- **Dedupe rank**, `PROFESSION_SOURCES` and categories.
- **O*NET rules:** prefix and exclude filters, alt-title rules, the hot / in-demand filter and order, the cap, inactive below 5 skills, kept labels.
- **ESCO rules:** ISCO filter, essential beats optional, all skills stored, newest duplicate wins, stats.
- **Preview and publish:**
  - preview writes nothing and reports validation errors and added / updated / removed;
  - publish then preview shows everything unchanged;
  - missing professions are deactivated;
  - admin overrides survive a re-import;
  - the ESCO description provider works when enabled.
- **Index:**
  - states (`INDEX_BUILDING`, `NO_PROFESSIONS`, `waiting_for_model`);
  - build, persist, reload without a rebuild, and a rebuild when the state hash changes;
  - inactive professions are not indexed;
  - `search_related` with a geometry-controlled stub embedder: owned keys excluded, the threshold applied, sorting, and a `mutual_nn` true/false case;
  - an unmeasured threshold raises.
- **CRUD routes:** key required, create, duplicate, validation, search, paging, filters, imported-field lock, category kept across re-import, soft delete, 404, the rebuild route.

**Core tests:**
- admin only;
- query and field mapping with compatibility fields;
- the actor is sent;
- AdminLog entries;
- 422 → 400;
- 409 / 404 pass-through;
- AI down → 503 with no AdminLog entry, and AI 5xx → 503.

### Live check (real datasets, real model, local MongoDB)

**Dry runs:**

| | O*NET 31.0 | ESCO v1.2.1 |
|---|---|---|
| Occupations kept | **30** (15-1299.00 excluded and listed) | **113** (251: 55, 252: 20, 2166: 16, 352: 14, 351: 8) |
| Active / inactive | 30 / 0 | 113 / 0 |
| Skill rows | 882 hot/in-demand rows kept → **874** role skills, **171** distinct | **6,762** relations (2,595 essential, 4,167 optional) → **1,313** distinct names (1,314 URIs) |
| Skill types | technology | 792 skill/competence, 517 knowledge, 5 untyped |
| Digital skills | — | 735 of the used skills (1,284 in the collection) |
| Mapped to curated names | **80.0 %** | **6.9 %** |
| With a description | **80.0 %** | **6.9 %** |
| `esco_skills` | — | **13,939** (21 duplicate rows collapsed) |
| Migration of core_db professions | 0 documents → nothing to migrate | |

- **Top unmapped O*NET labels** (kept as their own skills): Adobe Acrobat (14), AJAX (12), Apache Tomcat (11), Apple macOS (11), Firewall software (10), Microsoft Outlook (9), Microsoft Access (9), Apache Maven (8), Apache Subversion SVN (8), Adobe Creative Cloud (8), …
- **Top undescribed ESCO skills:** computer programming (42 roles), AJAX (38), SAS language, Common Lisp, Visual Basic, OpenEdge ABL, Assembly (computer programming), SAP R3 (35 each), APL, VBScript, …

**Real imports** (`publish_import` via the CLI, model load ~10 s included):

| | Time | Written | Index after |
|---|---|---|---|
| O*NET | 15 s | 30 inserted | 171 skills, build 0.05 s |
| ESCO | 27 s | 113 inserted, 13,939 esco_skills | **1,441 distinct role skills** (171 + 1,313 − 43 shared), dim 384, build 0.41 s |

**Index cost:**

| Measure | Value |
|---|---|
| `role_skills.faiss` | 2.2 MB |
| `role_skills.meta.json` | 1.3 MB |
| Load from disk | 0.2–0.5 s |
| Memory (Python allocations: the 2.1 MB vector matrix copy, the sidecar dicts and the FAISS buffer) | ~6 MB |
| Rebuild from MongoDB with cached vectors | 0.25–1.4 s |
| Embedding all 1,441 role skills from scratch (bge-small, CPU) | ~7 s |

**Services on alternate ports** (AI 8100, Core 3100, Gateway 8180):
- **AI `/health`:**
  - The index was **loaded from disk** while the model was still loading: `state: ready`, no rebuild.
  - The health output showed `active_by_source {onet: 30, esco: 113}`, 1,441 distinct role skills and **12.0 % described**.
- **Admin pass-through via the gateway, as a temporary admin:**
  - list with search, source and category filters;
  - create a manual profession → 201, active, and a background rebuild to 1,443 skills (MLflow and a test skill added) in 0.38 s;
  - PUT a title on `onet:15-1252.00` → 409 `IMPORTED_PROFESSION`;
  - DELETE → `{success, message:'Profession deleted'}`, and the index returns to 1,441;
  - `/internal/professions` through the gateway → 404;
  - AdminLog has CREATE / DELETE with `resourceId = profession_id`.
- **Cleanup:** the temporary admin, its 2 AdminLog entries, the test profession, the test skill's vector and both sample users were removed. The imported professions, ESCO skills, role-skill vectors, index files and the two import-log entries (actor `live-check`) are the real data and were kept.

**Sample user React, Python, Docker, Figma** (real bge-small vectors, real index):
- 189 related role skills; each user skill fills its k = 50 neighbour window down to ~0.735.
- **Top related, with mutual flags:**
  - React → JavaScript 0.885 ✓, CoffeeScript 0.856 ✓, Angular 0.848 ✓, TypeScript 0.827 ✓, ASP.NET Core 0.822 ✓;
  - Python → JavaScript 0.851 ✓, Pandas 0.851 ✓, R 0.828 ✓, Scikit-learn 0.817 ✓, Machine Learning 0.813 ✓;
  - Docker → Kubernetes 0.872 ✓, Linux 0.811 ✓, DevOps 0.806 ✓, Ansible 0.785 ✓, Jenkins 0.780 ✓;
  - Figma → Adobe XD 0.881 ✓, design user interface 0.852 ✓, user-centred design 0.848 ✓, UX prototyping 0.823 ✓.
- **React ↔ Python:** this user owns both, so Python is an exact match and is not listed as "related". With **React, Docker, Figma** (no Python), **Python appears as related to React at 0.776 with `mutual_nn: false`**, and to Docker at 0.748, also `mutual_nn: false`. Python is required by 62 professions. The mutual-NN flag therefore filters out the known false positive. Redux ↔ Redis can't be checked: Redux is not a role skill in either dataset.

## Limitations and follow-ups

1. **Most ESCO role skills have no description: 12 % described overall** (O*NET 80 %, ESCO 6.9 %).
   - **Why it matters:** about 1,270 role skills are embedded by bare name, which is outside the conditions the 0.73 threshold was measured under (bge-small name-only AUC was 0.85 in benchmark v2).
   - **What it looks like:** loose pairs above 0.73, such as Docker ↔ Microsoft Word 0.741, Python ↔ Excel 0.798 and Figma ↔ AutoCAD 0.786. They are mostly `mutual_nn: false`.
   - **Options:** curate descriptions for the most frequent ESCO skills (the top-30 undescribed list); enable `ESCO_DESCRIPTIONS_ENABLED` **after** re-benchmarking with ESCO text; or have Module 5 give "related" credit only for `mutual_nn` pairs or only for described pairs.
2. **`mutual_nn` with few user skills:** when a user has 10 or fewer skills, the "user skill in the role skill's top 10" half is always true, so `mutual_nn` reduces to "within the user skill's 10 nearest role skills". It still rejected React → Python (rank > 10 among 1,441 role skills).
3. **`k = 50` caps the related list per user skill.** Module 5 should ask per profession rather than over the whole index (e.g. use `roles_for_skill` or filter by profession) when it scores roles.
4. **ESCO skills are often phrases** ("design user interface", "define technical requirements"). They are matched as skills by embedding only; no user will have them as exact keys.
5. **A CLI import doesn't update a running AI service's in-memory index.** The service picks up the new files on restart, or after `POST /internal/index/rebuild`. The admin page (next task) will call the services in-process.
6. **One ESCO category quirk:** "knowledge engineer" (ISCO 2529) falls under Security via the ISCO prefix; an admin can change it (the change survives re-imports).

## Suggested SDS updates

| Section | Update |
|---|---|
| **§3.5 (data design)** | Add `ai_db.professions` (schema above, indexes on `profession_id` unique, `source`, `category`, `skills.key`), `ai_db.esco_skills` (`uri` unique) and `ai_db.profession_imports`. Remove the Core `professions` collection from `core_db`. Add the role-skill index files (`role_skills.faiss` + `role_skills.meta.json`) as a **derived cache** rebuilt from MongoDB, which remains the source of truth. Correct the 09a note "FAISS is not used": FAISS now indexes **role-skill** vectors (one per distinct skill), while user skills stay in `skill_vectors` / `user_skill_profiles` |
| **Table 3.1 (APIs)** | AIServices internal: `GET/POST /internal/professions`, `GET/PATCH/DELETE /internal/professions/{id}`, `POST /internal/index/rebuild`, `GET /internal/index/status`. CoreServices `/api/admin/professions` (GET, POST, PUT `/:id`, DELETE `/:id` soft delete) is a pass-through to AIServices; errors `PROFESSIONS_UNAVAILABLE` (503), `IMPORTED_PROFESSION` (409), `DUPLICATE_PROFESSION` (409), `VALIDATION_ERROR` (400). AI `/health` gains `professions` and `roleSkillIndex` |
| **CON-8** | Append: "Professions and their required skills come only from public datasets, O*NET 31.0 (CC BY 4.0, USDOL/ETA, modified) and ESCO v1.2.1 (© European Union), plus admin-defined professions. Each role skill is embedded locally with the same model and text as user skills, and stored once per skill. Role-skill vectors are indexed with FAISS (`IndexFlatIP`, exact cosine search), persisted locally and rebuilt from the database whenever professions, descriptions or the model change. No external API is used" |
| **Module 5 FE-2** (profession database) | "The system maintains a database of ICT professions imported from O*NET (SOC 15-12xx and 15-2051, excluding the catch-all 15-1299.00; up to 30 hot or in-demand technologies each) and ESCO (ISCO 251, 252, 351, 352, 2166; essential and optional skills), plus admin-defined professions. Each profession has a title, alternative titles, description, category (one of 9), source, version and a de-duplicated skill list with skill types. Professions with fewer than 5 skills are kept inactive" |
| **Module 5 FE-3** (skill comparison groundwork) | "Each required skill is compared with each of the user's skills individually: the same canonical skill is a match; cosine similarity ≥ 0.73 (bge-small-en-v1.5, description text) is related; otherwise missing. Related candidates are retrieved from a FAISS index of role-skill vectors and carry a mutual-nearest-neighbour flag (each is among the other's 10 nearest), which can be used to suppress false positives such as React–Python. No averaged role or user vectors are used" |
| **Module 10 FE-4** (profession and taxonomy updates) | "Administrators update the profession database from ESCO / O*NET releases. An import is first previewed (files and headers validated; added, updated and removed occupations, skill coverage and unmapped labels reported, with nothing written) and then published (written, embedded, index rebuilt), per FR12.5. Admins can create, edit and deactivate manual professions; imported professions can only be re-categorised or deactivated, and these overrides survive re-imports. Deletion is a soft delete. Every change is audit-logged" (UI in the next task) |
| **Activity diagram 3.6** (profession database update) | Replace it with: Admin selects source and version → **Validate files and headers** → [invalid] show errors, end → **Preview** (diff against the DB, coverage, unmapped labels) → Admin reviews → [reject] end → **Publish**: upsert professions → deactivate missing → (ESCO) store all skills → embed missing role-skill vectors (waits for the model if loading) → **build new FAISS index → atomic swap → persist** → record the import and the AdminLog entry → end |

## Files

**AIServices:**
- `app/services/professions/`: `csv_io.py`, `categories.py`, `cleaning.py`, `store.py`, `onet.py`, `esco.py`, `imports.py`, `role_skills.py`, `role_index.py`, `crud.py`.
- Routes: `app/routes/profession_routes.py`.
- Data: `app/data/role_categories.json`, `app/data/onet_name_map.json`.
- `app/services/embeddings/descriptions.py`: `EscoDescriptionProvider`; the chain is curated → ESCO when enabled.
- `app/main.py`: router, startup index load or rebuild, `/health`.
- Settings and `.env.example`: `PROFESSION_SOURCES`, `PROFESSION_DATA_DIR`, `ONET_*`, `ESCO_*`, `ROLE_INDEX_DIR`, `MUTUAL_NN_K`, `ROLE_INDEX_AUTOLOAD`.
- `requirements.txt`: `faiss-cpu==1.15.1`.
- Scripts: `scripts/import_onet.py`, `scripts/import_esco.py`, `scripts/_profession_cli.py`, `scripts/migrate_manual_professions.py`.
- `data/raw/README.md`.
- Tests: `tests/test_professions.py` and `tests/fixtures/{onet,esco}/`.

**CoreServices:**
- `backend/admin/controllers/adminProfessionController.js`: the pass-through.
- `backend/services/aiServiceClient.js`: `professionsCall`.
- `backend/admin/models/Profession.js`: removed.
- `tests/adminProfessions.test.js`.

**Repo:** `.gitignore` ignores `AIServices/data/raw/*` (except the README) and `AIServices/data/index/`.
