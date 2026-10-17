# Curated modern IT roles (v1.0.0): method

**Status:** version 1.0.0, adopted in Module 5.2 (2026-10-17): imported through the taxonomy pipeline as source `curated`; it replaces ESCO in career matching. The per-requirement team review (`review.csv`) is still pending.
**Purpose:** replace the ESCO roles in Muqayyim's career matching with a small set of modern IT roles that O*NET
does not cover specifically. Every requirement is a concrete, learnable tool or practice (needed for matching and
for Module 6 learning paths).

## 1. Which roles were included
A role was included only if:
1. no O*NET IT occupation covers it specifically (it may be a specialisation of one; its closest O*NET code is in
   `related_onet_code`), and
2. there is a published role roadmap or an official curriculum for it, and it appears in industry job data.

19 roles, in 6 families: Web (Frontend, Backend, Full-Stack, WordPress), Mobile (Android, iOS, Cross-Platform),
Cloud and Infrastructure (DevOps, Cloud, SRE, DevSecOps), Data and AI (Data Engineer, Data Analyst, ML Engineer,
MLOps, AI Engineer), Design and Product (UI/UX Designer, Product Manager), Games (Game Developer).

**Considered and left out:** Embedded/IoT engineer, AR/VR developer, computer vision and NLP engineer (no
independent role source; CV/NLP are covered as skills of ML Engineer); network engineer, QA engineer, software
architect, blockchain engineer, data scientist, technical writer, BI analyst (O*NET already has these).

## 2. Evidence for each skill (computed by script, not chosen by hand)
| Code | Source | What counts |
|---|---|---|
| R | roadmap.sh role roadmaps, github.com/kamranahmedse/developer-roadmap (commit 2584fbd) | the skill is a topic in **that role's** roadmap; every topic id is checked against the repository |
| S | Stack Overflow Developer Survey 2025, professional developers | technology used by >= 10% |
| P | Qureos, "Most In-Demand Tech Jobs in Pakistan" | skill listed for that role |
| C | official certification or curriculum | AZ-400 (Microsoft), Professional ML Engineer v4.0 (Google Cloud), Google UX Design and Google Data Analytics certificates, Apple Develop in Swift, Google SRE book |
| O | O*NET technology skills of the related occupation | computed locally from `software_skills.csv`; **applied 2026-10-17** (`eval/curated_roles/add_onet_evidence.py`) |

**Rule:** a requirement is `essential` when it has evidence from >= 2 different source types, otherwise `optional`.
Skills with no evidence at all were removed (e.g. Git for WordPress/Game Developer, Figma for Product Manager).

## 3. Alternatives
Where a job uses one of several equivalent tools, they form a single requirement satisfied by any member
(`any_of`), e.g. `React / Angular`, `AWS / Azure / Google Cloud`, `Jenkins / GitHub Actions / GitLab CI`.
This matches the any-of credit already used in matching (Module 5.1) and avoids penalising someone for
knowing only one of two competing tools.

## 4. Known limitations (state these honestly in the report)
- Selection of roles and candidate skills was AI-assisted; evidence tagging and the essential rule are mechanical.
- roadmap.sh is community-maintained and lists alternatives; it shows relevance, not frequency.
- The SO survey measures general popularity, so niche roles (iOS, Android, Game Developer, Product Manager) get
  fewer `essential` skills until O*NET evidence (O) is added. Product Manager and Game Developer have the weakest
  evidence and need the closest review.
- The Pakistan source is a career guide, not a statistical survey.
- Skills must still be mapped to Muqayyim skill keys; unknown skills must be added to the skill list (with aliases)
  or dropped.

## 5. Files
- `modern_roles_v1.json`: the dataset (roles, requirements, any_of, evidence, roadmap topic ids, sources)
- `review.csv`: one row per requirement for team review (fill `reviewer_decision`: keep / drop / change)
- `validate_modern_roles.py`: structural checks (8-15 requirements, evidence present, no vague phrases, O*NET code
  format, optional check against the skill list)
- `build/`: scripts and roadmap topic snapshots used to generate the dataset (reproducible)

## Sources
- roadmap.sh: https://github.com/kamranahmedse/developer-roadmap
- Stack Overflow Developer Survey 2025, Technology: https://survey.stackoverflow.co/2025/technology/
- Qureos, Most In-Demand Tech Jobs in Pakistan: https://qureos.com/career-guide/in-demand-tech-jobs-in-pakistan
- Microsoft AZ-400 study guide: https://learn.microsoft.com/en-us/credentials/certifications/resources/study-guides/az-400
- Google Cloud Professional ML Engineer exam guide v4.0: https://services.google.com/fh/files/misc/professional_machine_learning_engineer_new_exam_guide_english_v4.0.pdf
- Google UX Design Certificate: https://www.coursera.org/professional-certificates/google-ux-design
- Google Data Analytics Certificate: https://www.coursera.org/professional-certificates/google-data-analytics
- Apple Develop in Swift curriculum guide: https://www.apple.com/education/docs/develop-in-swift-curriculum-guide.pdf
- Google SRE book: https://sre.google/sre-book/table-of-contents/
