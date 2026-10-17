# Module 5.2 — setup A (O*NET + ESCO with the map) vs B (O*NET + curated roles, ESCO off)

Sandbox run (`compare_setups.py`); pass marks fixed beforehand in `expectations.md`. Production data unchanged; setup B ran in a separate, dropped sandbox database.

## Pass marks

| Mark | A | B |
|---|---|---|
| old8 top-3 7/7 | PASS | PASS |
| old8 top-5 7/7 | PASS | PASS |
| chef best < 20 % | PASS | PASS |
| new6 top-5 >= 5/6 | PASS | PASS |
| testcvs top-3 >= 8/10 | PASS | PASS |
| testcvs top-5 >= 9/10 | PASS | PASS |
| background check | PASS | FAIL |
| 0 vague required skills | FAIL | PASS |

| | A | B |
|---|---|---|
| Old 8: top-3 / top-5 | 7/7 · 7/7 | 7/7 · 7/7 |
| New 6: top-3 / top-5 | 3/6 · 6/6 | 5/6 · 6/6 |
| 10 test CVs: top-3 / top-5 | 10/10 · 10/10 | 10/10 · 10/10 |
| Chef best | 15.0 % (Computer Systems Analysts) | 15.0 % (Computer Systems Analysts) |
| Test CVs: expected family at #1 / in top 3 | 4 · 8 | 7 · 10 |
| Background (A) | chef 3.2 % vs web 12.9 % | PASS |
| Background (B) | chef 5.5 % vs web 20.3 % | FAIL |

## Roles and required skills

**A:** 130 active roles {'esco': 100, 'onet': 30}; required skills by kind:
- esco | named (group / any-of): 846
- esco | named (in skill list): 132
- esco | vague (ESCO phrase, no named alternative): 1319
- onet | named (in skill list): 486
- onet | named tool, not in skill list: 5
- required items matching the validator's vague-prefix pattern: {'esco': 547}

**B:** 49 active roles {'curated': 19, 'onet': 30}; required skills by kind:
- curated | named (group / any-of): 30
- curated | named (in skill list): 139
- curated | named tool, not in skill list: 24
- onet | named (in skill list): 486
- onet | named tool, not in skill list: 5
- required items matching the validator's vague-prefix pattern: {}

## Top 5 per profile (✓ = acceptable)

### Old 8

| Profile | Setup | First acceptable | Top 5 |
|---|---|---|---|
| Web developer | A | 2 | 1. web designer [ESCO] 60.0 %; 2. Web and Digital Interface Designers [O*NET] 58.3 % ✓; 3. Software Developers [ESCO+O*NET] 40.0 %; 4. Blockchain Engineers [O*NET] 40.0 %; 5. web developer [ESCO+O*NET] 38.5 % ✓ |
| Web developer | B | 1 | 1. Frontend Developer [Curated] 83.3 % ✓; 2. Full-Stack Developer [Curated] 65.4 % ✓; 3. Web and Digital Interface Designers [O*NET] 62.5 % ✓; 4. WordPress Developer [Curated] 45.0 %; 5. Software Developers [O*NET] 43.3 % |
| Backend Python developer | A | 2 | 1. Blockchain Engineers [O*NET] 45.0 %; 2. Software Developers [ESCO+O*NET] 41.7 % ✓; 3. Computer Systems Engineers/Architects [O*NET] 40.9 %; 4. Web Developers [ESCO+O*NET] 38.3 %; 5. Software Quality Assurance Analysts and Testers [O*NET] 37.5 % |
| Backend Python developer | B | 1 | 1. Backend Developer [Curated] 75.0 % ✓; 2. DevOps Engineer [Curated] 65.0 %; 3. Data Engineer [Curated] 55.0 %; 4. Full-Stack Developer [Curated] 53.8 %; 5. Cloud Engineer [Curated] 50.0 % |
| Data scientist | A | 2 | 1. computer vision engineer [ESCO] 54.7 %; 2. Data Scientists [ESCO+O*NET] 50.0 % ✓; 3. Health Informatics Specialists [O*NET] 45.5 %; 4. Data Warehousing Specialists [O*NET] 45.0 %; 5. artificial intelligence engineer [ESCO] 41.9 % ✓ |
| Data scientist | B | 1 | 1. Machine Learning Engineer [Curated] 80.0 % ✓; 2. Data Analyst [Curated] 80.0 % ✓; 3. Data Scientists [O*NET] 54.8 % ✓; 4. Data Warehousing Specialists [O*NET] 50.0 %; 5. Health Informatics Specialists [O*NET] 50.0 % |
| DevOps engineer | A | 3 | 1. Computer Systems Engineers/Architects [O*NET] 59.1 %; 2. Information Security Engineers [O*NET] 53.8 %; 3. cloud DevOps engineer [ESCO] 47.9 % ✓; 4. cloud software developer [ESCO] 47.5 %; 5. Computer and Information Research Scientists [O*NET] 46.6 % |
| DevOps engineer | B | 1 | 1. DevOps Engineer [Curated] 100.0 % ✓; 2. Cloud Engineer [Curated] 75.0 % ✓; 3. Site Reliability Engineer [Curated] 70.0 % ✓; 4. MLOps Engineer [Curated] 65.0 %; 5. Computer Systems Engineers/Architects [O*NET] 63.6 % |
| Mobile developer | A | 3 | 1. Software Quality Assurance Analysts and Testers [O*NET] 29.2 %; 2. Blockchain Engineers [O*NET] 25.0 %; 3. Software Developers [ESCO+O*NET] 23.3 % ✓; 4. Computer Systems Engineers/Architects [O*NET] 22.7 %; 5. mobile application developer [ESCO] 22.2 % ✓ |
| Mobile developer | B | 1 | 1. Cross-Platform Mobile Developer [Curated] 60.0 % ✓; 2. Android Developer [Curated] 50.0 % ✓; 3. iOS Developer [Curated] 45.0 % ✓; 4. Frontend Developer [Curated] 33.3 %; 5. Software Quality Assurance Analysts and Testers [O*NET] 29.2 % |
| UI/UX designer | A | 1 | 1. Web and Digital Interface Designers [O*NET] 58.3 % ✓; 2. web designer [ESCO] 55.0 % ✓; 3. user interface designer [ESCO] 53.7 % ✓; 4. user interface developer [ESCO] 47.1 %; 5. user experience analyst [ESCO] 41.7 % ✓ |
| UI/UX designer | B | 1 | 1. UI/UX Designer [Curated] 65.0 % ✓; 2. Web and Digital Interface Designers [O*NET] 58.3 % ✓; 3. WordPress Developer [Curated] 35.0 %; 4. Video Game Designers [O*NET] 35.0 %; 5. Frontend Developer [Curated] 33.3 % |
| QA tester | A | 1 | 1. Software Quality Assurance Analysts and Testers [O*NET] 41.7 % ✓; 2. ICT test analyst [ESCO] 40.0 % ✓; 3. Computer Systems Analysts [O*NET] 35.0 %; 4. ICT integration tester [ESCO] 31.8 %; 5. Blockchain Engineers [O*NET] 30.0 % |
| QA tester | B | 1 | 1. Software Quality Assurance Analysts and Testers [O*NET] 45.8 % ✓; 2. Backend Developer [Curated] 45.0 %; 3. Computer Systems Analysts [O*NET] 40.0 %; 4. Data Analyst [Curated] 35.0 %; 5. Information Technology Project Managers [O*NET] 35.0 % |
| Chef (non-IT control) | A | — | 1. Computer Systems Analysts [O*NET] 15.0 %; 2. Document Management Specialists [O*NET] 15.0 %; 3. ICT help desk agent [ESCO] 15.0 %; 4. Business Intelligence Analysts [O*NET] 14.3 %; 5. Health Informatics Specialists [O*NET] 13.6 % |
| Chef (non-IT control) | B | — | 1. Computer Systems Analysts [O*NET] 15.0 %; 2. Document Management Specialists [O*NET] 15.0 %; 3. Product Manager (Software) [Curated] 15.0 %; 4. Business Intelligence Analysts [O*NET] 14.3 %; 5. Health Informatics Specialists [O*NET] 13.6 % |

### New 6 (not blind)

| Profile | Setup | First acceptable | Top 5 |
|---|---|---|---|
| Cloud engineer | A | 5 | 1. Computer Systems Engineers/Architects [O*NET] 63.6 %; 2. Information Security Engineers [O*NET] 61.5 %; 3. Computer Network Architects [O*NET] 53.8 %; 4. Computer and Information Research Scientists [O*NET] 48.3 %; 5. cloud software developer [ESCO] 47.5 % ✓ |
| Cloud engineer | B | 1 | 1. DevOps Engineer [Curated] 85.0 % ✓; 2. Cloud Engineer [Curated] 80.0 % ✓; 3. Computer Systems Engineers/Architects [O*NET] 65.9 %; 4. Information Security Engineers [O*NET] 61.5 %; 5. Site Reliability Engineer [Curated] 60.0 % ✓ |
| Android developer | A | 2 | 1. Software Quality Assurance Analysts and Testers [O*NET] 35.4 %; 2. mobile application developer [ESCO] 33.3 % ✓; 3. Blockchain Engineers [O*NET] 30.0 %; 4. industrial mobile devices software developer [ESCO] 28.9 % ✓; 5. Software Developers [ESCO+O*NET] 26.7 % ✓ |
| Android developer | B | 1 | 1. Android Developer [Curated] 75.0 % ✓; 2. Cross-Platform Mobile Developer [Curated] 50.0 % ✓; 3. Software Quality Assurance Analysts and Testers [O*NET] 39.6 %; 4. Backend Developer [Curated] 35.0 %; 5. Blockchain Engineers [O*NET] 35.0 % |
| Data engineer | A | 5 | 1. Database Architects [O*NET] 53.8 %; 2. Computer and Information Research Scientists [O*NET] 46.6 %; 3. Database Administrators [ESCO+O*NET] 46.6 %; 4. cloud software developer [ESCO] 45.0 %; 5. data engineer [ESCO] 43.5 % ✓ |
| Data engineer | B | 1 | 1. Data Engineer [Curated] 95.0 % ✓; 2. Cloud Engineer [Curated] 65.0 %; 3. Database Architects [O*NET] 57.7 %; 4. Backend Developer [Curated] 55.0 %; 5. MLOps Engineer [Curated] 55.0 % |
| Security analyst | A | 4 | 1. Penetration Testers [O*NET] 50.0 %; 2. Digital Forensics Analysts [O*NET] 45.0 %; 3. Information Security Engineers [O*NET] 42.3 %; 4. Information Security Analysts [O*NET] 38.5 % ✓; 5. Computer Network Architects [O*NET] 34.6 % |
| Security analyst | B | 4 | 1. Penetration Testers [O*NET] 57.1 %; 2. Digital Forensics Analysts [O*NET] 55.0 %; 3. Site Reliability Engineer [Curated] 55.0 %; 4. Information Security Analysts [O*NET] 50.0 % ✓; 5. Information Security Engineers [O*NET] 50.0 % |
| Game developer | A | 2 | 1. 3D animator [ESCO] 73.3 %; 2. Video Game Designers [O*NET] 60.0 % ✓; 3. 3D modeller [ESCO] 59.4 %; 4. digital games developer [ESCO] 44.7 % ✓; 5. embedded systems software developer [ESCO] 28.1 % |
| Game developer | B | 1 | 1. Video Game Designers [O*NET] 70.0 % ✓; 2. Game Developer [Curated] 50.0 % ✓; 3. Web and Digital Interface Designers [O*NET] 37.5 %; 4. Computer Programmers [O*NET] 34.2 %; 5. Blockchain Engineers [O*NET] 32.5 % |
| IT support | A | 1 | 1. Computer Network Support Specialists [O*NET] 75.0 % ✓; 2. Computer User Support Specialists [O*NET] 62.5 % ✓; 3. Information Technology Project Managers [O*NET] 45.0 %; 4. Network and Computer Systems Administrators [O*NET] 44.1 %; 5. Computer Network Architects [O*NET] 38.5 % |
| IT support | B | 1 | 1. Computer Network Support Specialists [O*NET] 75.0 % ✓; 2. Computer User Support Specialists [O*NET] 62.5 % ✓; 3. Network and Computer Systems Administrators [O*NET] 52.9 %; 4. Information Technology Project Managers [O*NET] 50.0 %; 5. Computer Network Architects [O*NET] 42.3 % |

### 10 test CVs

| Profile | Setup | First acceptable | Top 5 |
|---|---|---|---|
| CV 01 Frontend developer | A | 1 | 1. web designer [ESCO] 75.0 % ✓; 2. Web and Digital Interface Designers [O*NET] 62.5 % ✓; 3. user interface designer [ESCO] 50.0 %; 4. user interface developer [ESCO] 50.0 % ✓; 5. web developer [ESCO+O*NET] 42.3 % ✓ |
| CV 01 Frontend developer | B | 1 | 1. Frontend Developer [Curated] 100.0 % ✓; 2. Web and Digital Interface Designers [O*NET] 70.8 % ✓; 3. Full-Stack Developer [Curated] 65.4 % ✓; 4. Cross-Platform Mobile Developer [Curated] 50.0 %; 5. WordPress Developer [Curated] 45.0 % |
| CV 02 Backend developer (Java) | A | 3 | 1. Software Quality Assurance Analysts and Testers [O*NET] 47.9 %; 2. ICT test analyst [ESCO] 45.0 %; 3. Software Developers [ESCO+O*NET] 43.3 % ✓; 4. Web Developers [ESCO+O*NET] 43.3 % ✓; 5. Database Administrators [ESCO+O*NET] 41.4 % |
| CV 02 Backend developer (Java) | B | 1 | 1. Backend Developer [Curated] 85.0 % ✓; 2. Data Engineer [Curated] 55.0 %; 3. Android Developer [Curated] 55.0 %; 4. DevOps Engineer [Curated] 55.0 %; 5. Software Quality Assurance Analysts and Testers [O*NET] 50.0 % |
| CV 03 Data scientist | A | 1 | 1. Data Scientists [ESCO+O*NET] 54.8 % ✓; 2. Health Informatics Specialists [O*NET] 54.5 %; 3. computer vision engineer [ESCO] 51.6 %; 4. artificial intelligence engineer [ESCO] 46.8 % ✓; 5. Data Warehousing Specialists [O*NET] 45.0 % |
| CV 03 Data scientist | B | 1 | 1. Machine Learning Engineer [Curated] 85.0 % ✓; 2. Data Analyst [Curated] 85.0 % ✓; 3. Data Scientists [O*NET] 59.5 % ✓; 4. Health Informatics Specialists [O*NET] 59.1 %; 5. Data Warehousing Specialists [O*NET] 50.0 % |
| CV 04 DevOps engineer | A | 1 | 1. Computer Systems Engineers/Architects [O*NET] 68.2 % ✓; 2. Information Security Engineers [O*NET] 65.4 %; 3. Computer and Information Research Scientists [O*NET] 60.3 %; 4. cloud software developer [ESCO] 60.0 %; 5. cloud DevOps engineer [ESCO] 56.2 % ✓ |
| CV 04 DevOps engineer | B | 1 | 1. DevOps Engineer [Curated] 95.0 % ✓; 2. Cloud Engineer [Curated] 90.0 % ✓; 3. Site Reliability Engineer [Curated] 85.0 % ✓; 4. Computer Systems Engineers/Architects [O*NET] 70.5 % ✓; 5. MLOps Engineer [Curated] 70.0 % |
| CV 05 Android developer | A | 2 | 1. Software Quality Assurance Analysts and Testers [O*NET] 41.7 %; 2. mobile application developer [ESCO] 36.1 % ✓; 3. industrial mobile devices software developer [ESCO] 31.6 % ✓; 4. Blockchain Engineers [O*NET] 30.0 %; 5. ICT application developer [ESCO] 29.4 % ✓ |
| CV 05 Android developer | B | 1 | 1. Android Developer [Curated] 85.0 % ✓; 2. Cross-Platform Mobile Developer [Curated] 75.0 % ✓; 3. Backend Developer [Curated] 45.0 %; 4. Software Quality Assurance Analysts and Testers [O*NET] 43.8 %; 5. iOS Developer [Curated] 35.0 % |
| CV 06 Information security analyst | A | 1 | 1. Penetration Testers [O*NET] 52.4 % ✓; 2. Digital Forensics Analysts [O*NET] 50.0 %; 3. Information Security Analysts [O*NET] 46.2 % ✓; 4. Information Security Engineers [O*NET] 42.3 %; 5. Computer Network Architects [O*NET] 38.5 % |
| CV 06 Information security analyst | B | 1 | 1. Penetration Testers [O*NET] 59.5 % ✓; 2. Information Security Analysts [O*NET] 57.7 % ✓; 3. Digital Forensics Analysts [O*NET] 55.0 %; 4. Site Reliability Engineer [Curated] 55.0 %; 5. Information Security Engineers [O*NET] 53.8 % |
| CV 07 Database administrator | A | 1 | 1. database administrator [ESCO+O*NET] 39.3 % ✓; 2. database developer [ESCO] 35.0 %; 3. data warehouse designer [ESCO] 32.1 %; 4. Digital Forensics Analysts [O*NET] 30.0 %; 5. data centre operator [ESCO] 28.6 % |
| CV 07 Database administrator | B | 1 | 1. Database Administrators [O*NET] 41.4 % ✓; 2. Digital Forensics Analysts [O*NET] 40.0 %; 3. DevOps Engineer [Curated] 40.0 %; 4. Computer Network Architects [O*NET] 38.5 %; 5. Network and Computer Systems Administrators [O*NET] 35.3 % |
| CV 08 QA automation engineer | A | 1 | 1. Software Quality Assurance Analysts and Testers [O*NET] 58.3 % ✓; 2. Computer Systems Engineers/Architects [O*NET] 45.5 %; 3. Blockchain Engineers [O*NET] 45.0 %; 4. ICT test analyst [ESCO] 45.0 % ✓; 5. software tester [ESCO] 45.0 % ✓ |
| CV 08 QA automation engineer | B | 1 | 1. Software Quality Assurance Analysts and Testers [O*NET] 62.5 % ✓; 2. Computer Systems Engineers/Architects [O*NET] 50.0 %; 3. Backend Developer [Curated] 50.0 %; 4. Computer Systems Analysts [O*NET] 50.0 %; 5. DevOps Engineer [Curated] 50.0 % |
| CV 09 UI/UX designer | A | 1 | 1. Web and Digital Interface Designers [O*NET] 62.5 % ✓; 2. web designer [ESCO] 55.0 % ✓; 3. user interface designer [ESCO] 53.7 % ✓; 4. user interface developer [ESCO] 50.0 % ✓; 5. user experience analyst [ESCO] 44.4 % ✓ |
| CV 09 UI/UX designer | B | 1 | 1. UI/UX Designer [Curated] 80.0 % ✓; 2. Web and Digital Interface Designers [O*NET] 62.5 % ✓; 3. Video Game Designers [O*NET] 40.0 %; 4. WordPress Developer [Curated] 35.0 %; 5. Document Management Specialists [O*NET] 35.0 % |
| CV 10 Network / systems administrator | A | 1 | 1. Computer Network Support Specialists [O*NET] 45.0 % ✓; 2. ICT technician [ESCO] 39.1 % ✓; 3. Network and Computer Systems Administrators [O*NET] 38.2 % ✓; 4. Computer User Support Specialists [O*NET] 33.3 % ✓; 5. Penetration Testers [O*NET] 31.0 % |
| CV 10 Network / systems administrator | B | 1 | 1. Computer Network Support Specialists [O*NET] 45.0 % ✓; 2. Network and Computer Systems Administrators [O*NET] 38.2 % ✓; 3. Penetration Testers [O*NET] 35.7 %; 4. Information Security Engineers [O*NET] 34.6 %; 5. Computer User Support Specialists [O*NET] 33.3 % ✓ |

