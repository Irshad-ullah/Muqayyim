# 09b2 — Role-skill description coverage and benchmark v3 (ESCO skills)

**Status:** Part 2 implemented; Part 3 (benchmark v3) in progress · **Date:** 2026-10-15 · **Affects:** AIServices data files, the ESCO label cleaner, the role-skill index build, evaluation tooling
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
- **The embedding configuration is frozen after this task** (see [Freeze](#embedding-configuration-freeze)).

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

*(Pair set built; results pending review of the sample pairs.)*

- **Question:** how should an ESCO phrase or knowledge skill be embedded so that it compares fairly with a user's curated skill?
- **The user side** is always "Name: curated description".
- **The ESCO side** has three options:
  - **(a)** label only;
  - **(b)** "label: first sentence of the ESCO description" (≤ 25 words);
  - **(c)** "label: full ESCO description" (≤ 60 words).

**Set:** `AIServices/eval/embeddings_v3/pairs.json`, built and validated by `build_pairs.py`. It has **153 hand-labelled pairs**:

| Label | Count | Notes |
|---|---|---|
| 2 (strongly related) | 51 | |
| 1 (related) | 52 | |
| 0 (unrelated) | 50 | 37 hard negatives (technical skills from different areas), 13 easy |

- **Split:** stratified by label and negative type, seed 42. **Dev 107** (36 / 36 / 26 hard / 9 easy) and **held-out 46** (15 / 16 / 11 hard / 4 easy).
- **Selection rule (fixed before running):** the highest AUC against hard negatives on the dev set; if two options are within 0.01, the higher recall at 95 % precision wins. The threshold is chosen on dev; held-out only confirms.
- **Guardrail:** ESCO descriptions are enabled, or a second threshold added, **only if** the chosen option improves AUC against hard negatives by **≥ 0.02 over option (a) on the held-out set** and keeps **≥ 90 % recall at 95 % precision**. Otherwise the current single threshold stays.

## Embedding configuration freeze

After this task, the embedding configuration (model, text mode, description sources and related threshold or thresholds) is **frozen**. Later work (Module 5 matching, the admin page) uses it as is. Any change needs a new benchmark round and a re-embed.

## Verification

| Check | Result |
|---|---|
| `check_skill_descriptions.py` | passes (4 warnings: 3 seed, 1 frozen) |
| Benchmark seed entries | unchanged (283) |
| New tests | `tests/test_role_skill_descriptions.py`: 22 alias cases, 7 "ambiguous word is not an alias" cases, 8 ESCO-map and 7 O*NET-map cases, map targets described, frozen exception. `test_index_renormalises_stale_stored_keys` |
| Changed test expectations | description count bound ≤ 1,000 → ≤ 1,200; cleaning case "Epic Systems" → Epic EHR (unknown example now "Frobnicator Suite") |
| Flakiness loops | before the fix: 1 failure in 9 runs of the professions tests (the test above). After the fix: professions + role-skill tests **20/20** passing (99 tests each), full AI suite **5/5** passing (388 passed, 1 skipped each) |

## Suggested SDS updates

*(Added after Part 3.)*

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
