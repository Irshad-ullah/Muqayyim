# Module 5.2 — variant B2 (no related credit) vs B

Sandbox only (`compare_b2.py`; marks fixed beforehand in `expectations_b2.md`). Same data as B: O\*NET + 19 curated roles, ESCO off ({'curated': 19, 'onet': 30}). B2 counts only exact / alias / any-of credit; related pairs are display-only `related_hints`. **The 10 test CVs are not blind.**

## Pass marks

| Mark | B | B2 |
|---|---|---|
| old8 top-3 7/7 | PASS | PASS |
| old8 top-5 7/7 | PASS | PASS |
| chef best < 20 % | FAIL | PASS |
| new6 top-5 >= 5/6 | PASS | PASS |
| testcvs top-3 >= 8/10 (not blind) | PASS | PASS |
| testcvs top-5 >= 9/10 (not blind) | PASS | PASS |
| background chef <= 5 % and <= 0.5 x web (ratio n/a: web 0) | FAIL | PASS |
| 0 vague required skills | PASS | PASS |

| | B | B2 |
|---|---|---|
| Old 8: top-3 · top-5 | 7/7 · 7/7 | 7/7 · 7/7 |
| New 6 (not blind): top-3 · top-5 | 5/6 · 6/6 | 6/6 · 6/6 |
| 10 test CVs (not blind): top-3 · top-5 | 10/10 · 10/10 | 10/10 · 10/10 |
| Chef best | 20.0 % (Product Manager (Software)) | 0.0 % (AI Engineer (LLM Applications)) |
| Test CVs: expected family #1 · top 3 | 7 · 10 | 7 · 10 |

**Rank changes B → B2:** first acceptable rank changed for **2** of 24 profiles (Security analyst: 4 → 3; CV 06 Information security analyst: 2 → 3); **63** of 120 top-5 positions hold a different role.

## Background

| Variant | Profile | Rate | Real / false | Other figures |
|---|---|---|---|---|
| B (related credit) | chef | 5.4 % (60/1103) | 0 real / 60 false | |
| B (related credit) | web | 18.5 % (193/1046) | 21 real / 172 false | |
| B2 (any-of beyond exact) | chef | 0.0 % (0/1103) | 0 real / 0 false | related-hint rate 5.4 % (not counted); all credited incl. exact 0.0 % (0 exact rows) |
| B2 (any-of beyond exact) | web | 0.0 % (0/1046) | 0 real / 0 false | related-hint rate 18.5 % (not counted); all credited incl. exact 5.2 % (57 exact rows) |

## The Java backend CV (test CV 02) spread

| | B | B2 |
|---|---|---|
| Roles ≥ 50 % / ≥ 40 % | 5 / 11 | 1 / 2 |
| Median over all 49 roles | 20.0 % | 10.0 % |
| Top 8 | Backend Developer 85.0 %; Data Engineer 60.0 %; Android Developer 55.0 %; Software Quality Assurance Analysts and Testers 50.0 %; DevOps Engineer 50.0 %; Software Developers 45.0 %; Web Developers 45.0 %; MLOps Engineer 45.0 % | Backend Developer 80.0 %; Data Engineer 40.0 %; Android Developer 30.0 %; DevOps Engineer 30.0 %; MLOps Engineer 30.0 %; Software Developers 26.7 %; Web Developers 26.7 %; Blockchain Engineers 25.0 % |
| Curated roles | Backend Developer 85.0; Data Engineer 60.0; Android Developer 55.0; DevOps Engineer 50.0; MLOps Engineer 45.0; Full-Stack Developer 38.5; Cross-Platform Mobile Developer 35.0; Cloud Engineer 30.0; Frontend Developer 20.8; DevSecOps Engineer 20.0; Site Reliability Engineer 20.0; iOS Developer 15.0; Product Manager (Software) 15.0; WordPress Developer 15.0; Data Analyst 10.0; Machine Learning Engineer 10.0; Game Developer 6.2; AI Engineer (LLM Applications) 0.0; UI/UX Designer 0.0 | Backend Developer 80.0; Data Engineer 40.0; Android Developer 30.0; DevOps Engineer 30.0; MLOps Engineer 30.0; Full-Stack Developer 23.1; Cloud Engineer 10.0; Cross-Platform Mobile Developer 10.0; Data Analyst 10.0; DevSecOps Engineer 10.0; iOS Developer 10.0; Machine Learning Engineer 10.0; Product Manager (Software) 10.0; Site Reliability Engineer 10.0; WordPress Developer 10.0; Frontend Developer 8.3; AI Engineer (LLM Applications) 0.0; Game Developer 0.0; UI/UX Designer 0.0 |

## related_hints examples (B2, display only)

**Web profile (old 8)** (60 hints in its top 10):
- Frontend Developer: *Next.js* — close to your React (similarity 0.889, described, required)
- Frontend Developer: *Vite* — close to your JavaScript (similarity 0.863, described, required)
- Blockchain Engineers: *Python* — close to your JavaScript (similarity 0.851, described, required)

**Android CV (test CV 05)** (83 hints in its top 10):
- Software Quality Assurance Analysts and Testers: *Postman* — close to your REST APIs (similarity 0.896, described, required)
- Software Quality Assurance Analysts and Testers: *REST Assured* — close to your REST APIs (similarity 0.883, described, required)
- Software Quality Assurance Analysts and Testers: *TestNG* — close to your Unit Testing (similarity 0.862, described, required)

## Top 5 per profile

| Profile | Variant | First acceptable | Top 5 (✓ acceptable) |
|---|---|---|---|
| Web developer | B | 1 | 1. Frontend Developer [Curated] 83.3 % ✓; 2. Full-Stack Developer [Curated] 65.4 % ✓; 3. Web and Digital Interface Designers [O*NET] 62.5 % ✓; 4. WordPress Developer [Curated] 50.0 %; 5. Blockchain Engineers [O*NET] 42.5 % |
| Web developer | B2 | 1 | 1. Frontend Developer [Curated] 66.7 % ✓; 2. Full-Stack Developer [Curated] 61.5 % ✓; 3. Web and Digital Interface Designers [O*NET] 41.7 % ✓; 4. Blockchain Engineers [O*NET] 30.0 %; 5. Backend Developer [Curated] 30.0 % |
| Backend Python developer | B | 1 | 1. Backend Developer [Curated] 75.0 % ✓; 2. DevOps Engineer [Curated] 60.0 %; 3. Data Engineer [Curated] 55.0 %; 4. Full-Stack Developer [Curated] 53.8 %; 5. Cloud Engineer [Curated] 50.0 % |
| Backend Python developer | B2 | 1 | 1. Backend Developer [Curated] 70.0 % ✓; 2. Data Engineer [Curated] 40.0 %; 3. DevOps Engineer [Curated] 40.0 %; 4. Full-Stack Developer [Curated] 38.5 %; 5. Blockchain Engineers [O*NET] 30.0 % |
| Data scientist | B | 1 | 1. Machine Learning Engineer [Curated] 80.0 % ✓; 2. Data Analyst [Curated] 80.0 % ✓; 3. Data Scientists [O*NET] 54.8 % ✓; 4. Health Informatics Specialists [O*NET] 54.5 %; 5. Data Warehousing Specialists [O*NET] 50.0 % |
| Data scientist | B2 | 1 | 1. Machine Learning Engineer [Curated] 70.0 % ✓; 2. Data Analyst [Curated] 60.0 % ✓; 3. Data Scientists [O*NET] 33.3 % ✓; 4. Data Warehousing Specialists [O*NET] 30.0 %; 5. Health Informatics Specialists [O*NET] 27.3 % |
| DevOps engineer | B | 1 | 1. DevOps Engineer [Curated] 100.0 % ✓; 2. Cloud Engineer [Curated] 75.0 % ✓; 3. Site Reliability Engineer [Curated] 70.0 % ✓; 4. MLOps Engineer [Curated] 65.0 %; 5. Computer Systems Engineers/Architects [O*NET] 61.4 % |
| DevOps engineer | B2 | 1 | 1. DevOps Engineer [Curated] 100.0 % ✓; 2. Site Reliability Engineer [Curated] 60.0 % ✓; 3. Cloud Engineer [Curated] 50.0 % ✓; 4. MLOps Engineer [Curated] 50.0 %; 5. Computer Systems Engineers/Architects [O*NET] 40.9 % |
| Mobile developer | B | 1 | 1. Cross-Platform Mobile Developer [Curated] 60.0 % ✓; 2. iOS Developer [Curated] 55.0 % ✓; 3. Android Developer [Curated] 50.0 % ✓; 4. Frontend Developer [Curated] 33.3 %; 5. Software Quality Assurance Analysts and Testers [O*NET] 29.2 % |
| Mobile developer | B2 | 1 | 1. Cross-Platform Mobile Developer [Curated] 50.0 % ✓; 2. Android Developer [Curated] 30.0 % ✓; 3. Backend Developer [Curated] 20.0 %; 4. iOS Developer [Curated] 20.0 % ✓; 5. Frontend Developer [Curated] 16.7 % |
| UI/UX designer | B | 1 | 1. UI/UX Designer [Curated] 65.0 % ✓; 2. Web and Digital Interface Designers [O*NET] 58.3 % ✓; 3. WordPress Developer [Curated] 40.0 %; 4. Video Game Designers [O*NET] 35.0 %; 5. Frontend Developer [Curated] 33.3 % |
| UI/UX designer | B2 | 1 | 1. UI/UX Designer [Curated] 50.0 % ✓; 2. Web and Digital Interface Designers [O*NET] 41.7 % ✓; 3. WordPress Developer [Curated] 20.0 %; 4. Frontend Developer [Curated] 16.7 %; 5. Full-Stack Developer [Curated] 15.4 % |
| QA tester | B | 2 | 1. Backend Developer [Curated] 45.0 %; 2. Software Quality Assurance Analysts and Testers [O*NET] 41.7 % ✓; 3. Computer Systems Analysts [O*NET] 35.0 %; 4. Product Manager (Software) [Curated] 35.0 %; 5. Blockchain Engineers [O*NET] 30.0 % |
| QA tester | B2 | 2 | 1. Computer Systems Analysts [O*NET] 30.0 %; 2. Software Quality Assurance Analysts and Testers [O*NET] 20.8 % ✓; 3. Backend Developer [Curated] 20.0 %; 4. Data Analyst [Curated] 20.0 %; 5. Data Engineer [Curated] 20.0 % |
| Chef (non-IT control) | B | — | 1. Product Manager (Software) [Curated] 20.0 %; 2. Computer Systems Analysts [O*NET] 15.0 %; 3. Document Management Specialists [O*NET] 15.0 %; 4. Business Intelligence Analysts [O*NET] 14.3 %; 5. Health Informatics Specialists [O*NET] 13.6 % |
| Chef (non-IT control) | B2 | — | 1. AI Engineer (LLM Applications) [Curated] 0.0 %; 2. Android Developer [Curated] 0.0 %; 3. Backend Developer [Curated] 0.0 %; 4. Blockchain Engineers [O*NET] 0.0 %; 5. Business Intelligence Analysts [O*NET] 0.0 % |
| Cloud engineer | B | 1 | 1. DevOps Engineer [Curated] 85.0 % ✓; 2. Cloud Engineer [Curated] 80.0 % ✓; 3. Computer Systems Engineers/Architects [O*NET] 63.6 %; 4. Information Security Engineers [O*NET] 61.5 %; 5. Site Reliability Engineer [Curated] 60.0 % ✓ |
| Cloud engineer | B2 | 1 | 1. DevOps Engineer [Curated] 80.0 % ✓; 2. Cloud Engineer [Curated] 60.0 % ✓; 3. Site Reliability Engineer [Curated] 60.0 % ✓; 4. Information Security Engineers [O*NET] 53.8 %; 5. MLOps Engineer [Curated] 50.0 % |
| Android developer | B | 1 | 1. Android Developer [Curated] 70.0 % ✓; 2. Cross-Platform Mobile Developer [Curated] 50.0 % ✓; 3. Software Quality Assurance Analysts and Testers [O*NET] 39.6 %; 4. Backend Developer [Curated] 35.0 %; 5. Blockchain Engineers [O*NET] 35.0 % |
| Android developer | B2 | 1 | 1. Android Developer [Curated] 60.0 % ✓; 2. Cross-Platform Mobile Developer [Curated] 30.0 % ✓; 3. Backend Developer [Curated] 20.0 %; 4. Computer Programmers [O*NET] 10.5 %; 5. Blockchain Engineers [O*NET] 10.0 % |
| Data engineer | B | 1 | 1. Data Engineer [Curated] 100.0 % ✓; 2. Cloud Engineer [Curated] 65.0 %; 3. Backend Developer [Curated] 55.0 %; 4. MLOps Engineer [Curated] 55.0 %; 5. DevOps Engineer [Curated] 55.0 % |
| Data engineer | B2 | 1 | 1. Data Engineer [Curated] 100.0 % ✓; 2. Backend Developer [Curated] 50.0 %; 3. Database Architects [O*NET] 46.2 %; 4. MLOps Engineer [Curated] 40.0 %; 5. Cloud Engineer [Curated] 30.0 % |
| Security analyst | B | 4 | 1. Penetration Testers [O*NET] 57.1 %; 2. Digital Forensics Analysts [O*NET] 55.0 %; 3. Site Reliability Engineer [Curated] 55.0 %; 4. Information Security Analysts [O*NET] 50.0 % ✓; 5. Information Security Engineers [O*NET] 50.0 % |
| Security analyst | B2 | 3 | 1. Digital Forensics Analysts [O*NET] 40.0 %; 2. Penetration Testers [O*NET] 38.1 %; 3. Information Security Analysts [O*NET] 30.8 % ✓; 4. Information Security Engineers [O*NET] 30.8 %; 5. Computer Network Architects [O*NET] 23.1 % |
| Game developer | B | 1 | 1. Video Game Designers [O*NET] 70.0 % ✓; 2. Game Developer [Curated] 56.2 % ✓; 3. Web and Digital Interface Designers [O*NET] 37.5 %; 4. Blockchain Engineers [O*NET] 32.5 %; 5. Computer Programmers [O*NET] 31.6 % |
| Game developer | B2 | 1 | 1. Video Game Designers [O*NET] 40.0 % ✓; 2. Game Developer [Curated] 37.5 % ✓; 3. Computer Programmers [O*NET] 21.1 %; 4. Clinical Data Managers [O*NET] 20.0 %; 5. Blockchain Engineers [O*NET] 15.0 % |
| IT support | B | 1 | 1. Computer Network Support Specialists [O*NET] 75.0 % ✓; 2. Computer User Support Specialists [O*NET] 62.5 % ✓; 3. Network and Computer Systems Administrators [O*NET] 52.9 %; 4. Information Technology Project Managers [O*NET] 50.0 %; 5. Computer Network Architects [O*NET] 42.3 % |
| IT support | B2 | 1 | 1. Computer Network Support Specialists [O*NET] 50.0 % ✓; 2. Computer User Support Specialists [O*NET] 41.7 % ✓; 3. Computer Systems Analysts [O*NET] 20.0 %; 4. Information Technology Project Managers [O*NET] 20.0 %; 5. Network and Computer Systems Administrators [O*NET] 17.6 % |
| CV 01 Frontend developer (not blind) | B | 1 | 1. Frontend Developer [Curated] 100.0 % ✓; 2. Web and Digital Interface Designers [O*NET] 66.7 % ✓; 3. Full-Stack Developer [Curated] 65.4 % ✓; 4. WordPress Developer [Curated] 55.0 %; 5. Cross-Platform Mobile Developer [Curated] 50.0 % |
| CV 01 Frontend developer (not blind) | B2 | 1 | 1. Frontend Developer [Curated] 100.0 % ✓; 2. Full-Stack Developer [Curated] 61.5 % ✓; 3. Web and Digital Interface Designers [O*NET] 50.0 % ✓; 4. Cross-Platform Mobile Developer [Curated] 40.0 %; 5. WordPress Developer [Curated] 30.0 % |
| CV 02 Backend developer (Java) (not blind) | B | 1 | 1. Backend Developer [Curated] 85.0 % ✓; 2. Data Engineer [Curated] 60.0 %; 3. Android Developer [Curated] 55.0 %; 4. Software Quality Assurance Analysts and Testers [O*NET] 50.0 %; 5. DevOps Engineer [Curated] 50.0 % |
| CV 02 Backend developer (Java) (not blind) | B2 | 1 | 1. Backend Developer [Curated] 80.0 % ✓; 2. Data Engineer [Curated] 40.0 %; 3. Android Developer [Curated] 30.0 %; 4. DevOps Engineer [Curated] 30.0 %; 5. MLOps Engineer [Curated] 30.0 % |
| CV 03 Data scientist (not blind) | B | 1 | 1. Machine Learning Engineer [Curated] 85.0 % ✓; 2. Data Analyst [Curated] 85.0 % ✓; 3. Data Scientists [O*NET] 59.5 % ✓; 4. Health Informatics Specialists [O*NET] 59.1 %; 5. Data Warehousing Specialists [O*NET] 50.0 % |
| CV 03 Data scientist (not blind) | B2 | 1 | 1. Machine Learning Engineer [Curated] 80.0 % ✓; 2. Data Analyst [Curated] 70.0 % ✓; 3. Data Scientists [O*NET] 42.9 % ✓; 4. Health Informatics Specialists [O*NET] 36.4 %; 5. Data Warehousing Specialists [O*NET] 30.0 % |
| CV 04 DevOps engineer (not blind) | B | 1 | 1. DevOps Engineer [Curated] 95.0 % ✓; 2. Cloud Engineer [Curated] 90.0 % ✓; 3. Site Reliability Engineer [Curated] 90.0 % ✓; 4. MLOps Engineer [Curated] 70.0 %; 5. Computer Systems Engineers/Architects [O*NET] 68.2 % ✓ |
| CV 04 DevOps engineer (not blind) | B2 | 1 | 1. DevOps Engineer [Curated] 90.0 % ✓; 2. Cloud Engineer [Curated] 80.0 % ✓; 3. Site Reliability Engineer [Curated] 80.0 % ✓; 4. MLOps Engineer [Curated] 60.0 %; 5. Information Security Engineers [O*NET] 46.2 % |
| CV 05 Android developer (not blind) | B | 1 | 1. Android Developer [Curated] 90.0 % ✓; 2. Cross-Platform Mobile Developer [Curated] 80.0 % ✓; 3. Backend Developer [Curated] 60.0 %; 4. Software Quality Assurance Analysts and Testers [O*NET] 47.9 %; 5. iOS Developer [Curated] 40.0 % |
| CV 05 Android developer (not blind) | B2 | 1 | 1. Android Developer [Curated] 80.0 % ✓; 2. Cross-Platform Mobile Developer [Curated] 60.0 % ✓; 3. Backend Developer [Curated] 40.0 %; 4. Frontend Developer [Curated] 16.7 %; 5. Full-Stack Developer [Curated] 15.4 % |
| CV 06 Information security analyst (not blind) | B | 2 | 1. DevSecOps Engineer [Curated] 60.0 %; 2. Penetration Testers [O*NET] 59.5 % ✓; 3. Information Security Analysts [O*NET] 57.7 % ✓; 4. Digital Forensics Analysts [O*NET] 55.0 %; 5. Site Reliability Engineer [Curated] 55.0 % |
| CV 06 Information security analyst (not blind) | B2 | 3 | 1. DevSecOps Engineer [Curated] 40.0 %; 2. Digital Forensics Analysts [O*NET] 40.0 %; 3. Information Security Analysts [O*NET] 38.5 % ✓; 4. Penetration Testers [O*NET] 38.1 % ✓; 5. Information Security Engineers [O*NET] 30.8 % |
| CV 07 Database administrator (not blind) | B | 1 | 1. Database Administrators [O*NET] 41.4 % ✓; 2. Data Engineer [Curated] 40.0 % ✓; 3. Digital Forensics Analysts [O*NET] 40.0 %; 4. DevOps Engineer [Curated] 40.0 %; 5. Computer Network Architects [O*NET] 38.5 % |
| CV 07 Database administrator (not blind) | B2 | 1 | 1. Database Administrators [O*NET] 24.1 % ✓; 2. Backend Developer [Curated] 20.0 %; 3. Data Engineer [Curated] 20.0 % ✓; 4. Digital Forensics Analysts [O*NET] 20.0 %; 5. Computer User Support Specialists [O*NET] 16.7 % |
| CV 08 QA automation engineer (not blind) | B | 1 | 1. Software Quality Assurance Analysts and Testers [O*NET] 62.5 % ✓; 2. Computer Systems Engineers/Architects [O*NET] 50.0 %; 3. Backend Developer [Curated] 50.0 %; 4. Computer Systems Analysts [O*NET] 50.0 %; 5. DevOps Engineer [Curated] 50.0 % |
| CV 08 QA automation engineer (not blind) | B2 | 1 | 1. Software Quality Assurance Analysts and Testers [O*NET] 41.7 % ✓; 2. Computer Systems Engineers/Architects [O*NET] 31.8 %; 3. Android Developer [Curated] 30.0 %; 4. Backend Developer [Curated] 30.0 %; 5. Computer Systems Analysts [O*NET] 30.0 % |
| CV 09 UI/UX designer (not blind) | B | 1 | 1. UI/UX Designer [Curated] 85.0 % ✓; 2. Web and Digital Interface Designers [O*NET] 62.5 % ✓; 3. Video Game Designers [O*NET] 40.0 %; 4. WordPress Developer [Curated] 40.0 %; 5. Document Management Specialists [O*NET] 35.0 % |
| CV 09 UI/UX designer (not blind) | B2 | 1 | 1. UI/UX Designer [Curated] 80.0 % ✓; 2. Web and Digital Interface Designers [O*NET] 50.0 % ✓; 3. Video Game Designers [O*NET] 20.0 %; 4. WordPress Developer [Curated] 20.0 %; 5. Frontend Developer [Curated] 16.7 % ✓ |
| CV 10 Network / systems administrator (not blind) | B | 1 | 1. Computer Network Support Specialists [O*NET] 45.0 % ✓; 2. Network and Computer Systems Administrators [O*NET] 41.2 % ✓; 3. Penetration Testers [O*NET] 35.7 %; 4. Information Security Engineers [O*NET] 34.6 %; 5. Computer User Support Specialists [O*NET] 33.3 % ✓ |
| CV 10 Network / systems administrator (not blind) | B2 | 1 | 1. Computer Network Support Specialists [O*NET] 20.0 % ✓; 2. Network and Computer Systems Administrators [O*NET] 17.6 % ✓; 3. Computer Network Architects [O*NET] 15.4 % ✓; 4. Information Security Engineers [O*NET] 15.4 %; 5. Digital Forensics Analysts [O*NET] 10.0 % |
