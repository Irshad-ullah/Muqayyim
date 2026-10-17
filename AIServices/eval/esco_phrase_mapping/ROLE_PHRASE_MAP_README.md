# Role-aware ESCO phrase → skill mapping (Module 5.1, sandbox)

**Sandbox only.** Nothing here changes production code, data or scoring, and nothing is adopted. Earlier work is set
aside, not deleted:
- the upper-bound check;
- variant 1's phrase → skill calibration (`results/calibration_to_label.csv`);
- variant 2's category labelling (`results/category_calibration_to_label.csv`).

## The question

ESCO roles require ability phrases ("deploy cloud resource", "use programming languages") that users never list as
such. Today a phrase without a curated description earns at most a related credit (0.5).

Can a mapping from (role, phrase) to named skills fix this? The mapping must be role-aware, so the same phrase can map
to different tools in different roles. The scoring rule to test is: a required ESCO phrase counts as held (1.0) when
the user has any mapped skill; otherwise the current rule applies.

## Method: AI-assisted, role-aware, conservative

- **Scope.** Every pair of an active ESCO role and one of its essential phrases that has no curated description:
  **2,160 pairs** (100 roles, 749 distinct phrases). These are the same phrases as in variants 1 and 2.
- **Who mapped it.** The assistant (Claude) wrote the mapping in `build_role_phrase_map.py`. It used only the phrase,
  the role title and the existing skill vocabulary: the 1,093 curated canonical names in
  `app/data/skill_descriptions.json`. **No eval profile file was opened** (`profiles.json`, `results.json` or the
  reports).
  - Limitation: the same assistant wrote the 6 new profiles just before the mapping (committed first in `0680b8f`). So
    for those 6 the mapping is not blind to the profiles' skills. The 8 earlier profiles were not looked at during this
    work.
- **The rule.** For each pair, list 0–8 skills whose use clearly demonstrates that ability in that role.
  - **Role-aware.** The same phrase can map differently. For example, "computer programming" maps to Kotlin, Swift,
    Java and Dart for mobile roles, Python and C++ for computer vision, C, C++, Rust and Assembly for embedded roles, and
    Solidity, Rust and Go for blockchain. "Integrated development environment software" maps to Android Studio and Xcode
    for mobile roles. Browser DevTools counts as a debugging tool only for web roles.
  - **Conservative.** These stay empty:
    - generic and soft phrases (communicate, think abstractly, teamwork, follow a brief);
    - managerial, legal, artistic, research-process and strategy phrases;
    - knowledge-only phrases with no tool that clearly shows them (principles of animation, blockchain history);
    - phrases where the vocabulary has no fitting tool (TOGAF, BPMN, IDA Pro, Intune and PBX systems are not in it).
  - **Doubtful skills were left out.** A review pass removed some loose defaults: Browser DevTools outside web roles,
    GraphQL as a database query language, Risk Assessment and Risk Management (generic business skills), Splunk as a
    performance monitor, Visio as process modelling, and Agile or Scrum as evidence of IT project management.
- **Two layers.** `DEFAULT[phrase]` applies in every role that has the phrase. `ROLE[role][phrase]` replaces it for that
  role, and an empty list forces "no mapping". Every skill name is validated against the vocabulary, and the build fails
  on an unknown name.

## Result (`role_phrase_skill_map.json`)

| Measure | Value |
|---|---|
| (role, phrase) pairs | 2,160 |
| Mapped pairs | **846 (39.2 %)** |
| Average skills per mapped pair | **3.0** |
| Distinct phrases mapped | 242 of 749 |
| Role-specific entries (override the default) | 45 |
| Distinct skills used | 350 |
| Roles with at least one mapped phrase | 95 of 100 |

Each entry has `role`, `phrase`, `skills`, a short `reason`, and `source` (`default` / `role`). Empty entries are kept,
so the file covers every pair.

## Spot check (`spot_check.csv`), for the user

40 random non-empty entries (seed 512), from 29 roles, 3 of them role-specific. Fill in `correct`:
- **1** = every mapped skill clearly demonstrates the ability in that role;
- **0** = at least one does not.

Add a word in `notes` for a 0.

## Next (after the spot check)

1. Sandbox evaluation with the rule above on the 8 earlier profiles and the 6 new ones (`../career_matching/profiles_new.json`),
   reported separately. The report covers:
   - top-3 and top-5 hit rates;
   - the DevOps and mobile ranks;
   - the chef's best %;
   - the background credit check;
   - the ESCO share in each top 10;
   - before → after for the 5 roles that change most;
   - the 15 most influential mappings.
2. A comparison with the current production scoring on the same 14 profiles.
3. The spot-check precision.

Nothing is adopted.

## Evaluation (2026-10-17, `evaluate_role_map.py` → `results/role_map_eval.{md,json}`)

The rule is applied by wrapping `scoring.score_profession` in the evaluation process only. Production code, data and
caches are untouched, and the baseline is production scoring in the same run. The baseline reproduces Module 5's
accepted result: old set top-5 6/7, chef 15.0 %.

- **Spot-check precision: 40 / 40 = 100 %** (Wilson 95 % interval 91–100 %). There are no 0-rows, so the variant
  "without 0-rows" does not apply.
- **Blind profiles:** none were supplied (the request still had the template placeholder), so there is no blind set.
- **Background:**
  - The production check is chef 3.2 % vs web 12.9 %: PASS. The mapping does not change related credit.
  - The mapping analogue counts required ESCO rows credited by the map across all ESCO roles: chef 0 / 2,297 = 0 %,
    web 38 / 2,294 = 1.7 %.

| Set | Top-3: baseline → mapping | Top-5: baseline → mapping | Median ESCO-only share in top 10 | Chef best |
|---|---|---|---|---|
| Old 8 (clean test) | 6/7 → **7/7** | 6/7 → **7/7** | 20 % → 30 % | 15.0 % → 15.0 % |
| New 6 (not blind) | 3/6 → 3/6 | 4/6 → **6/6** | 5 % → 25 % | — |

- **DevOps** (old set): first acceptable rank 6 → **3** (cloud DevOps engineer 47.9 %).
- **Mobile** (old set): 3 → 3 (Software Developers). The mobile application developer role moves into rank 5.
- **Android** (new set): 3 → **2**.
- **New set:** cloud engineer 10 → 5 and data engineer 15 → 5.
- **Trade-off (old set):** three profiles that had an acceptable role at rank 1 now have one at rank 2, so top-3 still
  holds. An ESCO role rose just above it each time:
  - web developer: ESCO web designer 60.0 %;
  - data scientist: computer vision engineer 54.7 %;
  - game developer (new set): 3D animator 73.3 %.
- **Most-changed roles (old set):**
  - web developer: 9.6 → 32.7 % mean;
  - database administrator: 6.0 → 19.6 %;
  - web designer: 17.9 → 24.3 %.
- **Most influential mappings:**
  - old set: web designer / markup + front-end design + wireframe; usability and UX research for the UI/UX profile;
    mobile application developer / computer programming;
  - new set: ICT application developer / computer programming; cloud software developer / deploy cloud resource.

Nothing is adopted. The full per-profile tables are in `results/role_map_eval.md`.
