# Module 5.2 — background-check diagnosis (report only)

Where the background check's related credit comes from, pair by pair (`diagnose_background.py`, reproducing `eval/background_credit_rate.py` exactly: same embeddings, threshold 0.73, mutual-NN for described role skills). Nothing was tuned or changed. Labels: `background_labels.json` (assistant's judgement; real overlap = the profile genuinely has the role skill; anything else = false match).

## Summary

| Setup | Profile | Rate | Real overlap | False match |
|---|---|---|---|---|
| B | chef | 5.5 % (61/1104) | 0 rows = 0 % (0.0 pts) | 61 rows = 100 % (5.5 pts) |
| B | web | 20.3 % (213/1047) | 21 rows = 10 % (2.0 pts) | 192 rows = 90 % (18.3 pts) |
| A | chef | 3.2 % (222/7001) | 18 rows = 8 % (0.3 pts) | 204 rows = 92 % (2.9 pts) |
| A | web | 12.9 % (894/6927) | 210 rows = 23 % (3.0 pts) | 684 rows = 77 % (9.9 pts) |

**Labels.** *Inventory Management → Excel* (0.782; 21 rows in B, 20 in A) is a **false match**, as decided by the project team on 2026-10-17: the chef profile does not list Excel. With that decision **100 % of B's chef credit is false match**. Customer Service earns no real overlap in B, because its genuine pairs are ESCO phrases. The largest single source in A is *Inventory Management → SAS* (40 rows, false match). The chef never matches a role skill exactly.

**Test-CV note (Module 5.2 results).** The 10 test CVs were not written blind to the curated roles: the roles were designed
after the CVs had been seen (as the project team states; file dates: CVs 18:41, curated dataset files 21:01 on
2026-10-17). The test-CV results in `compare_setups.md` are labelled **not blind**.

**How the rate is counted:**

- rows = every stored skill of every active role, not only the required set;
- a row whose key equals a profile skill is an exact match (1.0) and is left out of the rate (the chef has none in either setup);
- a row is credited (related, 0.5) when a profile skill reaches similarity ≥ 0.73 (described role skill: also mutual top-10 neighbours; undescribed ESCO phrase: threshold only, "mixed").

**Rate = credited rows ÷ non-exact rows.** It is not the match % of any role.

## B — O*NET + curated (ESCO off): chef (Cooking, Customer Service, Inventory Management) 5.5 %

61 credited rows of 1104 non-exact rows; exact matches: 0.

- **Real overlap:** 0 rows = **0 %** of the credit (0.0 of the 5.5 points)
- **False match:** 61 rows = **100 %** (5.5 points)
- By chef skill: Cooking: 0 real / 6 false; Customer Service: 0 real / 5 false; Inventory Management: 0 real / 50 false
- By role source: Curated: 10 rows (0 real / 10 false); O*NET: 51 rows (0 real / 51 false)

| Role | Source | Credit type | Role rate (credited / rows) | Pairs (chef skill → role skill, similarity, kind) | Label |
|---|---|---|---|---|---|
| Data Analyst | Curated | related 0.5 | 20.0 % (2/10) | Inventory Management → Regression Analysis 0.744 (described) | false match |
| | | related 0.5 |  | Inventory Management → Excel 0.782 (described) | false match |
| Health Informatics Specialists | O*NET | related 0.5 | 19.2 % (5/26) | Inventory Management → SQL Server Reporting Services 0.758 (described) | false match |
| | | related 0.5 |  | Customer Service → Salesforce 0.77 (described) | false match |
| | | related 0.5 |  | Inventory Management → Excel 0.782 (described) | false match |
| | | related 0.5 |  | Inventory Management → SAS 0.768 (described) | false match |
| | | related 0.5 |  | Cooking → Microsoft Word 0.749 (described) | false match |
| Clinical Data Managers | O*NET | related 0.5 | 19.0 % (4/21) | Inventory Management → Microsoft SQL Server 0.752 (described) | false match |
| | | related 0.5 |  | Inventory Management → Excel 0.782 (described) | false match |
| | | related 0.5 |  | Inventory Management → SAS 0.768 (described) | false match |
| | | related 0.5 |  | Cooking → Microsoft Word 0.749 (described) | false match |
| Product Manager (Software) | Curated | related 0.5 | 18.2 % (2/11) | Inventory Management → Product analytics 0.737 (mixed) | false match |
| | | related 0.5 |  | Inventory Management → Product Roadmapping 0.766 (described) | false match |
| Data Engineer | Curated | related 0.5 | 16.7 % (2/12) | Inventory Management → Data Modeling 0.742 (described) | false match |
| | | related 0.5 |  | Inventory Management → PostgreSQL 0.743 (described) | false match |
| UI/UX Designer | Curated | related 0.5 | 16.7 % (2/12) | Customer Service → User Research 0.747 (described) | false match |
| | | related 0.5 |  | Customer Service → Usability Testing 0.739 (described) | false match |
| Database Administrators | O*NET | related 0.5 | 13.8 % (4/29) | Inventory Management → Microsoft SQL Server 0.752 (described) | false match |
| | | related 0.5 |  | Customer Service → Salesforce 0.77 (described) | false match |
| | | related 0.5 |  | Inventory Management → Oracle Database 0.742 (described) | false match |
| | | related 0.5 |  | Inventory Management → PostgreSQL 0.743 (described) | false match |
| Business Intelligence Analysts | O*NET | related 0.5 | 13.3 % (4/30) | Inventory Management → SAP 0.753 (described) | false match |
| | | related 0.5 |  | Customer Service → Salesforce 0.77 (described) | false match |
| | | related 0.5 |  | Inventory Management → Excel 0.782 (described) | false match |
| | | related 0.5 |  | Inventory Management → SAS 0.768 (described) | false match |
| Telecommunications Engineering Specialists | O*NET | related 0.5 | 13.0 % (3/23) | Inventory Management → Microsoft SQL Server 0.752 (described) | false match |
| | | related 0.5 |  | Inventory Management → Excel 0.782 (described) | false match |
| | | related 0.5 |  | Cooking → Microsoft Word 0.749 (described) | false match |
| Document Management Specialists | O*NET | related 0.5 | 10.3 % (3/29) | Inventory Management → Microsoft SQL Server 0.752 (described) | false match |
| | | related 0.5 |  | Inventory Management → Excel 0.782 (described) | false match |
| | | related 0.5 |  | Cooking → Microsoft Word 0.749 (described) | false match |
| Computer Network Support Specialists | O*NET | related 0.5 | 10.0 % (3/30) | Inventory Management → Microsoft SQL Server 0.752 (described) | false match |
| | | related 0.5 |  | Inventory Management → Excel 0.782 (described) | false match |
| | | related 0.5 |  | Cooking → Microsoft Word 0.749 (described) | false match |
| Computer Programmers | O*NET | related 0.5 | 10.0 % (3/30) | Inventory Management → Microsoft SQL Server 0.752 (described) | false match |
| | | related 0.5 |  | Inventory Management → Excel 0.782 (described) | false match |
| | | related 0.5 |  | Inventory Management → SAS 0.768 (described) | false match |
| Video Game Designers | O*NET | related 0.5 | 10.0 % (3/30) | Inventory Management → Microsoft SQL Server 0.752 (described) | false match |
| | | related 0.5 |  | Inventory Management → Excel 0.782 (described) | false match |
| | | related 0.5 |  | Cooking → Microsoft Word 0.749 (described) | false match |
| Backend Developer | Curated | related 0.5 | 9.1 % (1/11) | Inventory Management → PostgreSQL 0.743 (described) | false match |
| Computer Systems Analysts | O*NET | related 0.5 | 6.7 % (2/30) | Inventory Management → SAP 0.753 (described) | false match |
| | | related 0.5 |  | Inventory Management → Excel 0.782 (described) | false match |
| Data Scientists | O*NET | related 0.5 | 6.7 % (2/30) | Inventory Management → Excel 0.782 (described) | false match |
| | | related 0.5 |  | Inventory Management → SAS 0.768 (described) | false match |
| Full-Stack Developer | Curated | related 0.5 | 6.7 % (1/15) | Inventory Management → PostgreSQL 0.743 (described) | false match |
| Information Technology Project Managers | O*NET | related 0.5 | 6.7 % (2/30) | Inventory Management → SAP 0.753 (described) | false match |
| | | related 0.5 |  | Inventory Management → Excel 0.782 (described) | false match |
| Geographic Information Systems Technologists and Technicians | O*NET | related 0.5 | 3.4 % (1/29) | Inventory Management → Excel 0.782 (described) | false match |
| Information Security Analysts | O*NET | related 0.5 | 3.4 % (1/29) | Inventory Management → Excel 0.782 (described) | false match |
| Network and Computer Systems Administrators | O*NET | related 0.5 | 3.4 % (1/29) | Inventory Management → Excel 0.782 (described) | false match |
| Web Administrators | O*NET | related 0.5 | 3.4 % (1/29) | Inventory Management → Microsoft SQL Server 0.752 (described) | false match |
| Blockchain Engineers | O*NET | related 0.5 | 3.3 % (1/30) | Inventory Management → PostgreSQL 0.743 (described) | false match |
| Computer Network Architects | O*NET | related 0.5 | 3.3 % (1/30) | Inventory Management → Excel 0.782 (described) | false match |
| Computer User Support Specialists | O*NET | related 0.5 | 3.3 % (1/30) | Inventory Management → Excel 0.782 (described) | false match |
| Data Warehousing Specialists | O*NET | related 0.5 | 3.3 % (1/30) | Inventory Management → Excel 0.782 (described) | false match |
| Database Architects | O*NET | related 0.5 | 3.3 % (1/30) | Inventory Management → Excel 0.782 (described) | false match |
| Digital Forensics Analysts | O*NET | related 0.5 | 3.3 % (1/30) | Inventory Management → Excel 0.782 (described) | false match |
| Software Developers | O*NET | related 0.5 | 3.3 % (1/30) | Inventory Management → PostgreSQL 0.743 (described) | false match |
| Software Quality Assurance Analysts and Testers | O*NET | related 0.5 | 3.3 % (1/30) | Inventory Management → Excel 0.782 (described) | false match |
| Web Developers | O*NET | related 0.5 | 3.3 % (1/30) | Inventory Management → PostgreSQL 0.743 (described) | false match |

### B — web profile (React, Python, Docker, Figma): 20.3 %

213 credited rows of 1047: real overlap 21 (10 %), false match 192 (90 %). By web skill: Docker 0 real / 70 false; Figma 2 real / 23 false; Python 0 real / 75 false; React 19 real / 24 false. The false matches are mostly neighbouring tools of the same family (React → TypeScript / Angular / ASP.NET Core / Tomcat, Python → Java / R / Ruby / Go, Docker → Linux / Ansible / Kubernetes, Figma → Adobe InDesign / Illustrator / AutoCAD) and ESCO phrases (A).

## A — production: O*NET + ESCO with the map: chef (Cooking, Customer Service, Inventory Management) 3.2 %

222 credited rows of 7001 non-exact rows; exact matches: 0.

- **Real overlap:** 18 rows = **8 %** of the credit (0.3 of the 3.2 points)
- **False match:** 204 rows = **92 %** (2.9 points)
- By chef skill: Cooking: 0 real / 26 false; Customer Service: 17 real / 47 false; Inventory Management: 1 real / 131 false
- By role source: ESCO: 176 rows (18 real / 158 false); O*NET: 46 rows (0 real / 46 false)

Production is summarised per pair (rows = roles where it credits):

| Chef skill → role skill | Similarity | Kind | Source | Rows | Label |
|---|---|---|---|---|---|
| Inventory Management → SAS | 0.768 | described | ESCO | 35 | false match |
| Inventory Management → Process-based management | 0.735 | mixed | ESCO | 23 | false match |
| Inventory Management → Excel | 0.782 | described | O*NET | 20 | false match |
| Customer Service → collect customer feedback on applications | 0.777 | mixed | ESCO | 15 | false match |
| Customer Service → identify customer requirements | 0.762 | mixed | ESCO | 10 | false match |
| Inventory Management → Business Intelligence | 0.75 | described | ESCO | 9 | false match |
| Customer Service → replicate customer software issues | 0.737 | mixed | ESCO | 8 | false match |
| Inventory Management → Microsoft SQL Server | 0.752 | described | O*NET | 8 | false match |
| Inventory Management → database management systems | 0.74 | mixed | ESCO | 8 | false match |
| Cooking → Graphic Design | 0.741 | described | ESCO | 7 | false match |
| Cooking → Human-Computer Interaction | 0.74 | described | ESCO | 7 | false match |
| Inventory Management → Microsoft SQL Server | 0.752 | described | ESCO | 7 | false match |
| Cooking → Microsoft Word | 0.749 | described | O*NET | 6 | false match |
| Inventory Management → SAS | 0.768 | described | O*NET | 5 | false match |
| Customer Service → ICT problem management techniques | 0.75 | mixed | ESCO | 4 | false match |
| Customer Service → communicate with customers | 0.822 | mixed | ESCO | 4 | real overlap |
| Customer Service → identify customer's needs | 0.794 | mixed | ESCO | 4 | real overlap |
| Cooking → problem-solving with digital tools | 0.732 | mixed | ESCO | 3 | false match |
| Customer Service → Salesforce | 0.77 | described | O*NET | 3 | false match |
| Customer Service → propose ICT solutions to business problems | 0.734 | mixed | ESCO | 3 | false match |
| Inventory Management → SAP | 0.753 | described | O*NET | 3 | false match |
| Inventory Management → business analytics | 0.753 | mixed | ESCO | 3 | false match |
| Inventory Management → business requirements techniques | 0.735 | mixed | ESCO | 3 | false match |
| Inventory Management → implement data warehousing techniques | 0.735 | mixed | ESCO | 3 | false match |
| Customer Service → Marketing Analytics | 0.77 | described | ESCO | 2 | false match |
| Customer Service → assist customers | 0.828 | mixed | ESCO | 2 | real overlap |
| Customer Service → provide customer follow-up services | 0.788 | mixed | ESCO | 2 | real overlap |
| Inventory Management → perform business analysis | 0.746 | mixed | ESCO | 2 | false match |
| Cooking → Photography | 0.77 | described | ESCO | 1 | false match |
| Cooking → develop food scanner devices | 0.732 | mixed | ESCO | 1 | false match |
| Cooking → printing techniques | 0.73 | mixed | ESCO | 1 | false match |
| Customer Service → call quality assurance management | 0.737 | mixed | ESCO | 1 | false match |
| Customer Service → establish customer rapport | 0.785 | mixed | ESCO | 1 | real overlap |
| Customer Service → guarantee customer satisfaction | 0.765 | mixed | ESCO | 1 | real overlap |
| Customer Service → maintain relationship with customers | 0.747 | mixed | ESCO | 1 | real overlap |
| Customer Service → measure customer feedback | 0.806 | mixed | ESCO | 1 | real overlap |
| Customer Service → prospect new customers | 0.733 | mixed | ESCO | 1 | false match |
| Customer Service → respond to customers' inquiries | 0.831 | mixed | ESCO | 1 | real overlap |
| Inventory Management → SQL Server Reporting Services | 0.758 | described | O*NET | 1 | false match |
| Inventory Management → identify software for warehouse management | 0.765 | mixed | ESCO | 1 | real overlap |
| Inventory Management → product data management | 0.772 | mixed | ESCO | 1 | false match |

### A — web profile (React, Python, Docker, Figma): 12.9 %

894 credited rows of 6927: real overlap 210 (23 %), false match 684 (77 %). By web skill: Docker 3 real / 86 false; Figma 53 real / 132 false; Python 74 real / 282 false; React 80 real / 184 false. The false matches are mostly neighbouring tools of the same family (React → TypeScript / Angular / ASP.NET Core / Tomcat, Python → Java / R / Ruby / Go, Docker → Linux / Ansible / Kubernetes, Figma → Adobe InDesign / Illustrator / AutoCAD) and ESCO phrases (A).

