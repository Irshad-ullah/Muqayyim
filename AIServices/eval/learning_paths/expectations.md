# Module 6 — learning paths: evaluation expectations (committed before any run)

**Written:** 2026-10-18, before running the evaluation scripts. Production code, live data (O\*NET + curated roles,
scoring mode exact). Read only, except the shared vector cache.

## Profiles

24 profiles:
- the old 8 (`career_matching/profiles.json`, incl. the chef control);
- the new 6 (`profiles_new.json`, not blind);
- the 10 test CVs (`profiles_testcvs.json`, not blind).

For each profile the path is built for its **best career match** (rank 1), with the default any-of alternative.

## Part 2 — structure (`run_structure_eval.py`): pass mark = every rule holds for **24 / 24** profiles

1. **Module set = missing set.** The module keys equal the role's missing required rows (any-of → the default
   alternative), essential first, cut to 8. `more.count` = the missing count − the module count.
2. **Tiers in order.** No optional module comes before an essential module (no prerequisites given).
3. **Quick wins first.** Inside each tier, every quick-win module (one with a related hint) comes before every module
   without one.
4. **Deterministic.** Building the same path twice gives identical modules and order.
5. **Prerequisites validated.** Synthetic pairs per path (when it has ≥ 2 modules):
   - a valid pair (last → first);
   - its reverse, which would create a cycle;
   - a self-pair;
   - a pair with a skill outside the path.

   Only the valid pair is accepted, with the expected reasons for the others. After the reorder the prerequisite comes
   before its dependant, and no module is added or lost.

## Part 3 — enrichment (fake provider; `tests/test_learning_enrich.py`)

6. **0 URLs** from the LLM reach a stored path: any output containing a URL is rejected; links are built only by our
   code ("Find on {platform}" search URLs).
7. **Module set = missing set** in the enrichment (the output must cover exactly the path's modules).
8. **Hours** within 2–80 per module and ≤ 400 in total; **platforms** only from the allowlist (YouTube, Coursera,
   Udemy, freeCodeCamp, edX, official docs).

## Part 7 — manual check

9. **5 paths** built with the real Gemini client and checked by hand: the recommendations are real (they can be found
   on the platform with the generated search link) and relevant to the skill. Recorded in TEST_LOG, with each
   recommendation marked real / not found and relevant / not relevant. No pass mark is set in advance for this
   qualitative check; the counts are reported.
10. **👍 rate:** collected later from users (not measured now).
