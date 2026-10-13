# 09a — Skill embeddings (Module 2 FE-4 / FE-5, CON-8, FR-B9)

**Status:** implemented · **Date:** 2026-10-13 · **Affects:** AIServices (main), CoreServices (backend and frontend), API Gateway

## What an embedding is

An embedding is a list of **384 numbers** that represents the meaning of a skill name. Skills with similar meanings get similar vectors, and closeness is measured by **cosine similarity** (1 = same direction, 0 = unrelated). With the real model, for example, *React* is closer to *Next.js* than to *Accounting*; the slow integration test asserts exactly this.

These vectors prepare for skill-level career matching (Module 5): each skill a role requires will be compared with each of the user's skills **individually**. Therefore:

- **Every skill has its own vector.** A user's skills are never averaged into one profile vector.
- **All skills are equal.** There is no weighting by source (CV, GitHub, manual). How strong a skill is will be assessed later by the assessment module.
- **No backfill.** Vectors are created only when a user's skills change from now on. Existing users get them on their next skill change.

## Model

| | |
|---|---|
| Model | `sentence-transformers/all-MiniLM-L6-v2` (`EMBEDDING_MODEL`) |
| Dimension | 384, L2-normalised, float32 |
| Runtime | sentence-transformers 6.1.0 on **CPU-only** PyTorch 2.14.1+cpu, Python 3.14 (the AIServices venv) |
| Download | once, about 88 MB, into `EMBEDDING_CACHE_DIR` (default `AIServices/backend/models/`, git-ignored) |

**Measured on this machine (Windows, CPU):**
- **New packages:** about 987 MB installed (site-packages went from 488 MB to 1,475 MB).
- **Loading:** importing torch and sentence-transformers takes about 7 s the first time in a process; loading the cached model then takes 0.4 s. `loadSeconds` in the health endpoint reports the two together.
- **Timeline in the live service:** the API answered after 9.4 s (normal startup, with the model state still `loading`). The model was ready 2.3 s later.
- **RAM:** the AIServices process is about 590 MB with spaCy and the model loaded. The model and torch alone add about 484 MB to a bare Python process.
- **Embedding speed:** 30 skills in 42 ms; 1 skill in about 10 ms.

**Loading behaviour:**
- The model loads in a **background task** at startup, and the API never waits for it.
- State is `loading`, `ready` or `failed`. A failed load is logged as **critical** in `error_logs` and retried with backoff (30 s, doubling, up to 10 minutes).
- Health: `GET /api/embeddings/health`, and an `embeddings` block in AIServices `/health`, both report `{ state, model, dimension: 384, loadSeconds, error }`.

## Normalisation and aliases

`normalise_skill(name) -> (key, canonical)` in `app/services/embeddings/normalise.py`:

1. Strip control characters, unify dashes, quotes and slashes, collapse whitespace, trim.
2. Look the name up in `app/data/skill_aliases.json`. The file maps **304 aliases to 128 canonical skills**, with no collisions. Matching ignores case, spaces, dots, hyphens, underscores and slashes, so `ReactJS`, `react.js`, `React JS` and `REACT` all match `React`.
3. **An aliased skill always becomes its canonical name**, even when it appears alone: "ReactJS" is stored as "React". A skill that isn't in the list keeps the user's spelling and casing, cleaned up.
4. **Key:** the canonical name lowercased, with spaces, hyphens and underscores collapsed to one space: `react`, `node.js`, `machine learning`, `ci/cd`. One key means one vector per model.

**Examples:**

| Input | Key | Canonical |
|---|---|---|
| ReactJS, react.js, React JS | react | React |
| js | javascript | JavaScript |
| ts | typescript | TypeScript |
| node, nodejs, node js | node.js | Node.js |
| express, expressjs | express.js | Express.js |
| postgres, postgresql | postgresql | PostgreSQL |
| mongo | mongodb | MongoDB |
| k8s | kubernetes | Kubernetes |
| ml | machine learning | Machine Learning |
| dl | deep learning | Deep Learning |
| nlp | natural language processing | Natural Language Processing |
| gcp | google cloud | Google Cloud |
| aws | aws | AWS |
| ci/cd, cicd | ci/cd | CI/CD |
| html5 | html | HTML |
| css3 | css | CSS |
| vue, vuejs | vue.js | Vue.js |
| tf | tensorflow | TensorFlow |
| sklearn, scikit learn | scikit learn | Scikit-learn |
| "Muqayyim  Design System" | muqayyim design system | Muqayyim Design System (unchanged) |

The **CV skill extractor output is now canonical**, and aliases of one skill collapse to a single entry. On the sample CV, the extractor's skill names change like this:

| Before | After |
|---|---|
| Javascript | JavaScript |
| Mongodb | MongoDB |
| Nodejs | Node.js |
| Typescript | TypeScript |
| Postgresql | PostgreSQL |
| Nextjs | Next.js |
| Express | Express.js |
| Fastapi | FastAPI |
| Numpy | NumPy |
| Html | HTML |
| Css | CSS |
| Gcp | Google Cloud |
| Aws | AWS |
| Nlp | Natural Language Processing |
| Vue | Vue.js |
| Tensorflow | TensorFlow |
| Scikit-Learn | Scikit-learn |
| Tailwind | Tailwind CSS |

**Changed test expectations:** none. No existing test asserted the extractor's skill names (they use fake extractors or fixed data), so all existing tests passed unchanged.

## Data model (ai_db, database-per-service, linked to CoreServices by `user_id`)

### `skill_vectors`: the shared cache, one document per (skill, model)
```json
{
  "key": "react",
  "name": "React",
  "vector": [0.0123, -0.0456, "… 384 floats, unit length …"],
  "model": "sentence-transformers/all-MiniLM-L6-v2",
  "created_at": "2026-10-13T06:47:18Z"
}
```
- There is a **unique index on (key, model)**.
- Each distinct skill is embedded once per model, ever.
- `get_skill_vectors(names)` normalises the names, reads the existing vectors **for the current model only**, embeds just the misses in one batch, and inserts them with `ordered=False`.
- Duplicate-key races are ignored, because a concurrent writer stores the identical vector.

### `user_skill_profiles`: one document per user (no vectors, no weights)
```json
{
  "user_id": "6acd0c…",
  "skills": [
    { "name": "React",   "key": "react",   "source": "manual" },
    { "name": "Python",  "key": "python",  "source": "cv" },
    { "name": "Docker",  "key": "docker",  "source": "github" }
  ],
  "skills_hash": "sha256 of the sorted keys",
  "model": "sentence-transformers/all-MiniLM-L6-v2",
  "embedding_status": "done",
  "requested_at": 1791873638000,
  "updated_at": "2026-10-13T06:47:18Z"
}
```
- `source` is **display only** (the colour on the skill map). It is never read by any calculation.
- **Dedupe by key:** skills are taken in the order **manual → cv → github** (the profile's own dedupe order, so the user's own spelling wins). The first occurrence of a key keeps its name and a single `source`. For example, "ReactJS" from the CV and "React" added by hand become one entry, `React` with source `manual`.
- **Latest request wins:** CoreServices stamps each push with `requested_at`, and AIServices never lets an older request overwrite a newer one (a per-user lock plus a conditional upsert).

### Parse records (`cv_parsed_data`), two new fields
```json
{ "skills_canonical": ["JavaScript", "MongoDB", "Node.js", "…"], "embedding_status": "done" }
```

### Helper for the matching module
`get_user_skill_matrix(user_id) -> (keys, names, matrix [n × 384])`, in the user's skill order:
- returns empty results when the user has no record;
- raises `EmbeddingsPending` while vectors are still being created.

## Refresh triggers

| Event | What happens |
|---|---|
| **CV parsed** (FE-4) | The parse record gets `skills_canonical` and `embedding_status: "pending"`, and the parse response is returned unchanged. A background task embeds the skills (cache warm-up) and sets `done`, or `failed` plus a warning. If the model isn't ready, the record stays `pending` and the worker completes it. |
| **Profile skills change** (FE-5, FR-B9) | Every profile write handler in Core compares a hash of the merged skill keys (lowercased, trimmed, sorted) before and after the write. If it changed, the merged skills `[{ name, source }]` are pushed to `PUT /internal/embeddings/users/:id`. |
| | This covers the Profile Builder save, CV import apply and GitHub import apply, which all save through `PUT /api/profile` / `POST /api/profile/save`. |
| | The merge endpoint (`POST /api/profile/extract-skills`) only returns a merged list without saving, so the save that follows triggers the push. |
| | There is no admin endpoint that edits profile fields. |
| **Summary-only or other non-skill writes** | Hashes are equal, so AIServices is not called (tested). |
| **Same skills sent again** | AIServices compares `skills_hash`; unchanged with the same model returns `{ updated: false }` with no work. |
| **Empty skill list** | The user's record is deleted. |
| **Account deleted** (admin delete) | `DELETE /internal/embeddings/users/:id`. Shared skill vectors stay cached. |
| **Model not ready** | The record is stored as `pending` and the push gets 202. The worker runs when the model becomes ready and then every `EMBEDDING_WORKER_INTERVAL_SECONDS` (30), completing pending parses and profiles. |
| **Model changed** | `AIServices/scripts/reembed_all.py [--dry-run]`, below. Profiles on another model are also picked up by the worker. |

**Core push behaviour** (`CoreServices/backend/services/skillEmbeddingSync.js`):
- fully in the background; the save never waits for it;
- ordered per user (a promise chain);
- 3 attempts (0, 1 s, 4 s), retrying on network errors, 5xx, 408 and 429;
- a final failure is a **warning** in `error_logs` (module `embeddings-sync`);
- the profile save always succeeds regardless.

**No backfill:** there is deliberately no script for existing users.

## Why there are no weights and no profile vector

- **The matching module compares skills one by one** (required skill against each of the user's skills). An averaged profile vector would blur distinct skills together. For example, "React" plus "Accounting" averages into a vector close to neither, which hides exactly the matches the module needs.
- **Source isn't a signal of strength.** A skill listed on a CV isn't stronger or weaker than one added by hand or found on GitHub. Strength will come from the assessment module, so every skill counts equally here.
- **Enforced in code and tests:** the stored record has exactly the fields shown above (a test asserts the field set and that no weight, vector, average or mean field exists), and `source` is never read by a calculation.

## Re-embedding after a model change

`AIServices/scripts/reembed_all.py`, run with the AIServices venv:
1. Collects every key in `skill_vectors` (under any model) plus every key in `user_skill_profiles`.
2. Embeds only the keys missing for the **current** `EMBEDDING_MODEL`, in batches of 256.
3. Marks each user profile whose keys are all available as using the current model.
- `--dry-run` reports the counts and writes nothing.
- Old-model vectors stay in place but are never read for the new model, because every lookup filters by model. **Vectors of different models are never mixed.** It is safe to run twice (the second run embeds nothing).

## Offline setup

- The first start downloads the model into `EMBEDDING_CACHE_DIR`.
- Every later start loads it with `local_files_only=True`, so **no network is needed**. This was verified with `HF_HUB_OFFLINE=1`: the load succeeded in 0.4 s.
- For an offline server, start AIServices once while online, or copy the `models/` folder over.
- `HF_HOME` and `SENTENCE_TRANSFORMERS_HOME` aren't needed, because the cache folder is passed to the loader directly. If they're set, `EMBEDDING_CACHE_DIR` still wins for this model.
- Setting `HF_HUB_OFFLINE=1` forbids any download attempt; the load then fails fast and is retried if the model isn't cached.

## Environment variables (AIServices `.env.example`)

| Variable | Default | Purpose |
|---|---|---|
| `EMBEDDING_MODEL` | `sentence-transformers/all-MiniLM-L6-v2` | Model name; stored with every vector |
| `EMBEDDING_CACHE_DIR` | `./models` | Model cache folder (git-ignored) |
| `EMBEDDING_AUTOLOAD` | `true` | `false` skips loading at startup (the tests use a fake embedder) |
| `EMBEDDING_WORKER_INTERVAL_SECONDS` | `30` | How often pending embeddings are completed |

Core uses the existing `AI_SERVICE_URL` and `INTERNAL_API_KEY`. The test-only `EMBEDDING_SYNC_RETRY_DELAYS_MS` overrides the retry delays.

## API

**Internal** (X-Internal-Key; `/internal/*` is blocked at the gateway):

| Method | Path | Body / result |
|---|---|---|
| PUT | `/internal/embeddings/users/{user_id}` | Body `{ skills: [{ name, source: manual\|cv\|github }], requestedAt }`. Returns 200 `{ updated: true, skills_count, embedding_status: "done" }`, or 200 `{ updated: false }` when unchanged, or 202 with `embedding_status: "pending"` while the model loads. An empty list deletes the record. Invalid input → 422 `VALIDATION_ERROR`. |
| DELETE | `/internal/embeddings/users/{user_id}` | `{ deleted: true\|false }` |

**User-facing** (JWT, via the gateway at `/api/embeddings`, global rate limit only). The user always comes from the token, so nobody can read another user's data:

| Method | Path | Result |
|---|---|---|
| GET | `/api/embeddings/me` | `{ status: "ready" \| "pending" \| "none", skills_count, model, updated_at }` |
| GET | `/api/embeddings/me/map` | `{ points: [{ name, x, y, source }], closestPairs: [{ a, b, similarity }], model, skills_count }` |
| GET | `/api/embeddings/health` | `{ state, model, dimension, loadSeconds, error }` |

**How the map is computed:**
- `points` come from PCA via numpy SVD (no new dependency) of the user's skill vectors, each axis scaled to −1…1.
- `closestPairs` are the top 3 pairs by cosine similarity computed on the **full 384-dimensional vectors**, rounded to 2 decimals.
- The map needs only stored vectors, so it works even while the model is reloading.

**Map errors:**
- fewer than 3 skills → 400 `NOT_ENOUGH_SKILLS` "Add at least 3 skills to see your skill map.";
- vectors pending → 503 `EMBEDDINGS_PENDING`;
- vectors pending and the model not loaded → 503 `MODEL_LOADING`.

The frontend's `apiErrors` explicitly ignores these two 503 codes: no logout and no global notice.

## UI

A **"Skill embeddings"** card appears on the **CV parsing page** (review and success steps) and the **Account / profile page**:
- **Card:** status (Ready, Processing, or Not yet created), number of skills embedded, model name and last update. "Not yet created" explains: "Embeddings are created when you add or update your skills."
- **Skill map:**
  - a Recharts `ScatterChart`, with every point labelled by its skill name and coloured by source with a legend;
  - a hover tooltip showing name and source;
  - a hidden text list of all points for screen readers.
- **Closest pairs:** the 3 closest pairs, with similarity values.
- **Helper text:** "Related skills appear closer together. Positions are an approximate 2D view; similarity values are exact."
- **States:**
  - `NOT_ENOUGH_SKILLS` shows a message;
  - `EMBEDDINGS_PENDING` and `MODEL_LOADING` show a friendly message, retry automatically every 4 s for up to 30 s, and offer a "Check again" button.

**Colours** come from the data-viz reference palette, slots 1–3, in a fixed order: manual = blue `#2a78d6`, cv = orange `#eb6834`, github = aqua `#1baf7a`.
- They passed the palette validator in all-pairs scatter mode (worst CVD ΔE 9.2, normal-vision ΔE 24.0).
- The validator warns that aqua is below 3:1 contrast on the light surface. This is covered because every point has a visible text label, so identity never depends on colour alone.
- Legend text uses the normal text colour, not the series colour.

**New frontend dependency:** `recharts@^3.10.1`.

## Tests

| Suite | Before | After | New coverage |
|---|---|---|---|
| AIServices pytest | 187 + 1 skipped | **236 passed, 1 skipped, 1 deselected (slow)** | `test_embeddings.py` (49). **Normalisation:** ReactJS/react.js/React share one key; an alias alone is stored under its canonical name; JS → JavaScript and the other aliases; whitespace and case; unknown skills keep their spelling. **Embedder:** 384-dim, unit length, float32, deterministic; the real model can't load in unit tests. **Cache:** a second request embeds nothing; concurrent inserts don't error; other-model vectors are ignored. **Parse:** `skills_canonical` set and status done; model not ready → pending → done after the worker; an embedding failure → `failed` while the parse still succeeds. **User profiles:** stored fields with no weight or vector; an unchanged hash does no work; dedupe by key with the first source winning; an empty list deletes; DELETE and its key check; 202/pending then completed; latest request wins; matrix order. **API:** `/me` statuses; `/me/map` with fewer than 3 skills, MODEL_LOADING, EMBEDDINGS_PENDING; points and closestPairs checked against the full-vector cosine; one user never sees another's data; health. **Re-embed script:** dry run writes nothing; a real run updates the model without mixing and is idempotent. |
| AI slow test (`pytest -m slow`) | – | **1 passed** | Real model: cosine(React, Next.js) > cosine(React, Accounting); unit length, 384 dimensions |
| CoreServices Jest | 210 | **220** | `skillEmbeddingSync.test.js`: merge order and hash; wizard save, CV import and GitHub import push the merged skills with sources and the internal key; summary-only and same-skill saves don't push; the merge endpoint pushes nothing; pushes stay in order; AI returning 503 or unreachable → 3 attempts, a warning, and the save still succeeds; admin delete → DELETE. |
| API Gateway Jest | 42 | **46** | `/api/embeddings/*` is proxied to AIServices (not Core); `/internal/embeddings/*` stays blocked |
| Frontend node --test | 24 | **25** | `EMBEDDINGS_PENDING` / `MODEL_LOADING` 503s never log out or raise a notice |
| Frontend Vitest | 16 | **20** | Card: Ready with count, model, labelled scatter points, legend and the pairs list; Not yet created with its explanation and NOT_ENOUGH_SKILLS; pending → automatic retry → map; MODEL_LOADING retries stop after the limit |

**Unit tests never download the model.**
- An autouse fixture installs a deterministic hash-based `FakeEmbedder` and makes `ModelManager.load_sync` fail for any test not marked `slow`.
- `pytest.ini` deselects `slow` by default.
- `EMBEDDING_AUTOLOAD=false` in the test environment.

**Core tests never reach a real AIServices.** `tests/helpers.js` points `AI_SERVICE_URL` at a closed port, and the sync tests start their own stub server. This stops tests from writing into a developer's running `ai_db`.

**Live check** (UI :5175 → gateway :8180 → Core :3100 / AI :8100, real model): **15 of 16 passed.** The one failure was in the check script: Recharts splits "Machine Learning" into two word `<tspan>`s, so the label's `textContent` reads "MachineLearning". The label displays correctly (screenshot reviewed).
1. A new test user's profile page showed "Not yet created" and NOT_ENOUGH_SKILLS.
2. In the Profile Builder, adding "ReactJS, Next.js, Docker, Accounting, Python, Machine Learning" and saving returned 200 in **53 ms**. `user_skill_profiles` reached `done` **156 ms** after the save. "ReactJS" was stored as `React` / `react` / `manual`, with no weight or vector fields. `skill_vectors` held 6 unit-length 384-dim vectors.
3. A summary-only save left `requested_at` unchanged, so AI was not called.
4. The profile page card showed Ready, 6 skills and all-MiniLM-L6-v2; the map had a labelled point per skill. The 3 closest pairs from the real model were Python ↔ Machine Learning 0.36, React ↔ Next.js 0.29, Accounting ↔ Python 0.29. `GET /me/map` took **31 ms**.
5. Admin delete returned 200; the `user_skill_profiles` record and the Core profile were gone.
6. **Parse-time check:** uploading the sample CV, the parse took 776 ms. The record held the canonical skills and `embedding_status: done` 879 ms after the request, so the embedding finished about 100 ms after the response.
7. All test users, profiles, parse records, logs, uploaded files and the skill vectors these runs created were removed afterwards. `skill_vectors` and `user_skill_profiles` are empty again, with their unique indexes in place.

## SDS updates needed

**Module 2 FE-4 / FE-5:**
> **FE-4:** After a CV is parsed, its skill names are normalised to canonical names (alias list) and each distinct skill is embedded with sentence-transformers all-MiniLM-L6-v2 into a 384-dim, L2-normalised vector. Vectors are cached in `ai_db.skill_vectors` (one per skill and model) and created in the background; the parse record shows `embedding_status` (pending, done, failed).
>
> **FE-5:** Whenever a user's profile skills change, CoreServices sends the merged skill list to AIServices, which stores it in `ai_db.user_skill_profiles` (linked to the user by `user_id`, database-per-service) and ensures every skill has a vector. Every skill keeps its own vector: there is no averaged profile vector and no weighting by source.

**§3.5 (data design):** replace the FAISS "Skill Embeddings Schema" with the two collections above:
- `skill_vectors {key, name, vector[384], model, created_at}`, unique on (key, model);
- `user_skill_profiles {user_id, skills[{name, key, source}], skills_hash, model, embedding_status, requested_at, updated_at}`;
- plus `skills_canonical` and `embedding_status` on `cv_parsed_data`.

Note that FAISS is not used: vectors are compared skill by skill with numpy.

**CON-8 wording:**
> "Skill embeddings are generated with the open-source sentence-transformers model all-MiniLM-L6-v2 (384 dimensions) running locally on CPU, with no external API. The model is downloaded once and then used offline. One vector is stored per distinct skill per model; vectors from different models are never mixed."

**State diagram 3.17:** inside **Processing**, add the sub-state **"Generating embeddings"** after text extraction and entity extraction. It runs in the background after the CV reaches Parsed and doesn't block the transition; its outcome is recorded as `embedding_status` (pending → done | failed).

**Event "Skill Embedding Recalculation" (FR-B9):**
> Trigger: a profile write whose merged skill set (hash of the lowercased, sorted skill keys) differs from before.
> Action: CoreServices pushes the merged skills to AIServices in the background (ordered per user, retried, a warning on final failure; the save never waits). AIServices stores the skill list and embeds only the skills not yet cached.
> Also: the account is deleted → the record is removed; the model changes → `reembed_all.py`.

**Table 4.2 (technologies):** add **sentence-transformers 6.1.0** (model all-MiniLM-L6-v2) with **PyTorch 2.14.1 (CPU build)** and transformers 5.19.0 in AIServices, and **Recharts 3** in the frontend.

## Notes

- **Python 3.14, not 3.11:** the AIServices venv is Python 3.14.4, and 3.11 isn't installed on this machine, so the packages are pinned for 3.14 (approved).
- **`requirements.txt`** now carries `--extra-index-url https://download.pytorch.org/whl/cpu` so `pip install -r` gets the CPU build of torch (about 1 GB instead of several).
- **Existing code:** the .doc/LibreOffice handling and other unrelated code were not touched. The only change to existing parser code is that the skill extractor's output is now canonical, and the parse route records the embedding status.
