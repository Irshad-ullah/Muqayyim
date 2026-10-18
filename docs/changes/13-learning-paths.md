# 13 — Module 6: learning paths

**Requirements:** SRS FR7.7 (learning path for the missing skills of a career), FR8.1–FR8.9 (generate, order, describe,
resources, timeline, progress, completion, regenerate, feedback), SI-3.3 (LLM: learning paths) · design: hybrid —
the structure is deterministic, the LLM only describes it · LLM: the shared client of 12 (Google Gemini, free tier,
`gemini-3.5-flash-lite`).

| Part | Content | Commit | Status |
|---|---|---|---|
| 1 | Deterministic structure (AIServices) | `30c38c5` | **done** |
| 2 | Structure evaluation (expectations committed first: `09b19ea`) | `776b6e7` | **done**, 24 / 24 |
| 3 | Enrichment: prompt, schema, validation, search links built by our code | `fdc2bfe` | **done** |
| 4 | Core storage and API; completion → profile → re-match | `c7f9eda` | **done** |
| 5 | UI (list, path page, setup dialog with consent, unverified-skills note) | `4a99a38` | **done** |
| 6 | 👍 / 👎 feedback, "Suggest another resource", the Regenerate banner | `c9daf2f` | **done** |
| 7 | 5 paths with real Gemini, manual review, docs | `72d8368`, `8c3b284` | **done** |
| — | Changes after review: "profile skills" wording (`ff8d29b`); English only (`5666172`); rejection-reason logging (`18e8970`); freeCodeCamp removed (`34f1df8`) | | **done** |

## How a path is built

1. **Structure (AIServices, deterministic, `app/services/learning/structure.py`)** for one career:
   - modules = the role's missing **required** rows (any-of group → the alternative the user chose, default the first);
   - at most **8 modules**, essential first; the rest is reported as "N more skills — create the next path after this
     one";
   - inside each tier, quick wins first (a missing skill with a related hint), then a greedy nearest-neighbour order on
     the skill vectors;
   - prerequisites proposed by the LLM are validated (pair, in the path, not itself, no duplicate, no cycle) and applied
     by a minimal stable reorder;
   - a snapshot (`skills_hash`, `dataset_hash`, scoring mode, `learning-structure@1`) is stored with the path.
2. **Paths are built from profile skills only** (CV, profile, GitHub). Skills added by completing modules ("learning"
   skills) are left out, so completing a module never removes it from its path and never marks the path stale. The
   word "verified" is reserved for Module 7 (skill verification).
3. **Enrichment (LLM, `app/services/learning/enrich.py`, prompts `learning_path@v3`, `learning_more@v3`):** per module
   why, 3–6 sub-topics, a practice project, estimated hours and 2–4 resources. Sent: the role title, the module skill
   names, the user's skill names and the cost preference — nothing else. Validation (all in the schema, one corrective
   retry, then the path is saved **without** enrichment):
   - no URL, web address or domain anywhere — links are built by our code ("Find on {platform}" search URLs);
   - platforms: YouTube, Coursera, Udemy, edX, Official docs;
   - hours 2–80 per module, min ≤ max, total ≤ 400;
   - the modules must equal the path's modules (validation context).
   Labels: every resource "AI recommendation" (paid: "AI recommendation, check before buying"); hours "estimated".
4. **Core (`learningPathController.js`, collection `learningpaths`):** one path per career, at most 5 per user;
   creating, regenerating and "Suggest another resource" need the current AI consent (version `2026-10-18`, the notice
   adds "your skills and learning preferences, to build learning paths").
   - **Completing a module** adds the skill to the profile as a learning skill (`skills.learning`), shown as
     "completed in your learning path (not verified)"; it counts in the match % and Career Matches says "includes N
     unverified skills". Undoing removes it. A module whose skill is already a learning skill starts completed in a new
     path.
   - **Regenerate:** `GET /:id/freshness` compares the snapshot with AIServices' current hashes; the banner says what
     changed. Regenerating keeps the saved choices, the progress of modules that stay, and the feedback.
   - **Feedback:** one 👍 / 👎 per resource (changeable, removable). **More:** new titles only, up to 10 per module.

## Preferences: English only

Preferences are **free only / include paid** and **hours per week** (for the timeline). The Urdu-Hindi option was
removed (`5666172`): in the Part 7 run the Urdu-Hindi path (Data Analyst) was rejected by validation on both attempts
and was saved without enrichment, while the English paths passed. Language was removed from the UI, the Core
validation and model, the schema and the prompts (v2); the cache key is the prompt text, so it no longer varies by
language. The rejected path was dropped from the review set and Data Analyst was generated again in English.

## Rejection-reason logging (`18e8970`)

When a JSON answer fails validation, the shared LLM client logs and stores **only the names of the failed checks**,
never the content, as `llm_usage.reject_reason`: `not_json`, `url_found`, `hours_out_of_range`, `module_set_mismatch`
or `schema` (anything else, e.g. a platform outside the list). On an ok call after the corrective retry, the field
holds the reasons of the replaced answer. The Urdu-Hindi rejection happened before this logging existed, so its reason
is not recorded; the re-generated English path passed on the first attempt (no rejection).

## Evaluation

- **Structure (rules 1–5, `AIServices/eval/learning_paths/run_structure_eval.py`):** 24 / 24 profiles pass every rule.
- **Enrichment rules 6–8:** covered by `tests/test_learning_enrich.py` (fake provider).
- **Manual review (rule 9), 2026-10-18** — `AIServices/eval/learning_paths/manual_review.csv`, summary
  `results/manual_review_summary.md` (`summarise_manual_review.py`):
  - **sample:** 23 recommendations from 5 paths (DevOps Engineer, Android Developer, Data Analyst, UI/UX Designer,
    Backend Developer), built from 5 test-CV profiles with real Gemini, English, "include paid"; 8 Gemini calls in
    total for the run (incl. the dropped Urdu-Hindi path and one corrective retry);
  - **reviewers:** project team members (roles only; the reviewer column was left empty, so who reviewed which row is
    not recorded);

  | Scope | Exists | Relevant | Hours plausible |
  |---|---|---|---|
  | All 23 | 19 / 23 (82.6 %) | 20 / 23 (87.0 %) | not recorded |
  | DevOps Engineer (3) | 2 / 3 | 2 / 3 | not recorded |
  | Android Developer (4) | 4 / 4 | 4 / 4 | not recorded |
  | UI/UX Designer (6) | 5 / 6 | 6 / 6 | not recorded |
  | Backend Developer (4) | 3 / 4 | 3 / 4 | not recorded |
  | Data Analyst (6) | 5 / 6 | 5 / 6 | not recorded |
  | **Without the 2 freeCodeCamp rows (21)** | **19 / 21 (90.5 %)** | **20 / 21 (95.2 %)** | not recorded |

  - **freeCodeCamp was removed** from the platforms (`34f1df8`, prompts v3) because both freeCodeCamp recommendations
    were marked not found and not relevant: the freeCodeCamp search links did not work.
  - The "hours plausible" column was left empty by the reviewers: not recorded.
- **👍 rate (rule 10):** collected from users later.

## Limitations

- **Small sample:** 23 recommendations from 5 paths, each path 1–3 modules (the test CVs already hold most skills of
  these roles); the percentages are indicative, not a measured accuracy.
- **Recommendations depend on the LLM's knowledge:** resources published or renamed after the model's knowledge cutoff
  are missing, and listed ones may have been removed since. The search link lets the user check each one.
- **Hours are estimates** from the LLM, labelled "estimated", and were not checked in the review.
- The review was done by the project team, not by independent learners.
