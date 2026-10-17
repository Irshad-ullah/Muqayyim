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
