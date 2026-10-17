# Variant 2, step 1 — O*NET technology categories: feasibility

Source `AIServices/data/raw/onet/software_skills.csv`; category column **`Element Name`** (with `Element ID`); a tool is a distinct `Workplace Example` within a category. Mapping = the O*NET importer's `clean_onet_label` giving a curated or alias name (the same rule the import uses).

| Measure | Value |
|---|---|
| Distinct categories | 134 |
| Tools per category (min / median / max; mean) | 1 / 14.0 / 1687; 66.5 |
| Distinct tools | 8753 (151 in more than one category) |
| Tools mapped to a canonical key | 358 (4.1%) → 331 distinct keys |
| Categories with ≥ 1 / ≥ 3 mapped tools | 74 / 34 |
| Mapped share per category (min / median / max) | 0% / 1% / 70% |

## 10 example categories

| Category | Tools | Mapped | Most used tools (mapped in bold) |
|---|---|---|---|
| Analytical or scientific software | 1687 | 18 (1%) | **SAS**, **The MathWorks MATLAB**, **IBM SPSS Statistics**, Minitab, StataCorp Stata, Statistical software |
| Data base user interface and query software | 910 | 30 (3%) | **Microsoft Access**, Database software, **Structured query language SQL**, **FileMaker Pro**, **Oracle Database**, **Microsoft SQL Server** |
| Medical software | 671 | 5 (1%) | **MEDITECH software**, **Epic Systems**, **eClinicalWorks EHR software**, Medical procedure coding software, Healthcare common procedure coding system HCPCS, Medical condition coding software |
| Financial analysis software | 356 | 5 (1%) | Oracle E-Business Suite Financials, Delphi Technology, Cost estimating software, Bloomberg Professional, CPR Visual Estimator, Delphi Discovery |
| Network security and virtual private network VPN equipment software | 14 | 2 (14%) | **Firewall software**, **Virtual private networking VPN software**, Network intrusion detection software, Juniper Networks NetScreen-Security Manager, Content filter software, Cryptographic key management software |
| Voice synthesizer and recognition software | 1 | 0 (0%) | Voice picking software |
| Billing and invoicing software | 29 | 0 (0%) | Billing software, Fifth Walk BillingTracker, EZClaim medical billing software, e-MDs Bill, American Medical Billing Software PMA, Automated billing software |
| Spreadsheet software | 15 | 2 (13%) | **Microsoft Excel**, IBM Lotus 1-2-3, Corel QuattroPro, **Google Sheets**, Apple AppleWorks, Apple iWork Numbers |
| Filesystem software | 13 | 0 (0%) | File server software, Computer forensic software, Samba, Symantec Norton Utilities, Apple Xsan, Desktop partitioning software |
| Aviation ground support software | 3 | 0 (0%) | ArduPilot Mission Planner, Bornemann Associates Flight Plan, Sabre travel agent software |

## All categories

| Category | Tools | Mapped | Keys |
|---|---|---|---|
| Analytical or scientific software | 1687 | 18 (1%) | 18 |
| Data base user interface and query software | 910 | 30 (3%) | 27 |
| Medical software | 671 | 5 (1%) | 4 |
| Financial analysis software | 356 | 5 (1%) | 5 |
| Computer aided design CAD software | 344 | 7 (2%) | 6 |
| Enterprise resource planning ERP software | 266 | 2 (1%) | 2 |
| Human resources software | 239 | 1 (0%) | 1 |
| Graphics or photo imaging software | 225 | 16 (7%) | 16 |
| Project management software | 207 | 5 (2%) | 5 |
| Document management software | 197 | 3 (2%) | 3 |
| Development environment software | 189 | 39 (21%) | 39 |
| Materials requirements planning logistics and supply chain software | 171 | 0 (0%) | 0 |
| Industrial control software | 169 | 3 (2%) | 3 |
| Accounting software | 141 | 8 (6%) | 8 |
| Customer relationship management CRM software | 140 | 1 (1%) | 1 |
| Computer based training software | 126 | 0 (0%) | 0 |
| Compliance software | 125 | 0 (0%) | 0 |
| Computer aided manufacturing CAM software | 123 | 1 (1%) | 1 |
| Information retrieval or search software | 117 | 1 (1%) | 1 |
| Map creation software | 111 | 2 (2%) | 2 |
| Point of sale POS software | 104 | 3 (3%) | 3 |
| Music or sound editing software | 102 | 0 (0%) | 0 |
| Word processing software | 92 | 3 (3%) | 3 |
| Calendar and scheduling software | 87 | 1 (1%) | 1 |
| Inventory management software | 83 | 0 (0%) | 0 |
| Data base management system software | 78 | 19 (24%) | 18 |
| Program testing software | 77 | 18 (23%) | 18 |
| Network monitoring software | 75 | 1 (1%) | 1 |
| Web platform development software | 73 | 29 (40%) | 29 |
| Video creation and editing software | 69 | 6 (9%) | 6 |
| Object or component oriented development software | 68 | 23 (34%) | 23 |
| Time accounting software | 67 | 1 (2%) | 1 |
| Web page creation and editing software | 63 | 4 (6%) | 3 |
| Facilities management software | 55 | 0 (0%) | 0 |
| Operating system software | 53 | 16 (30%) | 13 |
| Expert system software | 48 | 1 (2%) | 1 |
| Data base reporting software | 45 | 2 (4%) | 2 |
| Transaction security and virus protection software | 43 | 7 (16%) | 7 |
| Presentation software | 39 | 2 (5%) | 2 |
| Desktop publishing software | 38 | 1 (3%) | 1 |
| Geographic information system | 37 | 6 (16%) | 4 |
| Library software | 37 | 0 (0%) | 0 |
| Tax preparation software | 37 | 0 (0%) | 0 |
| Business intelligence and data analysis software | 32 | 7 (22%) | 7 |
| Enterprise application integration software | 31 | 7 (23%) | 7 |
| Billing and invoicing software | 29 | 0 (0%) | 0 |
| Data mining software | 28 | 2 (7%) | 2 |
| Metadata management software | 28 | 5 (18%) | 4 |
| Optical character reader OCR or scanning software | 27 | 0 (0%) | 0 |
| Configuration management software | 26 | 3 (12%) | 3 |
| Network security or virtual private network VPN management software | 26 | 2 (8%) | 2 |
| Backup or archival software | 25 | 1 (4%) | 1 |
| Administration software | 23 | 1 (4%) | 1 |
| Mobile location based services software | 23 | 0 (0%) | 0 |
| Application server software | 22 | 11 (50%) | 11 |
| Compiler and decompiler software | 22 | 0 (0%) | 0 |
| Access software | 20 | 0 (0%) | 0 |
| Desktop communications software | 20 | 1 (5%) | 1 |
| Electronic mail software | 20 | 3 (15%) | 3 |
| Route navigation software | 20 | 0 (0%) | 0 |
| Categorization or classification software | 16 | 0 (0%) | 0 |
| Foreign language software | 16 | 0 (0%) | 0 |
| Procurement software | 15 | 0 (0%) | 0 |
| Spreadsheet software | 15 | 2 (13%) | 2 |
| Video conferencing software | 15 | 0 (0%) | 0 |
| Voice recognition software | 15 | 1 (7%) | 1 |
| Network security and virtual private network VPN equipment software | 14 | 2 (14%) | 2 |
| Office suite software | 14 | 2 (14%) | 2 |
| Content workflow software | 13 | 1 (8%) | 1 |
| Filesystem software | 13 | 0 (0%) | 0 |
| Device drivers or system software | 12 | 1 (8%) | 1 |
| Graphical user interface development software | 12 | 2 (17%) | 2 |
| Helpdesk or call center software | 12 | 1 (8%) | 1 |
| Internet browser software | 12 | 1 (8%) | 1 |
| Network conferencing software | 12 | 1 (8%) | 1 |
| Requirements analysis and system architecture software | 12 | 1 (8%) | 1 |
| Label making software | 11 | 0 (0%) | 0 |
| Pattern design software | 11 | 0 (0%) | 0 |
| Sales and marketing software | 11 | 3 (27%) | 3 |
| Switch or router software | 11 | 1 (9%) | 1 |
| Cloud-based data access and sharing software | 10 | 3 (30%) | 3 |
| Cloud-based management software | 10 | 7 (70%) | 7 |
| Internet protocol IP multimedia subsystem software | 10 | 0 (0%) | 0 |
| Process mapping and design software | 10 | 2 (20%) | 2 |
| Risk management data and analysis software | 10 | 2 (20%) | 2 |
| Transaction server software | 10 | 2 (20%) | 1 |
| Internet directory services software | 9 | 3 (33%) | 2 |
| Network operating system enhancement software | 9 | 0 (0%) | 0 |
| Charting software | 8 | 0 (0%) | 0 |
| Data conversion software | 8 | 0 (0%) | 0 |
| Flight control software | 8 | 0 (0%) | 0 |
| Object oriented data base management software | 8 | 5 (62%) | 5 |
| File versioning software | 7 | 4 (57%) | 4 |
| Instant messaging software | 7 | 0 (0%) | 0 |
| Authentication server software | 6 | 2 (33%) | 2 |
| Clustering software | 6 | 1 (17%) | 1 |
| Enterprise system management software | 6 | 1 (17%) | 1 |
| Multi-media educational software | 6 | 0 (0%) | 0 |
| Platform interconnectivity software | 6 | 0 (0%) | 0 |
| Storage networking software | 6 | 1 (17%) | 1 |
| Communications server software | 5 | 0 (0%) | 0 |
| Action games | 4 | 0 (0%) | 0 |
| Mobile operator specific application software | 4 | 0 (0%) | 0 |
| Network connectivity terminal emulation software | 4 | 0 (0%) | 0 |
| Spell checkers | 4 | 0 (0%) | 0 |
| Aviation ground support software | 3 | 0 (0%) | 0 |
| Cloud-based protection or security software | 3 | 2 (67%) | 2 |
| Contact center software | 3 | 0 (0%) | 0 |
| Data compression software | 3 | 0 (0%) | 0 |
| Dictionary software | 3 | 0 (0%) | 0 |
| Eye tracking software | 3 | 0 (0%) | 0 |
| Legal management software | 3 | 0 (0%) | 0 |
| Network operation system software | 3 | 0 (0%) | 0 |
| Portal server software | 3 | 1 (33%) | 1 |
| Procedure management software | 3 | 1 (33%) | 1 |
| WAN switching software and firmware | 3 | 0 (0%) | 0 |
| Bar coding software | 2 | 0 (0%) | 0 |
| Computer aided design CAD and computer aided manufacturing CAM system | 2 | 0 (0%) | 0 |
| Gateway software | 2 | 0 (0%) | 0 |
| Interactive voice response software | 2 | 0 (0%) | 0 |
| License management software | 2 | 0 (0%) | 0 |
| Mailing and shipping software | 2 | 0 (0%) | 0 |
| Mobile messaging service software | 2 | 0 (0%) | 0 |
| Storage media loading software | 2 | 0 (0%) | 0 |
| Audit software | 1 | 0 (0%) | 0 |
| Bridge software | 1 | 0 (0%) | 0 |
| Computer imaging software | 1 | 0 (0%) | 0 |
| Fax software | 1 | 0 (0%) | 0 |
| LAN software | 1 | 0 (0%) | 0 |
| Manufacturing execution system MES software | 1 | 0 (0%) | 0 |
| Software defined networking/ virtualization software | 1 | 0 (0%) | 0 |
| Text to speech conversion software | 1 | 0 (0%) | 0 |
| Voice synthesizer and recognition software | 1 | 0 (0%) | 0 |
| Wireless software | 1 | 0 (0%) | 0 |
