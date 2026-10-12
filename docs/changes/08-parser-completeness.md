# 08 — CV parser completeness: DOC support, file signatures, dates, certifications, better projects

**Status:** implemented · **Date:** 2026-10-12 · **Affects:** AIServices (main), CoreServices (backend and frontend)
**Requirements:** SRS Module 2 FE-1/FE-2, FR4.2, FR4.6, LI-1; Business Rule 1

## Summary

The parser used to:
- accept files by extension only;
- fail on every real `.doc` file;
- return nothing at all for scanned PDFs, with no explanation;
- keep experience dates as a raw `duration` string and education as a bare `year`;
- ignore certifications;
- turn description lines into project names, some longer than 100 characters (the data report in 06 found these).

Now:

- **Files are checked by content.** Magic bytes must match the extension, and password-protected files are refused with their own error code.
- **`.doc` works when LibreOffice is installed.** The file is converted to `.docx` headlessly and then goes through the DOCX path. Without LibreOffice, the user gets a clear `DOC_UNSUPPORTED` message.
- **Scanned or empty documents** fail with `NO_TEXT_FOUND` instead of returning empty results silently.
- **Experience and education have real dates** in the profile's stored format (`YYYY-MM`, `YYYY`, `current`), parsed by a new date-range algorithm.
- **Certifications are extracted** with name, issuer and date.
- **Project detection is stricter.** Sentences, bullets, verb-led lines, long lines and URL/date lines are never names. GitHub and live links are captured.
- **Everything the parser returns fits the profile limits.** Missing or uncertain required fields are listed in `needsReview`. The review screen highlights them and blocks "Confirm & Save" until they are filled. The server's verify step enforces the same rules, so a verified CV always imports into the profile.

**LibreOffice on this machine:** **not installed.** There is no `soffice` on PATH and nothing in `C:\Program Files\LibreOffice` or `C:\Program Files (x86)\LibreOffice`. `.doc` uploads therefore return `DOC_UNSUPPORTED` here. Install LibreOffice (free) or set `LIBREOFFICE_PATH` to enable them; no code change is needed. The real-`.doc` test runs automatically once it's installed.

**OCR is out of scope (SRS LI-1).** Scanned or image-only CVs are detected and rejected with a clear message, but not read.

## Supported formats and error codes

| Format | Signature check (Business Rule 1) | Text extraction |
|---|---|---|
| PDF | `%PDF-` within the first 1 KB | PyPDF2 |
| DOCX | ZIP header `PK\x03\x04`, and the archive contains `word/document.xml` | python-docx (paragraphs and tables) |
| DOC | OLE2 header `D0 CF 11 E0 A1 B1 1A E1` with a `WordDocument` stream | LibreOffice headless → `.docx` → python-docx |

Extensions other than these, and files over 5 MB, are rejected as before.

All errors use the shape `{ success: false, code, message }`:

| Code | When | HTTP | Message | CV status |
|---|---|---|---|---|
| `INVALID_FILE_TYPE` | Content doesn't match the extension (e.g. a PNG or DOCX renamed `.pdf`) | 400 at upload (nothing stored); 422 if a stored file fails at parse time | "The file content does not match its extension. Upload a PDF, DOC or DOCX file." | unchanged at upload; `failed` at parse |
| `ENCRYPTED_FILE` | A PDF that won't open with an empty password, or an Office file stored as an OLE2 `EncryptedPackage` | 400 at upload; 422 at parse | "This file is password-protected. Remove the password, save it again and upload the new file." | as above |
| `DOC_UNSUPPORTED` | LibreOffice missing; conversion timed out (30 s), failed or produced no output | 422 | "Old .doc files could not be processed. Please save as PDF or DOCX and upload again." | `failed` |
| `NO_TEXT_FOUND` | Fewer than `MIN_TEXT_CHARS = 100` non-whitespace characters extracted (scanned, image-only or empty) | 422 | "No readable text was found. This may be a scanned document. Please upload a text-based PDF or DOCX." | `failed` |

**Logging:** every parse-time error is logged as a `warning` (the user can fix it) with the code as `errorType`. "LibreOffice missing" also gets its own `LIBREOFFICE_MISSING` warning, at most once per minute.

**Status flow is unchanged:** `uploaded` → `processing` → `parsed`/`failed` → `verified`.

### LibreOffice detection and conversion (`app/services/doc_converter.py`)
1. **Finding soffice:**
   - `LIBREOFFICE_PATH`, if it points to an existing file. If it's set but wrong, a warning is logged and the search continues.
   - Otherwise `soffice` or `libreoffice` on PATH.
   - Otherwise common install paths:
     - Windows: `C:\Program Files\LibreOffice\program\soffice.exe` and the `(x86)` equivalent.
     - Linux: `/usr/bin/soffice`, `/usr/local/bin/soffice`, `/usr/lib/libreoffice/program/soffice`, `/opt/libreoffice*/program/soffice`, `/snap/bin/libreoffice`.
     - macOS: the app bundle.
2. **Converting:**
   - A fresh `TemporaryDirectory` holds a copy of the file. The command is `soffice --headless --norestore --nologo -env:UserInstallation=<tmp profile> --convert-to docx --outdir <tmp> input.doc`.
   - The private profile means an already-open LibreOffice can't block the conversion.
   - Timeout is `DOC_CONVERT_TIMEOUT_SECONDS` (default 30). The temp directory is always removed.
   - The parse runs in a worker thread (`asyncio.to_thread`), so a conversion never blocks other requests.
3. **New env settings:** `LIBREOFFICE_PATH` (empty means auto-detect) and `DOC_CONVERT_TIMEOUT_SECONDS`. Both are documented in `AIServices/backend/.env.example`.

## Date formats handled (Algorithm 4, `app/services/date_parser.py`)

**Output** (the profile's stored format, FR5.3/FR5.4): `{ startDate: 'YYYY-MM' | 'YYYY' | '', endDate: same | '', current: bool }`.

| Input | Result |
|---|---|
| `Jan 2020 – Present`, `Jan 2020 - Present` | `2020-01`, current |
| `January 2020 - March 2022`, `January 2020 — March 2022` | `2020-01` → `2022-03` |
| `01/2020 - 03/2022`, `1/2020 – 3/2022` | `2020-01` → `2022-03` |
| `2020/01 – 2022/03` | `2020-01` → `2022-03` |
| `2019 - 2021`, `2019-2021` | `2019` → `2021` |
| `2019 – Current`, `2021 – Now`, `2020 till date` | start, current |
| `Mar'21 – Jun'22` (also `’`), `Sept. 2020 – Dec 2020` | `2021-03` → `2022-06`, `2020-09` → `2020-12` |
| `Since 2021`, `since March 2021`, `Ongoing since 2023` | start, current |
| `2018 to 2020`, `Feb 2019 till Aug 2020` | range |
| `2022` | start only (education: a lone year is the **graduation** year → end date) |

**Grammar:**
- **Separators:** `-` `–` `—` `−` `~`, or the words `to` / `till` / `until` / `through`.
- **Words meaning present:** present, current(ly), now, ongoing, till date, to date, till now.
- **Two-digit years:** `'21` → 2021, unless that would be in the future, in which case 19xx.

**Rejected:**
- a month above 12;
- a year before 1950;
- a start year after next year (a lone education year may be up to 10 years ahead);
- an end year more than 10 years ahead.

**End before start:** the start is kept, the end dropped, and `endDate` added to `needsReview`.

**Where it's applied:** the parser searches the entry's header lines (up to 3) and the first 2 description lines when they're short. The matched text is removed from the title, company or degree.

The algorithm is deterministic: regexes plus a month map, with no new dependency.

## Certification rules (FR4.6)

- **Section headings** (added to the splitter): certifications, certificates, certification, licenses/licences & certifications, licenses and certifications, licenses, licences, courses & certifications, achievements & certifications, awards & certifications.
- **Per line**, in this order:
  1. A link is cut out and goes to `url`.
  2. The date is cut out (Algorithm 4; the first date is the issue date).
  3. "issued by / offered by / awarded by / by / from X" names the issuer.
  4. Otherwise the line is split on `– — - | ,`. The name is the first part. The issuer is the part that is a **known issuer**, or else the next short part, or else a known issuer inside the name (e.g. "Microsoft Certified: Azure Fundamentals" → Microsoft).
- **Continuation lines:** a line with only "Issued by …", a date or a link completes the certification above it.
- **Known issuers** live in `app/data/known_issuers.json`, with aliases mapping to the stored name (AWS → Amazon Web Services):
  - Coursera, Udemy, edX, Google, Amazon Web Services, Microsoft, Meta, IBM
  - Oracle, Cisco, CompTIA, HackerRank, LinkedIn Learning, DataCamp, freeCodeCamp, Kaggle
  - NVIDIA, Hugging Face, Pluralsight, Udacity, DigiSkills, PMI, Scrum.org
- **Missing issuer:** `issuer: ''` with `needsReview: ['issuer']` (the profile requires an issuer, FR5.6).
- **Outside the section:** a line counts only if it has a known issuer **and** a certification word (certified / certificate / certification), doesn't start with an action verb, and is at most 150 characters. For example, "Worked with Google Cloud…" isn't picked up, and neither is "Built a certificate generator using Google APIs".

| Example | name | issuer | date |
|---|---|---|---|
| AWS Certified Cloud Practitioner – Amazon Web Services (2023) | AWS Certified Cloud Practitioner | Amazon Web Services | 2023 |
| Google Data Analytics Certificate \| Coursera \| 2022 | Google Data Analytics Certificate | Coursera | 2022 |
| Meta Front-End Developer, Coursera, Jan 2023 | Meta Front-End Developer | Coursera | 2023-01 |
| Azure AI Fundamentals — Issued by Microsoft | Azure AI Fundamentals | Microsoft | |
| Machine Learning Specialization | Machine Learning Specialization | *(empty, needsReview)* | |

## Project heuristics (Algorithm 3, revised — `app/services/extractors/projects.py`)

**A line is never a project name if it:**
- is longer than the profile's title limit (100);
- ends with a period;
- is a bullet;
- starts with an action verb (about 40 of them: built, developed, implemented, designed, created, used, worked, led, deployed, …);
- has more than 12 words;
- is mostly a URL or a date;
- is a `Label:` line (Technologies:, GitHub:, …);
- starts lowercase (a wrapped continuation).

**Header forms:**

| Form | Result |
|---|---|
| `Name \| React, Node` | technologies from the right side |
| `Name – short tagline` / `Name: tagline` | tagline becomes the first line of the description |
| `Name (React, Socket.io)` | technologies |

**Blocks:** a new project starts only once the current one has a description, unless the line is clearly a header (`|`, or a short name before a dash or colon). Bullets and other lines belong to the current project.

**Links:**
- A GitHub repository URL (`https://github.com/<owner>/<repo>`, normalised) goes to `githubUrl`.
- Any other valid http(s) link goes to `liveUrl`.
- Links are removed from the description.

**Unchanged:** technologies come from the header plus known skills in the name and description, and there are still at most 10 projects.

## Experience and education extraction (Stage 4, `app/services/extractors/entries.py`)

- **Blocks:** a non-bullet line starts or continues an entry header (at most 3 lines); bullet lines become the description. A new entry starts when a second date range or a second job title appears.
- **Experience header forms:** "Title at/@ Company", "Title | Company | City", "Title – Company", "Company — Title", and "Title" with "Company, City" on the next line. Job titles are matched against a word list (engineer, developer, intern, analyst, manager, …). spaCy ORG entities are the fallback for the company.
- **Education:**
  - **Degree:** long words (bachelor, master, matric, intermediate, …) or abbreviations as written (BS, BSc, MS, BSCS, FSc, ICS, MBA, PhD, …).
  - **Degree vs field:** split on "in" ("Bachelor of Science in Software Engineering") or after an abbreviation ("BS Computer Science").
  - **Institution:** found by keyword (University, College, Institute, NUCES, NUST, …) or spaCy ORG.
  - **GPA:** `CGPA 3.4/4.0`.
- **New fields:**
  - experience: `location`, `startDate`, `endDate`, `current`, `description`;
  - education: `field`, `startDate`, `endDate`, `gpa`;
  - projects: `githubUrl`, `liveUrl`;
  - a new `certifications` list.

  `duration` and `year` are kept, so older consumers keep working.
- **Removed:** the old "Unknown Title" / "Unknown Company" placeholders. Missing values are now empty and flagged instead.

## needsReview behaviour

- **What it is:** every experience, education, certification and project entry carries `needsReview: [fieldNames]`.
- **Which fields are flagged:**
  - **Missing required fields:** experience title, company, startDate, and endDate unless current; education degree and institution; certification name and issuer.
  - **Uncertain values:** an end date dropped because it came before the start; a future date.
  - **Values the normaliser had to change:** truncated text, an invalid link dropped, more technologies than allowed.
- **Normaliser** (`app/utils/parsed_normaliser.py`, Stage 5, replacing `limits_fit.py`):
  - trims text and strips control characters;
  - truncates to `profileLimits.json` lengths;
  - caps lists;
  - dedupes skills case-insensitively;
  - normalises dates and links;
  - drops entries with no identifying text.

  The normalised result is what gets **stored**, so CV import → profile save can only fail on flagged fields. The integration tests and the live run confirm this.
- **Review screen** (CVParsingPage → ParsedSummary):
  - experience, education and certifications are editable cards (`ReviewEntries.jsx`);
  - flagged fields get an amber outline and a hint such as "Please add a start date", which clears when the field is edited;
  - rule errors show in red;
  - **"Confirm & Save" is disabled** until `validateParsedCv` (the same rules as the server) passes, with a list of what to fix.
- **Verify (server, decision 1):** `PUT /api/cv/verify` now also enforces the profile's required fields, date format, order and future checks, and link rules. Errors are 422 `VALIDATION_ERROR` with paths such as `verified_data.experience[1].startDate`. The saved verified data no longer contains `needsReview`.
- **Profile Builder Step 2:**
  - imports certifications, with a toggle list;
  - carries dates and `current` straight into the experience/education editor;
  - stores project links as `projects.cv[].url`.

  Older parses (only `duration`/`year`) still map through the date-range helper. A certification imported without an issuer can be fixed in place in Step 1.
- **CV generator source:** uses the parsed dates, certifications, GPA, field and links when the profile has none.

## Tests

| Suite | Before | After | New coverage |
|---|---|---|---|
| AIServices pytest | 53 | **187 passed + 1 skipped** | `test_file_checks.py` (21): magic bytes (PNG and DOCX renamed `.pdf`, PDF named `.docx`, …), valid files, encrypted PDF/Office, size, `NO_TEXT_FOUND` for image-only/short/empty files with status failed, `DOC_UNSUPPORTED` with LibreOffice missing (warning, 60 s dedupe), conversion failure, a mocked successful conversion through the DOCX path, `LIBREOFFICE_PATH` detection, temp-directory cleanup, and the real-LibreOffice test (**skipped: not installed**). `test_date_parser.py` (42, table-driven, every format above plus invalid input). `test_extraction.py` (43): experience/education dates and current flags, header forms, needsReview for missing values, all certification forms, headings, the precision rule outside the section, project negatives/positives, `Name \| React, Node`, GitHub/live links, cap of 10. `test_parsed_normaliser.py` (28): property-style over the fixture CV plus 25 generated worst cases, where every verify error must be a field the entry flags. `test_parse_integration.py` (2): PDF and DOCX upload → parse → latest → verify fails only on flagged fields → fill them → verified. |
| CoreServices Jest | 208 | **210** | `cvSourceParsed.test.js`: parsed dates, certifications and links reach the CV generator source (old-format fallback included); `projects.cv[].url` validated. The parity fixture covers `projects.cv[].url`. |
| Frontend `node --test` | 19 | **24** | `cvImport.test.js`: new and old parse shapes → profile; an imported profile fails only on flagged fields; manual entries kept; verify paths. |
| Frontend Vitest | 13 | **16** | `ParsedSummary.spec.jsx`: needsReview fields highlighted with hints; Verify disabled until filled (and stays disabled on an end-before-start error); certifications shown and counted. |
| API Gateway Jest | 42 | 42 | unchanged |

The production build succeeds.

**Fixtures are generated in-process.** PDFs come from a 40-line PDF writer in `tests/cv_fixtures.py`, an encrypted PDF from PyPDF2's own encryption, DOCX files from python-docx, and the `.doc` check from an OLE2 header. No binary files are committed and no dependency was added.

**Existing tests that changed:**
- Two old tests wrote junk bytes straight to disk as `.pdf`. These are now caught as `INVALID_FILE_TYPE`, still with processing → failed and 422. The tests assert the new code, and the logging test expects `errorType: INVALID_FILE_TYPE`.
- Two placeholders used `%PDF` without the dash and now use `%PDF-1.4`.
- The fake extractor gained `extract_certifications`.
- One verify test now sends dates, because verify requires a start date.
- The `limits_fit` test was replaced by the normaliser tests.

**Live check through the gateway** (Core :3100, AI :8100, Gateway :8180): **15 of 15 passed**. It covered:
- a PNG named `.pdf` → `INVALID_FILE_TYPE`;
- an encrypted PDF → `ENCRYPTED_FILE`;
- a `.doc` → `DOC_UNSUPPORTED` with the status failed;
- an image-only PDF → `NO_TEXT_FOUND`;
- PDF upload → parse → `GET /latest` (dated experience, 5 certifications, no project name over 100) → the **frontend's own import mapping** → `PUT /api/profile` fails only on flagged fields → after filling them, saved with dates, `current`, certifications and the project link;
- verify fails only on flagged fields, then succeeds after review;
- the DOCX path.

The test user, profile, parsed records, logs and the uploaded files were removed afterwards.

## SDS updates needed

**§4.1.1 Pipeline: Stages 1–4** (replace the stage descriptions):
1. **Stage 1, Upload and verification.** Extension and size are checked (≤ 5 MB). The **file signature** must match the extension (PDF `%PDF-`; DOCX ZIP with `word/document.xml`; DOC OLE2 `D0CF11E0A1B11AE1`), and encrypted files are refused (`INVALID_FILE_TYPE`, `ENCRYPTED_FILE`). Nothing is stored unless the file passes.
2. **Stage 2, Text extraction.**
   - PDF: PyPDF2.
   - DOCX: python-docx, paragraphs and tables.
   - DOC: converted to DOCX by LibreOffice headless (30 s timeout, isolated temp directory), then the DOCX path; when that isn't possible, `DOC_UNSUPPORTED`.
   - Text is cleaned line by line. Fewer than 100 non-whitespace characters means `NO_TEXT_FOUND` (no OCR, LI-1).
3. **Stage 3, Section splitting** (Algorithm 1), with certification headings added. Sections are looked up by exact heading, so "Project Experience" is no longer mistaken for work experience.
4. **Stage 4, Entity extraction:**
   - skills (Algorithm 2);
   - experience and education blocks with dates (Algorithm 4) and spaCy ORG as the fallback for company/institution;
   - certifications (FR4.6);
   - projects (Algorithm 3).
5. **Stage 5 (new), Normalisation:** results are fitted to the profile limits, `needsReview` is set, and the normalised result is stored.

**Algorithm 2 (skills):** add: "Camel-case tokens that are themselves known skills are mapped to their canonical phrase before matching (`JavaScript` → javascript, `ReactNative` → react native); other glued words are split (`PythonDjango` → Python Django). This fixes 'JavaScript' also producing 'Java'."

**Algorithm 3 (projects):** replace the title heuristic with the rules in *Project heuristics* above: the negative rules, the three header forms, the block rule, link capture, and the cap of 10.

**Algorithm 4 (new), Date-range parsing:**
1. Search the header line(s) for "since/from DATE", or DATE [SEP (DATE | PRESENT)].
2. A DATE is one of: Mon[.] YYYY, Mon'YY, MM/YYYY, YYYY/MM, YYYY.
3. Convert each side to (year, month?).
4. Reject: month > 12; year < 1950; a start year after next year; an end year more than 10 years ahead.
5. PRESENT → current = true, end = ''.
6. An end before the start → drop the end and flag it.
7. Output `YYYY-MM` / `YYYY`, and remove the matched text from the entry header.

**§4.2 Extraction table:** add the row **Certifications: name, issuer, date (FR4.6)**. Leave the precision/recall cells empty for Problem 10's evaluation.

**Table 4.2 (technologies):** add **LibreOffice (headless `soffice`)**, used to convert legacy `.doc` to `.docx` (optional runtime dependency, configured with `LIBREOFFICE_PATH`).

**Business Rule 1:** "A CV must be a PDF, DOC or DOCX file of at most 5 MB whose content signature matches its extension (PDF `%PDF-`, DOCX ZIP containing `word/document.xml`, DOC OLE2 compound file). Password-protected files are rejected. DOC files require LibreOffice on the server."

**Table 5.3 (error codes):** add these rows:

| Code | HTTP | Meaning |
|---|---|---|
| `INVALID_FILE_TYPE` | 400 at upload, 422 at parse | Content doesn't match the extension |
| `ENCRYPTED_FILE` | 400 at upload, 422 at parse | Password-protected file |
| `DOC_UNSUPPORTED` | 422 | `.doc` couldn't be converted (LibreOffice missing or failed) |
| `NO_TEXT_FOUND` | 422 | No readable text (scanned or empty) |
| `VALIDATION_ERROR` (verify) | 422 | Verified data breaks the profile rules (required fields, dates, links) |

## Notes

- **Removed or replaced files:** `app/utils/limits_fit.py` is replaced by `parsed_normaliser.py`. The unused review components `ExperienceSection.jsx` and `EducationSection.jsx` are replaced by `ReviewEntries.jsx`, which also handles certifications.
- **Project edits on the review screen** now keep `githubUrl`/`liveUrl`. The edit used to replace the whole project object.
- **Uploaded files after a failed parse** stay in `uploads/` as before; only a successful verify deletes them. This is unchanged here and could be a later cleanup task.
- **Doc number:** there is no `07` file; this is numbered 08 as requested.
