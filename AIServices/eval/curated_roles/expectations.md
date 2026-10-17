# Module 5.2 — curated modern roles vs ESCO: expectations (committed before any run)

**Written:** 2026-10-17, before any evaluation run of setup A or B. Sandbox only: production data, the taxonomy pipeline
and ESCO in production are not changed.

## Setups

- **A — current production:** O\*NET + ESCO with the Module 5.1 role map (any-of groups), live `ai_db`, the persisted
  role-skill index.
- **B — O\*NET + curated roles, ESCO off:** the same O\*NET professions plus the 19 curated roles
  (`AIServices/data/curated/modern_roles_v1.json`, after the reviewer decisions, the skill-key mapping and the O\*NET
  evidence step), in a separate sandbox database with its own role-skill index.
  - Each curated requirement is one requirement. A requirement with several alternatives (`any_of`) is held at 1.0 by
    any one of them, using the Module 5.1 group mechanism.
  - Otherwise the current rules apply unchanged:
    - same key 1.0; related 0.5 by the frozen 0.73 / mutual-NN rule, using the first alternative as the requirement's
      embedded name;
    - the required set = essential, topped up to 10 in stored order;
    - match % = credits ÷ required.

## Pass marks

| Set | Mark |
|---|---|
| Old 8 (`profiles.json`) | top-3 **7/7**, top-5 **7/7**, chef's best match **< 20 %** |
| New 6 (`profiles_new.json`, not blind) | top-5 **≥ 5/6** |
| 10 test CVs (`profiles_testcvs.json`) | top-3 **≥ 8/10**, top-5 **≥ 9/10** |
| Background check (`eval/background_credit_rate.py`) | the chef gets far less credit than the web profile: its existing criterion, chef ≤ 5 % **and** ≤ 0.5 × web (pooled related-credit rate) |
| Vague skills | **0** vague skills in any required set |

**A hit** means the first role in the ranking whose title (any merged source) is in the profile's acceptable list
falls within the top 3 / top 5. This is the rule `run_eval.py` uses.

**Vague** (fixed definition): a required skill counts as **named** when it resolves to our skill list (a curated name,
or a name the alias table resolves to one), or when it is a requirement group whose alternatives are named skills
(Module 5.1 group or a curated `any_of`). Any other required skill is **vague**: an ESCO label phrase with no named
alternative, such as "think analytically". The validator's VAGUE-prefix pattern ("use …", "manage …", "develop …") is
reported alongside.

## Acceptable titles

- **Old 8 and new 6.** In setup A the acceptable lists in the profile files are used unchanged. In setup B, ESCO titles
  do not exist, so each list = its O\*NET titles unchanged + the curated equivalents below. These are fixed now:

| Profile | Curated titles added in B (ESCO titles dropped) |
|---|---|
| web | Frontend Developer, Full-Stack Developer |
| backend | Backend Developer |
| data | Data Analyst, Machine Learning Engineer, AI Engineer (LLM Applications) |
| devops | DevOps Engineer, Cloud Engineer, Site Reliability Engineer |
| mobile | Android Developer, iOS Developer, Cross-Platform Mobile Developer |
| uiux | UI/UX Designer |
| qa | — (no curated QA role; O\*NET Software Quality Assurance Analysts and Testers remains) |
| cloud | Cloud Engineer, DevOps Engineer, Site Reliability Engineer |
| android | Android Developer, Cross-Platform Mobile Developer |
| data_eng | Data Engineer |
| security | — (O\*NET Information Security Analysts remains) |
| gamedev | Game Developer |
| it_support | — (O\*NET support specialists remain) |

- **10 test CVs.** `acceptable_a` / `acceptable_b` in `../career_matching/profiles_testcvs.json` are the expected family
  + the "also acceptable" families of `EXPECTED_MATCHES.md`, written as exact titles. `expected_*` (the expected top
  family alone) is reported as extra information, not as a pass mark. Families with no role in a setup are omitted from
  that setup's list:
  - "statistician" and "graphic designer" exist only in ESCO (A);
  - "security consultant" has no matching role in either setup.
