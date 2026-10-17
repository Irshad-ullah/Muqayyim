# Module 5.2 — curated modern roles instead of ESCO (sandbox)

**Sandbox only.** Production data, the taxonomy pipeline and ESCO in production are unchanged. Setup B ran in a separate
sandbox database that was dropped afterwards; `ai_db` was only read. The pass marks were committed first, in
`expectations.md` (`db6e480`).

| Step | Script / file | Result |
|---|---|---|
| Reviewer decisions (`review.csv`) | — | none filled in, so nothing applied (232 rows, `reviewer_decision` empty) |
| Skill keys | `map_skill_keys.py` → `results/skill_key_map.csv`, `results/skill_keys.txt` | 277 `any_of` entries: 222 mapped, 6 via alias, **49 not in the skill list (45 distinct)**; proposals in `results/missing_skills_proposals.csv` (nothing added) |
| Validator before O | `data/curated/validate_modern_roles.py` + `results/skill_keys.txt` → `results/validator_before_O.txt` | **0 errors**; 51 warnings (49 not in the skill list; Product Manager and Game Developer have < 3 essential) |
| O\*NET evidence | `add_onet_evidence.py` → `data/curated/modern_roles_v1.json`, `review.csv`, `results/onet_evidence_changes.csv` | O added to **103 / 232** requirements; **35** importance changes, all optional → essential; essential 105 → 140 |
| Validator after O | → `results/validator_after_O.txt` | **0 errors**; 49 warnings (not in the skill list only; the weak-evidence warnings are gone) |
| A vs B | `compare_setups.py` → `results/compare_setups.{md,json}` | see below |

## A vs B (pass marks from `expectations.md`)

| Mark | A: O\*NET + ESCO (map) | B: O\*NET + curated |
|---|---|---|
| Old 8: top-3 7/7, top-5 7/7 | 7/7 · 7/7 PASS | 7/7 · 7/7 PASS |
| Chef best < 20 % | 15.0 % PASS | 15.0 % PASS |
| New 6: top-5 ≥ 5/6 | 6/6 PASS (top-3 3/6) | 6/6 PASS (top-3 5/6) |
| 10 test CVs: top-3 ≥ 8, top-5 ≥ 9 | 10/10 · 10/10 PASS | 10/10 · 10/10 PASS |
| Test CVs: expected family at #1 / in top 3 (info) | 4 · 8 | **7 · 10** |
| Background: chef ≤ 5 % and ≤ 0.5 × web | 3.2 % vs 12.9 % PASS | **5.5 % vs 20.3 % FAIL** (ratio 0.27 passes; the absolute 5 % fails) |
| 0 vague required skills | **1,319 vague FAIL** | 0 PASS |
| Active roles | 130 (100 ESCO + 30 O\*NET) | 49 (19 curated + 30 O\*NET) |

**Why B fails the background check.** The failure comes from the unchanged O\*NET roles, which ESCO had been diluting.
In production, the chef's pooled related-credit rate is 5.3 % on O\*NET roles alone and 2.9 % on ESCO roles. ESCO's
~2,300 label phrases, where the chef earns almost nothing, kept the combined rate at 3.2 %. Without them, B's
denominator is O\*NET and curated tool rows. The Module 5 odd credits (e.g. Cooking → Microsoft Word, Inventory
Management → SAS) then weigh more. The chef's best match is still 15.0 % in both setups.

**Other observations.**
- **B scores are much higher.** Curated roles reach 85–100 % for well-matched CVs (Frontend Developer 100 % for CV 01).
  Cross-family scores rise too: Data Engineer, Android Developer and DevOps Engineer each reach 55 % for the Java backend
  CV. With 8–15 requirements per role and any-of alternatives, a few shared tools move a curated score a lot.
- **11 any-of skills in B are not in our skill list.** They come from 24 curated required items and are matched only by
  their exact text until they are mapped (see the proposals).
- **Curated requirement keys.** Two requirements in one role can share a key once alternatives are resolved. The run
  reports any requirements collapsed by de-duplication (none in this dataset version).

## Limits
- The curated roles and candidate skills were AI-assisted (`METHOD.md`).
- The new 6 profiles are not blind.
- The test-CV acceptable titles were written by the assistant from `EXPECTED_MATCHES.md` and committed before the run.
- The samples are small: 7 + 6 + 10 profiles.
