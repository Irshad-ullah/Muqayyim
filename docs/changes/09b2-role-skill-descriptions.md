# 09b2 — Role-skill description coverage and benchmark v3 (ESCO skills)

**Status:** implemented (Parts 1–4) · **Date:** 2026-10-15 · **Affects:** AIServices data files, the ESCO label cleaner, the role-skill index build, matching configuration, evaluation tooling
**Builds on:** [09b — profession database and role-skill index](09b-professions-and-index.md), [09a2 — bge-small + descriptions, threshold 0.73](09a2-embedding-model-selection.md)

## Summary

- **Why:** after 09b, only 12 % of the 1,441 distinct role skills had a curated description. Undescribed skills are embedded by bare name, which is outside the conditions the 0.73 related threshold was measured under (bge-small, "Name: description" text).
- **Part 1** measured coverage three ways and grouped the undescribed skills into tools, ESCO phrases and knowledge areas.
- **Part 2** described or aliased **every tool / language / product role skill** (138 found):
  - 108 new curated skills;
  - aliases on 11 existing skills;
  - exact-label maps for ambiguous names.
  - **Result:** O*NET coverage went from 80.0 % to **99.4 %** of occurrences. ESCO **essential** coverage barely moved (4.7 % → 5.1 %), because ESCO's essential skills are phrases and knowledge areas. That is the subject of Part 3.
- **Fixes:**
  - The **index build** crashed when stored role-skill names went stale after an alias change. It now re-normalises them.
  - An **intermittent test failure** was traced to a non-deterministic test stub and fixed.
- **Part 3 (benchmark v3):** ESCO skills are best embedded by **label only**. ESCO descriptions hurt and stay disabled.
- **Part 4:** there is **one related threshold, 0.73, for every pair**. A proposed 0.61 threshold for "mixed" pairs was rejected after a real-data check: at 0.61 an unrelated chef profile received as much related credit as a web profile. Pairs now report their *kind*, and Module 5's credit rule is documented, with mutual_nn required only for described pairs. A background-credit regression check was added.
- **The embedding configuration is frozen until Module 5's end-to-end evaluation** (see [Embedding configuration (frozen)](#embedding-configuration-frozen)).

## Part 1 — Coverage (measured before any change)

The coverage script is `AIServices/eval/role_skill_coverage.py`. It is read-only and reports on the active professions. A skill counts as "described" if the current description chain (the curated file) has a description for it.

| | Distinct role skills described | Occurrences (profession × skill) described | Key occurrences described |
|---|---|---|---|
| ESCO | 6.9 % of 1,313 | 18.9 % of 6,762 | essential: **4.7 %** of 2,595 |
| O*NET | 69.6 % of 171 | 80.0 % of 874 | hot or in-demand: 80.0 % of 874 (every O*NET role skill is hot or in demand by import rule) |
| Overall | 12.0 % of 1,441 | 25.9 % of 7,636 | — |

### Groups of undescribed skills (1,268)

| Group | Rule | Count | Examples |
|---|---|---|---|
| **tool** (language, product, platform) | every O*NET / manual role skill; ESCO *knowledge* that starts with a capital, has ≤ 4 words (ignoring a "(…)" qualifier) and contains no generic word (management, methodologies, principles, legislation, standards, models, techniques, systems, design, …) and does not start with ICT / IT / Business / Digital / … | 138 | AJAX, Assembly (computer programming), Common Lisp, SAS language, Visual Basic, APL, VBScript, Microsoft Visual C++, LINQ, SPARQL, Apache Maven |
| **phrase** | ESCO skill type *skill/competence* | 792 | use an application-specific interface, define technical requirements, debug software, implement a virtual private network, integrate system components, design user interface |
| **knowledge** | other ESCO *knowledge* | 338 | computer programming, ICT security legislation, ICT debugging tools, query languages, Agile project management, systems development life-cycle, cloud technologies |

**Known rule misses:** 11 "tool" items are really generic terms. They were left undescribed:
3D lighting, 3D texturing, JavaScript Framework, Open source model, Outsourcing model, CAD software, Operational Data Store, Software development tools, Web application, Web application framework, Web server.

The top 200 undescribed role skills by number of professions are in [Appendix A](#appendix-a--top-200-undescribed-role-skills-before-part-2).

## Part 2 — Curated data for tools, languages and products

**Process:** each of the 138 tool-group skills was first checked against the existing canonical skills and aliases.
- If it was another name for an existing skill, an alias or label-map entry was added.
- Otherwise it got a curated description following the 09a2 style rules (8–20 words, factual, no marketing words, at most 2 other canonical skill names) and a category.
- No existing description was changed, and the 283 benchmark seed entries are untouched.

### Aliases on existing skills (11)

| Label | Now maps to |
|---|---|
| Common Lisp | Lisp |
| Assembly ("Assembly (computer programming)") | Assembly Language |
| SAS language | SAS |
| Visual C++ / Microsoft Visual C++ / MSVC | C++ |
| Oracle Relational Database | Oracle Database |
| Cisco | Cisco Networking |
| Firewall | Firewalls |
| Agile development | Agile |
| Waterfall development / Waterfall model | Waterfall |
| Prototyping development | Prototyping |
| Adobe Photoshop Lightroom / Lightroom | Adobe Lightroom |

### Exact-label maps

These names are too ambiguous to be global aliases: a user typing "Source" or "Salt" must keep their own spelling, and a test checks this.

| File | Label | Name |
|---|---|---|
| `esco_name_map.json` (new) | MDX | Multidimensional Expressions ("MDX" is also Markdown + JSX) |
| | Salt (tools for software configuration management) | SaltStack |
| | RAGE (digital game creation systems) | RAGE Engine |
| | Shiva (digital game creation systems) | ShiVa Engine |
| | Source (digital game creation systems) | Source Engine |
| `onet_name_map.json` | ESRI ArcGIS ArcPy | ArcPy |
| | ESRI ArcGIS Survey 123 | Survey123 |
| | RockWare ArcMap | ArcMap |
| | Geographic information system GIS systems | GIS |

`clean_esco_label()` applies `esco_name_map.json` before stripping qualifiers.

### New curated skills (108)

There are 108 new skills, each with a description, a category and, where useful, aliases (for example Apache Maven → Maven, DB2 → IBM Db2, SSIS → SQL Server Integration Services, Mac OS X → macOS, IIS → Internet Information Services, SVN → Subversion). Grouped by type:

- **Languages and query languages:** AJAX, Smalltalk, OpenEdge ABL, Visual Basic, APL, VBScript, LINQ, N1QL, SPARQL, XQuery, Multidimensional Expressions, JSSS, Vyper.
- **Databases:** Teradata, IBM Db2, Informix, FileMaker, ObjectStore, OpenEdge Database, CA Datacom, MarkLogic, Triplestore, Microsoft Access, Oracle SQL Developer.
- **Data integration and BI:** IBM DataStage, IBM InfoSphere Information Server, Informatica PowerCenter, Oracle Data Integrator, Oracle Warehouse Builder, Pentaho Data Integration, QlikView Expressor, SAP Data Services, SQL Server Integration Services, SQL Server Reporting Services, Alteryx.
- **Servers and middleware:** Tomcat, WildFly, IBM WebSphere, IBM MQ, Oracle WebLogic, Oracle ADF, Internet Information Services.
- **Security tools:** Aircrack-ng, BackBox, BlackArch, Cain and Abel, John the Ripper, Maltego, Nexpose, OWASP ZAP, Samurai Web Testing Framework, WhiteHat Sentinel, THC Hydra, Qualys, MITRE ATT&CK, eMASS.
- **Game engines:** CryEngine, Frostbite, GameMaker, GameSalad, Havok Vision, HeroEngine, Project Anarchy, RAGE Engine, ShiVa Engine, Source Engine.
- **Design and 3D:** GIMP, SketchBook Pro, Synfig, Capture One, Maya, Adobe Creative Cloud.
- **GIS and engineering:** ArcGIS, ArcPy, ArcMap, Survey123, QGIS, GIS, Revit, Navisworks, MicroStation.
- **Operating systems and productivity:** Windows, macOS, BlackBerry, Safari, Microsoft Outlook, Microsoft Visio, SharePoint, Google Workspace, Adobe Acrobat.
- **Development tools and process:** Maven, Subversion, KDevelop, Codenvy, Octopus Deploy, SaltStack, STAF, REST Assured, ServiceNow, Rapid Application Development, Spiral Model.
- **Health IT:** Epic EHR, MEDITECH, eClinicalWorks.
- **Other:** SAP R/3, LDAP, BGP, Content Management Systems.

**Description file:** it now has 1,093 entries (985 + 108).

**Checker:** `check_skill_descriptions.py` passes.
- **New "frozen" exception:** `htmx` (an existing entry whose text is unchanged) now names three canonical skills, because AJAX became one. Existing descriptions are never edited, so it is listed in `FROZEN_OVER_LIMIT` and reported as a warning, like over-limit seed entries.

### Re-import, re-embed and index

- Both datasets were re-imported with `publish_import`: O*NET updated 23 professions and ESCO 66, with none added or removed.
- New and changed skills were embedded through the shared cache, replacing their name-only vectors.
- The index was rebuilt: **1,428 distinct role skills.** The count fell from 1,441 because aliased names merged.

### Coverage before → after

| | Distinct described | Occurrences described | Essential (ESCO) / hot or in-demand (O*NET) |
|---|---|---|---|
| ESCO | 6.9 % → **13.4 %** (1,310) | 18.9 % → **30.2 %** | 4.7 % → **5.1 %** |
| O*NET | 69.6 % → **97.0 %** (169) | 80.0 % → **99.4 %** | 80.0 % → **99.4 %** |
| Overall | 12.0 % → **20.2 %** (1,428) | 25.9 % → **38.2 %** | — |

The undescribed skills left: 792 phrases, 337 knowledge areas and the 11 misclassified generic "tools".

### Fix: the index build with stale stored names

- **Problem:** between the two re-imports, ESCO professions still stored "SAS language" (key `sas language`), while normalisation now gives `sas`. The embedding layer returned the vector under `sas`, and the build failed with `KeyError: 'sas language'`.
- **Fix:** the index re-normalises each stored skill name at build time (`role_skills.current_skill`), for the index keys, the sidecar and the state hash. If two stored names now share a key, the profession is listed once with the strongest type.
- **Test:** `test_index_renormalises_stale_stored_keys`.
- **Note:** stored profession documents still carry the old key until their source is re-imported. Alias changes should be followed by a re-import, which `publish_import` handles.

### Known intermittent test failure (found and fixed)

- **Test:** `tests/test_professions.py::test_mutual_nearest_neighbour_flag`, about 1 in 20 runs. It was reproduced on run 9 of a 20× loop.
- **Error:** `AssertionError: assert {'a skill': True, 'b skill': False, 'haskell': False} == {'a skill': True, 'b skill': False}`.
- **Cause:** the test's stub embedder gave skills that aren't in its table a random 8-dimensional vector seeded with Python's `hash()`. That hash is randomised per process (PYTHONHASHSEED), so occasionally "Haskell" landed at ≥ 0.73 to React.
- **Fix:**
  - unknown skills are now seeded from SHA-256, so they are deterministic;
  - their vectors are confined to dimensions the table never uses, which makes them exactly orthogonal to every table skill;
  - `unit()` asserts that table vectors stay out of those dimensions.
- **Verification:** 20/20 professions runs and 5/5 full-suite runs pass after the fix (see [Verification](#verification)).

## Part 3 — Benchmark v3: embedding ESCO phrase and knowledge skills

**Question:** how should an ESCO phrase or knowledge skill be embedded so that it compares fairly with a user's curated skill?

- **The user side** is always "Name: curated description", the production text.
- **The ESCO side** has three options:
  - **(a)** label only (what the index uses today);
  - **(b)** "label: first sentence of the ESCO description" (≤ 25 words);
  - **(c)** "label: full ESCO description" (≤ 60 words).
- **Model:** the production model (`BAAI/bge-small-en-v1.5`).
- **Files:** pairs and code are in `AIServices/eval/embeddings_v3/` (`build_pairs.py` → `pairs.json`; `run_benchmark.py` → `results/results.json` and `results/report.md`).

### The set

**153 hand-labelled pairs** (label 2: 51, label 1: 52, label 0: 50, of which 37 are hard negatives and 13 easy).

- **Split:** stratified by label and negative type, seed 42: **dev 107 / held-out 46**.
- **Review relabels** (applied after the split, so the split is unchanged):
  - p035, Technical Writing vs "provide technical documentation": 2 → 1;
  - p057, React vs "implement front-end website design": 1 → 2.
- **Sensitivity subset:** 15 related pairs whose ESCO *description* names the user skill (e.g. "…such as Selenium", "…Autodesk Maya, Blender"). Every metric is also reported without them.

**Rules fixed before running:**
- **Selection:** the highest **dev** AUC against hard negatives; if two options are within 0.01, the higher dev recall at 95 % precision wins.
- **Threshold:** the chosen option's dev Thr@P95.
- **Guardrail:** ESCO descriptions are enabled, or a second threshold is added, only if, on the **held-out** set, the chosen option's AUC against hard negatives exceeds option (a)'s by ≥ 0.02 **and** its recall at 95 % precision is ≥ 0.90.

### Results

| Option | Split | AUC | **AUC vs hard** | Thr@P95 | Recall@P95 | At 0.73 (precision / recall) |
|---|---|---|---|---|---|---|
| **a** label only | dev | 0.989 | **0.988** | 0.612 | 0.944 | 1.00 / 0.667 |
| | held-out | 0.987 | **0.985** | 0.631 | 0.968 | 1.00 / 0.742 |
| b first sentence | dev | 0.979 | 0.972 | 0.613 | 0.903 | 1.00 / 0.597 |
| | held-out | 0.927 | 0.903 | 0.674 | 0.710 | 1.00 / 0.484 |
| c full description | dev | 0.978 | 0.970 | 0.587 | 0.931 | 1.00 / 0.319 |
| | held-out | 0.920 | 0.892 | 0.672 | 0.613 | 1.00 / 0.355 |

**Sensitivity (without the 15 tool-naming pairs):** the same ordering, and (a) still wins.

| Option | AUC vs hard (dev / held-out) | Recall@P95 (dev / held-out) |
|---|---|---|
| a | 0.986 / 0.983 | 0.934 / 0.963 |
| b | 0.967 / 0.892 | 0.885 / 0.519 |
| c | 0.965 / 0.886 | 0.869 / 0.407 |

Removing those pairs lowers (b) and (c) more than (a). Their small advantage on those pairs came from word overlap.

**Score distributions** (all 153 pairs; mean [min–max]):

| Option | Label 2 | Label 1 | 0 hard | 0 easy |
|---|---|---|---|---|
| a | 0.785 [0.579–0.874] | 0.728 [0.561–0.837] | 0.547 [0.434–0.632] | 0.504 [0.430–0.612] |
| b | 0.761 [0.621–0.893] | 0.696 [0.514–0.835] | 0.550 [0.453–0.716] | 0.478 [0.346–0.580] |
| c | 0.736 [0.526–0.893] | 0.665 [0.512–0.821] | 0.525 [0.435–0.716] | 0.453 [0.354–0.526] |

**Why the descriptions hurt:** ESCO descriptions are long, generic sentences ("Utilise specialised ICT tools to create computer code…", "Apply cloud networking concepts…"). They pull related pairs down (label-1 mean 0.728 → 0.665) and push some hard negatives up. The worst case is Python vs "ICT network routing", at 0.716 under (b) and (c) against 0.606 under (a).

The 15 worst pairs per option are in `results/report.md`. For (a), the worst are related pairs scoring low: Bash vs "administer ICT system" 0.561, REST APIs vs "interfacing techniques" 0.573, Jira vs "use ICT ticketing system" 0.579. The highest hard negatives are Kotlin vs "perform data mining" 0.632 and Docker vs "design graphics" 0.631.

### mutual_nn against the real role-skill index

The 1,428-skill index was rebuilt in memory with each option's ESCO text. For a single user skill, mutual_nn reduces to "the ESCO skill is among the user skill's 10 nearest role skills".

| Option | Related pairs in the index | ≥ dev Thr@P95 | ≥ threshold **and** mutual |
|---|---|---|---|
| a | 103 | 98 | **34** |
| b | 103 | 94 | 20 |
| c | 103 | 96 | 16 |

Requiring mutual_nn removes most true matches to ESCO phrases. Examples: SQL → "use query languages" (0.786), AWS → "develop with cloud services" (0.762), Terraform → "automate cloud tasks" (0.796). A user skill's 10 nearest role skills are mostly other tools (SQL → MySQL, T-SQL, PostgreSQL…), so ESCO phrases rarely make the top 10.

### Decision (rules applied exactly as written)

| Step | Result |
|---|---|
| Dev AUC vs hard | a 0.988 · b 0.972 · c 0.970; only (a) is within 0.01 of the best |
| **Chosen** | **(a) label only**; dev Thr@P95 = **0.612** |
| Held-out confirmation | (a) AUC vs hard 0.985; recall at 95 % precision 0.968; at the dev threshold 0.612, precision 0.968 / recall 0.968 |
| Guardrail (gain over (a) ≥ 0.02 and recall ≥ 0.90) | **not met**: the chosen option *is* (a), so the gain is 0.000 |
| **Outcome** | **ESCO descriptions stay disabled** (`ESCO_DESCRIPTIONS_ENABLED=false`) and **the single 0.73 threshold is kept** |

**What the Part 3 results raised for Module 5** (resolved in Part 4):
1. **At 0.73, mixed pairs are precise but incomplete:** precision 1.00, recall 0.67 (dev) / 0.74 (held-out). On the benchmark, the mixed-pair Thr@P95 was 0.61–0.63.
2. **mutual_nn is a poor filter for ESCO phrase skills:** with (a), it keeps only 34 of 98 related pairs that pass the threshold. It still suits tool-to-tool pairs (React → Python was rejected in 09b).

## Part 4 — Decision and implementation

**Decision: one related threshold, 0.73, for every pair.** The pair *kind* is still reported, because Module 5's credit rule treats the two kinds differently (mutual_nn).

### Why a 0.61 mixed threshold was rejected

A second threshold, 0.61 for mixed pairs, was first proposed and implemented. Benchmark v3 supported it on held-out data: precision 0.968 and recall 0.968, against recall 0.74 at 0.73. It was then checked on the **real** role-skill index before committing, and rejected.

**The benchmark's unrelated pairs were not representative of real ESCO phrases.** They were hand-picked to be clearly from different areas. Real ESCO phrases are mostly generic ICT wording, and with this model almost any described skill scores 0.6–0.7 against them. As a result, 0.61 gives related credit almost regardless of who the user is.

The table shows the share of the 1,140 undescribed role skills that a profile's best skill reaches at each threshold (`background_credit_rate.py --sweep`):

| Threshold | Web profile (React, Python, Docker, Figma) | Chef profile (Cooking, Customer Service, Inventory Management) |
|---|---|---|
| **0.61** | **60.4 %** | **60.8 %** |
| 0.65 | 35.8 % | 27.6 % |
| 0.70 | 13.1 % | 6.8 % |
| **0.73** | **6.0 %** | **2.8 %** |

At 0.61, the chef profile would get related credit for **98 %** of the "artificial intelligence engineer" phrase skills. Its median across ESCO professions would be 66 %, against 71 % for the web profile, so the score would no longer tell the two profiles apart. At 0.73, the chef profile gets 2.8 % and the web profile 6.0 %.

Lesson: a held-out split checks a threshold against the *kind* of pairs in the set, not against the population it will be used on. Hence the background credit check below.

### What was implemented

- **No new setting:** there is no `EMBEDDING_RELATED_THRESHOLD_MIXED`. It was added and then removed from `settings.py`, `.env.example` and the local `.env`.
- **`get_related_threshold(model, mode, kind="described" | "mixed", esco_mode=None)`:**
  - both kinds return the same 0.73, under the existing model / text-mode guard;
  - `mixed` is additionally valid only when ESCO skills are embedded by **label** (`ESCO_DESCRIPTIONS_ENABLED=false`), the setup benchmark v3 measured;
  - an unknown kind raises `ValueError`.
- **`search_related(..., user_names=None)`:**
  - each pair reports `kind` (`mixed` when the user skill has a curated description and the role skill does not; otherwise `described`), plus `threshold`, `similarity`, `mutual_nn`, `roles`;
  - if 0.73 is not valid for mixed pairs in the active setup, those pairs are flagged `mixed_threshold_unmeasured`.
- **Credit rule for Module 5:** documented in `matching_config.py` and below, **not implemented** (no scoring yet).

### Module 5 credit rule (documented only)

For each skill a profession requires:

| Case | Credit |
|---|---|
| Same canonical key as one of the user's skills | **matched, 1.0** |
| Described pair (both described, or neither): similarity ≥ 0.73 **and** mutual_nn | **related, 0.5** |
| Mixed pair (user skill described, role skill an ESCO label): similarity ≥ 0.73, no mutual check | **related, 0.5** |
| Otherwise | **missing, 0** |

There is no "hint" threshold. Whether and how near-misses are shown is part of Module 5's UI work.

### Sample users (real model, real index; temporary users removed)

| User | Pairs found (k = 50) | Described, credited (≥ 0.73 and mutual) | Described, not credited (not mutual) | Mixed, credited (≥ 0.73) |
|---|---|---|---|---|
| React, Python, Docker, Figma | 189 | 33 | 115 | 41 |
| React, Docker, Figma | 143 | 23 | 84 | 36 |

- **Top credited pairs:**
  - React → JavaScript 0.885, CoffeeScript 0.856, Angular 0.848 (described, mutual);
  - Python → Pandas 0.851, Scikit-learn 0.817 (described, mutual);
  - Docker → Kubernetes 0.872, Linux 0.811 (described, mutual);
  - Figma → Adobe XD 0.881 (described, mutual), "design user interface" 0.852 and "use methodologies for user-centered design" 0.848 (mixed).
- **React → Python (user without Python):** described pair, 0.776, `mutual_nn: false`, so **no credit**. Docker → Python (0.748) also gets no credit.

### Background credit rate (regression check)

`AIServices/eval/background_credit_rate.py` scores a web profile and an unrelated chef profile against all 143 active professions with the credit rule above. It is also wrapped as `tests/test_background_credit_rate.py`, marked `slow`; it needs the model and the imported professions.

**It must be run by Module 5's evaluation and for any future threshold or matching change.** It passes when the chef rate is ≤ 5 % **and** at most half the web rate.

| Profile | Related credit (pooled over non-matched required skills: web 7,488, chef 7,562) | Median per profession | Credited via described / mixed | Highest professions |
|---|---|---|---|---|
| Web | **12.2 %** | 10.7 % | 474 / 439 | cloud software developer 37 %, Software Developers 33 %, IoT developer 32 % |
| Chef | **3.0 %** | 2.7 % | 107 / 123 | Health Informatics Specialists 19 %, Clinical Data Managers 19 %, ICT help desk agent 16 % |

The chef / web ratio is **0.25**, so the check passes. Much of the chef's remaining credit is genuine overlap, e.g. Customer Service → "assist customers" 0.828, Inventory Management → "manage inventory" 0.831.

### Known limitation: doubtful credits remaining at 0.73

Mixed pairs have no mutual check, so some vague ESCO phrases are still credited:

| User skill | Role skill (kind) | Similarity |
|---|---|---|
| Docker | resource-efficient technologies (mixed) | 0.779 |
| Docker | field-programmable gate arrays (mixed) | 0.763 |
| Docker | decentralized application frameworks (mixed) | 0.755 |
| Docker | file-based workflow (mixed) | 0.744 |
| Docker | identify software for warehouse management (mixed) | 0.734 |
| Python | field-programmable gate arrays (mixed) | 0.749 |
| Python / Docker | real-time computing (mixed) | 0.760 / 0.733 |
| Cooking | develop food scanner devices (mixed) | 0.732 |
| Cooking | printing techniques (mixed) | 0.730 |
| React | Selenium (described, mutual) | 0.832 |
| Docker | .NET (described, mutual) | 0.788 |

These are left as they are, because the configuration is frozen. Module 5's end-to-end evaluation should measure their effect on profession scores, with the background credit check as the guard.

## Embedding configuration (frozen)

**No further embedding tuning before Module 5's end-to-end evaluation.** Any change needs a new benchmark round, a re-embed, and the background credit check.

| Item | Value |
|---|---|
| Model | `BAAI/bge-small-en-v1.5` (384-dim, CPU, unit vectors, cosine) |
| User / curated skill text | `description`: "Name: curated description" when one exists, else the name (1,093 curated descriptions) |
| ESCO skill text | `label` (`ESCO_DESCRIPTIONS_ENABLED=false`); curated descriptions take precedence where they exist |
| Related threshold | **0.73**, for both pair kinds. Guarded: valid only for the model and user text mode above, and for mixed pairs only with ESCO label text |
| mutual_nn | K = 10; **required only for described ↔ described pairs** |
| Credit rule | same key 1.0; described ≥ 0.73 and mutual 0.5; mixed ≥ 0.73 0.5; else 0 |
| Regression check | `AIServices/eval/background_credit_rate.py` (chef ≤ 5 % and ≤ 0.5 × web) |

## Verification

| Check | Result |
|---|---|
| `check_skill_descriptions.py` | passes (4 warnings: 3 seed, 1 frozen) |
| Benchmark seed entries | unchanged (283) |
| New tests (Part 2) | `tests/test_role_skill_descriptions.py`: 22 alias cases, 7 "ambiguous word is not an alias" cases, 8 ESCO-map and 7 O*NET-map cases, map targets described, frozen exception. `test_index_renormalises_stale_stored_keys` |
| New tests (Part 4) | `get_related_threshold` by kind with guards (other model, name text, ESCO description text) and an unknown kind; `search_related` kind reporting (described ↔ described, mixed, neither described) with one threshold; the `mixed_threshold_unmeasured` flag; `test_background_credit_rate` (slow) |
| Changed test expectations | description count bound ≤ 1,000 → ≤ 1,200; cleaning case "Epic Systems" → Epic EHR (unknown example now "Frobnicator Suite") |
| Flakiness loops | before the fix: 1 failure in 9 runs of the professions tests. After the fix: professions + role-skill tests **20/20** passing (99 tests each), full AI suite **5/5** passing (388 passed, 1 skipped each) |
| Final AI suite (Part 4) | **392 passed, 1 skipped** (4 slow deselected); slow tests (`-m slow`): 2 passed, 2 expected failures (React ↔ Python, Redux ↔ Redis) |

## Suggested SDS updates

**§4.2 — add an "Embedding evaluation" subsection covering three benchmark rounds and the real-data check:**

> "Skill similarity uses BAAI/bge-small-en-v1.5 sentence embeddings (384 dimensions, local CPU). Each skill is embedded on its own; no averaged role or user vectors are used. It was chosen and calibrated in three benchmark rounds on hand-labelled skill pairs.
>
> **Round 1** (245 pairs) compared five models with bare-name and 'Name: description' text. Curated descriptions raised related-vs-unrelated ROC-AUC from about 0.87 to about 0.996.
>
> **Round 2** (337 pairs, including 92 hard negatives: technical skills from different areas such as React–Python) kept bge-small with descriptions: AUC 0.990 against hard negatives, Recall@5 0.720. The related threshold was set at cosine 0.73, the lowest value with at least 95 % precision (94 % recall).
>
> **Round 3** (153 pairs: a curated user skill against an ESCO phrase or knowledge skill; 70 % development / 30 % held-out split) compared three ways of embedding ESCO skills: label only, label with the first sentence of its ESCO description, and label with the full description. Label only was best (held-out AUC 0.985 against hard negatives, against 0.903 and 0.892); ESCO descriptions are therefore not used.
>
> A lower threshold for mixed pairs (0.61, held-out precision and recall 0.968) was rejected after a check on the real profession database. An unrelated profile (cooking, customer service, inventory management) received related credit for 60.8 % of ESCO phrase skills at 0.61, the same as a web developer profile (60.4 %); at 0.73 the rates were 2.8 % and 6.0 %.
>
> **The final configuration is frozen until Module 5's end-to-end evaluation:**
> - one related threshold of 0.73, valid only for this model and text setup;
> - a mutual-nearest-neighbour check (K = 10) for pairs of described skills;
> - credit: identical skill 1.0, related 0.5, otherwise 0.
>
> A background-credit regression check (the unrelated profile's related-credit rate must stay ≤ 5 % and at most half the web profile's) is run for any change to thresholds or matching."

**Table 4.2:** add FAISS (`faiss-cpu`, `IndexFlatIP`) for the role-skill index, if not already added by 09b.

## Appendix A — top 200 undescribed role skills (before Part 2)

| # | Skill | Group | Professions | Source |
|---|---|---|---|---|
| 1 | AJAX | tool | 50 | esco/onet |
| 2 | computer programming | knowledge | 42 | esco |
| 3 | Assembly (computer programming) | tool | 35 | esco |
| 4 | Common Lisp | tool | 35 | esco |
| 5 | OpenEdge Advanced Business Language | tool | 35 | esco |
| 6 | SAP R3 | tool | 35 | esco |
| 7 | SAS language | tool | 35 | esco |
| 8 | Visual Basic | tool | 35 | esco |
| 9 | APL | tool | 34 | esco |
| 10 | VBScript | tool | 34 | esco |
| 11 | Microsoft Visual C++ | tool | 33 | esco |
| 12 | Smalltalk (computer programming) | tool | 29 | esco |
| 13 | ICT security legislation | knowledge | 28 | esco |
| 14 | ICT debugging tools | knowledge | 26 | esco |
| 15 | ICT project management methodologies | knowledge | 26 | esco |
| 16 | resource description framework query language | knowledge | 26 | esco |
| 17 | use an application-specific interface | phrase | 26 | esco |
| 18 | LINQ | tool | 25 | esco |
| 19 | N1QL | tool | 25 | esco |
| 20 | SPARQL | tool | 25 | esco |
| 21 | Apache Maven | tool | 24 | esco/onet |
| 22 | define technical requirements | phrase | 24 | esco |
| 23 | query languages | knowledge | 24 | esco |
| 24 | Agile project management | knowledge | 23 | esco |
| 25 | debug software | phrase | 23 | esco |
| 26 | LDAP | tool | 23 | esco |
| 27 | lean project management | knowledge | 23 | esco |
| 28 | MDX | tool | 23 | esco |
| 29 | Process-based management | knowledge | 23 | esco |
| 30 | systems development life-cycle | knowledge | 23 | esco |
| 31 | XQuery | tool | 23 | esco |
| 32 | cloud technologies | knowledge | 22 | esco |
| 33 | digital systems | knowledge | 22 | esco |
| 34 | implement a virtual private network | phrase | 21 | esco |
| 35 | implement ICT security policies | phrase | 21 | esco |
| 36 | integrate system components | phrase | 21 | esco |
| 37 | manage cloud data and storage | phrase | 21 | esco |
| 38 | build business relationships | phrase | 20 | esco |
| 39 | use scripting programming | phrase | 20 | esco |
| 40 | develop creative ideas | phrase | 18 | esco |
| 41 | develop software prototype | phrase | 18 | esco |
| 42 | interpret technical texts | phrase | 18 | esco |
| 43 | use markup languages | phrase | 18 | esco |
| 44 | utilise computer-aided software engineering tools | phrase | 18 | esco |
| 45 | analyse business requirements | phrase | 17 | esco |
| 46 | analyse software specifications | phrase | 17 | esco |
| 47 | Apache Tomcat | tool | 17 | esco/onet |
| 48 | implement anti-virus software | phrase | 17 | esco |
| 49 | software anomalies | knowledge | 17 | esco |
| 50 | World Wide Web Consortium standards | knowledge | 17 | esco |
| 51 | design user interface | phrase | 16 | esco |
| 52 | implement a firewall | phrase | 16 | esco |
| 53 | Internet of Things | knowledge | 16 | esco |
| 54 | Microsoft Access | tool | 16 | esco/onet |
| 55 | migrate existing data | phrase | 16 | esco |
| 56 | Salt (tools for software configuration management) | tool | 16 | esco |
| 57 | STAF | tool | 16 | esco |
| 58 | tools for software configuration management | knowledge | 16 | esco |
| 59 | use back-up and recovery tools | phrase | 16 | esco |
| 60 | web programming | knowledge | 16 | esco |
| 61 | collect customer feedback on applications | phrase | 15 | esco |
| 62 | copyright legislation | knowledge | 15 | esco |
| 63 | create flowchart diagram | phrase | 15 | esco |
| 64 | execute ICT audits | phrase | 15 | esco |
| 65 | ICT system programming | knowledge | 15 | esco |
| 66 | integrated development environment software | knowledge | 15 | esco |
| 67 | levels of software testing | knowledge | 15 | esco |
| 68 | perform project management | phrase | 15 | esco |
| 69 | security engineering | knowledge | 15 | esco |
| 70 | Adobe Acrobat | tool | 14 | onet |
| 71 | create solutions to problems | phrase | 14 | esco |
| 72 | ICT network security risks | knowledge | 14 | esco |
| 73 | ICT process quality models | knowledge | 14 | esco |
| 74 | ICT security standards | knowledge | 14 | esco |
| 75 | information security strategy | knowledge | 14 | esco |
| 76 | provide ICT consulting advice | phrase | 14 | esco |
| 77 | solve ICT system problems | phrase | 14 | esco |
| 78 | use different communication channels | phrase | 14 | esco |
| 79 | use query languages | phrase | 14 | esco |
| 80 | use software design patterns | phrase | 14 | esco |
| 81 | use software libraries | phrase | 14 | esco |
| 82 | business process modelling | knowledge | 13 | esco |
| 83 | design database in the cloud | phrase | 13 | esco |
| 84 | execute software tests | phrase | 13 | esco |
| 85 | ICT infrastructure | knowledge | 13 | esco |
| 86 | ICT system user requirements | knowledge | 13 | esco |
| 87 | legal requirements of ICT products | knowledge | 13 | esco |
| 88 | Microsoft Visio | tool | 13 | esco/onet |
| 89 | tools for ICT test automation | knowledge | 13 | esco |
| 90 | unstructured data | knowledge | 13 | esco |
| 91 | address problems critically | phrase | 12 | esco |
| 92 | attack vectors | knowledge | 12 | esco |
| 93 | cloud security and compliance | knowledge | 12 | esco |
| 94 | design cloud architecture | phrase | 12 | esco |
| 95 | develop automated migration methods | phrase | 12 | esco |
| 96 | ICT performance analysis methods | knowledge | 12 | esco |
| 97 | KDevelop | tool | 12 | esco |
| 98 | manage IT security compliances | phrase | 12 | esco |
| 99 | manage schedule of tasks | phrase | 12 | esco |
| 100 | monitor system performance | phrase | 12 | esco |
| 101 | object-oriented modelling | knowledge | 12 | esco |
| 102 | organisational resilience | knowledge | 12 | esco |
| 103 | use automatic programming | phrase | 12 | esco |
| 104 | use logic programming | phrase | 12 | esco |
| 105 | use object-oriented programming | phrase | 12 | esco |
| 106 | visual presentation techniques | knowledge | 12 | esco |
| 107 | Apple macOS | tool | 11 | onet |
| 108 | automate cloud tasks | phrase | 11 | esco |
| 109 | cyber attack counter-measures | knowledge | 11 | esco |
| 110 | design database scheme | phrase | 11 | esco |
| 111 | execute analytical mathematical calculations | phrase | 11 | esco |
| 112 | ICT encryption | knowledge | 11 | esco |
| 113 | ICT system integration | knowledge | 11 | esco |
| 114 | information structure | knowledge | 11 | esco |
| 115 | remove computer virus or malware from a computer | phrase | 11 | esco |
| 116 | use concurrent programming | phrase | 11 | esco |
| 117 | use databases | phrase | 11 | esco |
| 118 | use functional programming | phrase | 11 | esco |
| 119 | use technical documentation | phrase | 11 | esco |
| 120 | adapt to changes in technological development plans | phrase | 10 | esco |
| 121 | analyse a script | phrase | 10 | esco |
| 122 | application usability | knowledge | 10 | esco |
| 123 | apply ICT systems theory | phrase | 10 | esco |
| 124 | cloud monitoring and reporting | knowledge | 10 | esco |
| 125 | data models | knowledge | 10 | esco |
| 126 | database development tools | knowledge | 10 | esco |
| 127 | design for organisational complexity | phrase | 10 | esco |
| 128 | design graphics | phrase | 10 | esco |
| 129 | develop with cloud services | phrase | 10 | esco |
| 130 | Firewall | tool | 10 | onet |
| 131 | identify customer requirements | phrase | 10 | esco |
| 132 | identify ICT security risks | phrase | 10 | esco |
| 133 | identify ICT system weaknesses | phrase | 10 | esco |
| 134 | perform data mining | phrase | 10 | esco |
| 135 | provide cost benefit analysis reports | phrase | 10 | esco |
| 136 | Teradata Database | tool | 10 | esco/onet |
| 137 | work ergonomically | phrase | 10 | esco |
| 138 | adapt to artists' creative demands | phrase | 9 | esco |
| 139 | adapt to type of media | phrase | 9 | esco |
| 140 | create data models | phrase | 9 | esco |
| 141 | design process | phrase | 9 | esco |
| 142 | develop digital content | phrase | 9 | esco |
| 143 | edit recorded sound | phrase | 9 | esco |
| 144 | follow work schedule | phrase | 9 | esco |
| 145 | GIMP (graphics editor software) | tool | 9 | esco |
| 146 | graphics editor software | knowledge | 9 | esco |
| 147 | information confidentiality | knowledge | 9 | esco |
| 148 | manage personal professional development | phrase | 9 | esco |
| 149 | Microsoft Outlook | tool | 9 | onet |
| 150 | optimise choice of ICT solution | phrase | 9 | esco |
| 151 | report analysis results | phrase | 9 | esco |
| 152 | service-oriented modelling | knowledge | 9 | esco |
| 153 | software components libraries | knowledge | 9 | esco |
| 154 | systems theory | knowledge | 9 | esco |
| 155 | task algorithmisation | knowledge | 9 | esco |
| 156 | use spreadsheets software | phrase | 9 | esco |
| 157 | 3D lighting | tool | 8 | esco |
| 158 | adapt artistic plan to location | phrase | 8 | esco |
| 159 | Adobe Creative Cloud | tool | 8 | onet |
| 160 | analyse ICT system | phrase | 8 | esco |
| 161 | assess ICT knowledge | phrase | 8 | esco |
| 162 | audit techniques | knowledge | 8 | esco |
| 163 | conduct ICT code review | phrase | 8 | esco |
| 164 | database management systems | knowledge | 8 | esco |
| 165 | DB2 | tool | 8 | esco |
| 166 | develop automated software tests | phrase | 8 | esco |
| 167 | develop ICT test suite | phrase | 8 | esco |
| 168 | do cloud refactoring | phrase | 8 | esco |
| 169 | finish project within budget | phrase | 8 | esco |
| 170 | follow safety procedures when working at heights | phrase | 8 | esco |
| 171 | ICT communications protocols | knowledge | 8 | esco |
| 172 | ICT safety | knowledge | 8 | esco |
| 173 | ICT software specifications | knowledge | 8 | esco |
| 174 | implement cloud security and compliance | phrase | 8 | esco |
| 175 | implement ICT risk management | phrase | 8 | esco |
| 176 | information extraction | knowledge | 8 | esco |
| 177 | interactive media | knowledge | 8 | esco |
| 178 | internet governance | knowledge | 8 | esco |
| 179 | JavaScript Framework | tool | 8 | esco |
| 180 | keep personal administration | phrase | 8 | esco |
| 181 | manage changes in ICT system | phrase | 8 | esco |
| 182 | manage database | phrase | 8 | esco |
| 183 | manage system security | phrase | 8 | esco |
| 184 | multimedia systems | knowledge | 8 | esco |
| 185 | operate 3D computer graphics software | phrase | 8 | esco |
| 186 | perform backups | phrase | 8 | esco |
| 187 | perform ICT security testing | phrase | 8 | esco |
| 188 | perform resource planning | phrase | 8 | esco |
| 189 | provide software testing documentation | phrase | 8 | esco |
| 190 | replicate customer software issues | phrase | 8 | esco |
| 191 | report test findings | phrase | 8 | esco |
| 192 | SketchBook Pro | tool | 8 | esco |
| 193 | Subversion | tool | 8 | onet |
| 194 | Synfig | tool | 8 | esco |
| 195 | translate requirements into visual design | phrase | 8 | esco |
| 196 | use personal protection equipment | phrase | 8 | esco |
| 197 | use presentation software | phrase | 8 | esco |
| 198 | administer ICT system | phrase | 7 | esco |
| 199 | apply 3D imaging techniques | phrase | 7 | esco |
| 200 | apply statistical analysis techniques | phrase | 7 | esco |
