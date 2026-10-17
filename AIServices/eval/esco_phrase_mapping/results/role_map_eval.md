# Module 5.1 — role-aware phrase mapping: sandbox evaluation

Rule: a required ESCO phrase counts as held (1.0) if the user has any skill mapped to that (role, phrase); otherwise the production rule. Baseline = production scoring, same run, same index. Sandbox only — nothing adopted.

**Spot-check precision:** 40 / 40 = **100%** (Wilson 95 % interval 91%–100%); 0-rows: none — at or above 90 %, so no 'without 0-rows' variant.

**Background credit check** (production, related credit; the mapping does not change related credit): chef 3.2 % vs web 12.9 % — PASS. Mapping analogue (required ESCO rows credited by the map, all active ESCO roles): chef 0 / 2297 = 0.0 %, web 38 / 2294 = 1.66 %.

## Old 8 — clean test (not seen while mapping)

| | Production baseline | With mapping |
|---|---|---|
| Top-3 hit rate | 6 / 7 | 7 / 7 |
| Top-5 hit rate | 6 / 7 | 7 / 7 |
| Median ESCO-only share in the top 10 | 20% | 30% |
| Chef control: best | 15.0 % (Computer Systems Analysts) | 15.0 % (Computer Systems Analysts) |

| Profile | First acceptable rank: baseline → mapping | Score of that role | Best result (mapping) | ESCO-only in top 10 |
|---|---|---|---|---|
| Web developer | 1 → **2** | 58.3 % Web and Digital Interface Designers → 58.3 % Web and Digital Interface Designers | 60.0 % web designer | 20% → 30% |
| Backend Python developer | 2 → **2** | 41.7 % Software Developers → 41.7 % Software Developers | 45.0 % Blockchain Engineers | 10% → 20% |
| Data scientist | 1 → **2** | 50.0 % Data Scientists → 50.0 % Data Scientists | 54.7 % computer vision engineer | 40% → 50% |
| DevOps engineer **(DevOps)** | 6 → **3** | 41.2 % Network and Computer Systems Administrators → 47.9 % cloud DevOps engineer | 59.1 % Computer Systems Engineers/Architects | 30% → 30% |
| Mobile developer **(mobile)** | 3 → **3** | 23.3 % Software Developers → 23.3 % Software Developers | 29.2 % Software Quality Assurance Analysts and Testers | 0% → 20% |
| UI/UX designer | 1 → **1** | 58.3 % Web and Digital Interface Designers → 58.3 % Web and Digital Interface Designers | 58.3 % Web and Digital Interface Designers | 50% → 80% |
| QA tester | 1 → **1** | 41.7 % Software Quality Assurance Analysts and Testers → 41.7 % Software Quality Assurance Analysts and Testers | 41.7 % Software Quality Assurance Analysts and Testers | 20% → 50% |
| Chef (non-IT control) (control) | — | — | 15.0 % Computer Systems Analysts | 40% → 40% |

**Top 5 with the mapping** (ESCO-only roles marked E, acceptable roles ✓):

- Web developer: 1. web designer 60.0 % E; 2. Web and Digital Interface Designers 58.3 % ✓; 3. Software Developers 40.0 %; 4. Blockchain Engineers 40.0 %; 5. web developer 38.5 % ✓
- Backend Python developer: 1. Blockchain Engineers 45.0 %; 2. Software Developers 41.7 % ✓; 3. Computer Systems Engineers/Architects 40.9 %; 4. Web Developers 38.3 %; 5. Software Quality Assurance Analysts and Testers 37.5 %
- Data scientist: 1. computer vision engineer 54.7 % E; 2. Data Scientists 50.0 % ✓; 3. Health Informatics Specialists 45.5 %; 4. Data Warehousing Specialists 45.0 %; 5. artificial intelligence engineer 41.9 % E ✓
- DevOps engineer: 1. Computer Systems Engineers/Architects 59.1 %; 2. Information Security Engineers 53.8 %; 3. cloud DevOps engineer 47.9 % E ✓; 4. cloud software developer 47.5 % E; 5. Computer and Information Research Scientists 46.6 %
- Mobile developer: 1. Software Quality Assurance Analysts and Testers 29.2 %; 2. Blockchain Engineers 25.0 %; 3. Software Developers 23.3 % ✓; 4. Computer Systems Engineers/Architects 22.7 %; 5. mobile application developer 22.2 % E ✓
- UI/UX designer: 1. Web and Digital Interface Designers 58.3 % ✓; 2. web designer 55.0 % E ✓; 3. user interface designer 53.7 % E ✓; 4. user interface developer 47.1 % E; 5. user experience analyst 41.7 % E ✓
- QA tester: 1. Software Quality Assurance Analysts and Testers 41.7 % ✓; 2. ICT test analyst 40.0 % E ✓; 3. Computer Systems Analysts 35.0 %; 4. ICT integration tester 31.8 % E; 5. Blockchain Engineers 30.0 %
- Chef (non-IT control): 1. Computer Systems Analysts 15.0 %; 2. Document Management Specialists 15.0 %; 3. ICT help desk agent 15.0 % E; 4. Business Intelligence Analysts 14.3 %; 5. Health Informatics Specialists 13.6 %

**Most-changed roles** (mean score over the group's IT profiles):

| Role | Before → after | Mean gain | Largest gain for one profile |
|---|---|---|---|
| web developer | 9.6 → 32.7 % | +23.1 | +38.5 |
| database administrator | 6.0 → 19.6 % | +13.6 | +35.7 |
| web designer | 17.9 → 24.3 % | +6.4 | +20.0 |
| user interface developer | 10.5 → 16.0 % | +5.5 | +17.7 |
| webmaster | 8.4 → 13.3 % | +4.9 | +10.9 |

**Most influential mappings** (score points added in the profiles' top 10, summed):

| Role | Phrase | Via user skill(s) | Points | Profiles |
|---|---|---|---|---|
| web designer | use markup languages | HTML | 10.0 | uiux, web |
| web designer | implement front-end website design | CSS, HTML, JavaScript, React, Tailwind CSS | 10.0 | uiux, web |
| web designer | create website wireframe | Adobe XD, Figma, Sketch | 10.0 | uiux |
| ICT usability tester | conduct research interview | User Research | 5.9 | uiux |
| ICT usability tester | execute ICT user research activities | User Research | 5.9 | uiux |
| ICT usability tester | create website wireframe | Adobe XD, Figma, Sketch | 5.9 | uiux |
| user interface developer | World Wide Web Consortium standards | CSS, HTML | 5.9 | uiux, web |
| user interface developer | style sheet languages | CSS | 5.9 | uiux, web |
| user interface developer | use software libraries | React | 5.9 | web |
| mobile application developer | computer programming | Dart, Flutter, Kotlin, Swift | 5.6 | mobile |
| mobile application developer | use software libraries | Firebase | 5.6 | mobile |
| user experience analyst | conduct research interview | User Research | 5.6 | uiux |
| user experience analyst | execute ICT user research activities | User Research | 5.6 | uiux |
| ICT test analyst | develop ICT test suite | Cypress, Selenium | 5.0 | qa |
| ICT test analyst | execute software tests | Cypress, Manual Testing, Postman, Selenium | 5.0 | qa |

## New 6 — NOT blind (written by the mapper)

| | Production baseline | With mapping |
|---|---|---|
| Top-3 hit rate | 3 / 6 | 3 / 6 |
| Top-5 hit rate | 4 / 6 | 6 / 6 |
| Median ESCO-only share in the top 10 | 5% | 25% |

| Profile | First acceptable rank: baseline → mapping | Score of that role | Best result (mapping) | ESCO-only in top 10 |
|---|---|---|---|---|
| Cloud engineer | 10 → **5** | 37.5 % cloud software developer → 47.5 % cloud software developer | 63.6 % Computer Systems Engineers/Architects | 10% → 30% |
| Android developer **(mobile)** | 3 → **2** | 26.7 % Software Developers → 33.3 % mobile application developer | 35.4 % Software Quality Assurance Analysts and Testers | 0% → 40% |
| Data engineer | 15 → **5** | 30.0 % Data Warehousing Specialists → 43.5 % data engineer | 53.8 % Database Architects | 0% → 20% |
| Security analyst | 4 → **4** | 38.5 % Information Security Analysts → 38.5 % Information Security Analysts | 50.0 % Penetration Testers | 10% → 20% |
| Game developer | 1 → **2** | 60.0 % Video Game Designers → 60.0 % Video Game Designers | 73.3 % 3D animator | 40% → 60% |
| IT support | 1 → **1** | 75.0 % Computer Network Support Specialists → 75.0 % Computer Network Support Specialists | 75.0 % Computer Network Support Specialists | 0% → 0% |

**Top 5 with the mapping** (ESCO-only roles marked E, acceptable roles ✓):

- Cloud engineer: 1. Computer Systems Engineers/Architects 63.6 %; 2. Information Security Engineers 61.5 %; 3. Computer Network Architects 53.8 %; 4. Computer and Information Research Scientists 48.3 %; 5. cloud software developer 47.5 % E ✓
- Android developer: 1. Software Quality Assurance Analysts and Testers 35.4 %; 2. mobile application developer 33.3 % E ✓; 3. Blockchain Engineers 30.0 %; 4. industrial mobile devices software developer 28.9 % E ✓; 5. Software Developers 26.7 % ✓
- Data engineer: 1. Database Architects 53.8 %; 2. Computer and Information Research Scientists 46.6 %; 3. Database Administrators 46.6 %; 4. cloud software developer 45.0 % E; 5. data engineer 43.5 % E ✓
- Security analyst: 1. Penetration Testers 50.0 %; 2. Digital Forensics Analysts 45.0 %; 3. Information Security Engineers 42.3 %; 4. Information Security Analysts 38.5 % ✓; 5. Computer Network Architects 34.6 %
- Game developer: 1. 3D animator 73.3 % E; 2. Video Game Designers 60.0 % ✓; 3. 3D modeller 59.4 % E; 4. digital games developer 44.7 % E ✓; 5. embedded systems software developer 28.1 % E
- IT support: 1. Computer Network Support Specialists 75.0 % ✓; 2. Computer User Support Specialists 62.5 % ✓; 3. Information Technology Project Managers 45.0 %; 4. Network and Computer Systems Administrators 44.1 %; 5. Computer Network Architects 38.5 %

**Most-changed roles** (mean score over the group's IT profiles):

| Role | Before → after | Mean gain | Largest gain for one profile |
|---|---|---|---|
| web developer | 0.0 → 15.4 % | +15.4 | +15.4 |
| ICT application developer | 12.2 → 17.7 % | +5.5 | +11.8 |
| 3D animator | 6.7 → 12.2 % | +5.5 | +33.3 |
| cloud software developer | 25.4 → 30.8 % | +5.4 | +10.0 |
| ICT system developer | 10.0 → 15.4 % | +5.4 | +12.5 |

**Most influential mappings** (score points added in the profiles' top 10, summed):

| Role | Phrase | Via user skill(s) | Points | Profiles |
|---|---|---|---|---|
| ICT application developer | computer programming | C#, C++, Java, Kotlin | 8.8 | android, gamedev |
| cloud software developer | deploy cloud resource | AWS, Microsoft Azure, Terraform | 7.5 | cloud, data_eng |
| ICT application configurator | computer programming | Java, Kotlin | 5.9 | android |
| ICT application developer | integrated development environment software | Android Studio, Visual Studio | 5.9 | android, gamedev |
| ICT application developer | tools for software configuration management | Git | 5.9 | android, gamedev |
| mobile application developer | computer programming | Java, Kotlin | 5.6 | android |
| mobile application developer | use software libraries | Firebase, Retrofit | 5.6 | android |
| industrial mobile devices software developer | computer programming | Java, Kotlin | 5.3 | android |
| ICT system developer | ICT system programming | C++ | 5.0 | gamedev |
| cloud architect | cloud technologies | AWS, Microsoft Azure | 5.0 | cloud |
| cloud architect | deploy cloud resource | AWS, Microsoft Azure, Terraform | 5.0 | cloud |
| cloud software developer | cloud technologies | AWS, Microsoft Azure | 5.0 | cloud, data_eng |
| cloud software developer | develop with cloud services | AWS, Microsoft Azure | 5.0 | cloud, data_eng |
| cyber incident responder | ethical hacking principles | Kali Linux, Metasploit | 4.3 | security |
| data engineer | use data processing techniques | Apache Spark | 4.3 | data_eng |

