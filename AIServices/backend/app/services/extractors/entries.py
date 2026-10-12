"""
Experience and education extraction (SDS §4.1.1 Stage 4) with dates.

A section is cut into blocks: a non-bullet line starts or continues an entry
header (at most 3 header lines); bullet lines are the entry's description.
The date range is looked up on the header lines (Algorithm 4) and removed
from the title/company/degree text. Each entry lists the required fields
that are missing or uncertain in `needsReview`.
"""

import re
from typing import Callable, Dict, List, Optional

from app.constants.profile_limits import PROFILE_LIMITS
from app.services.date_parser import find_date_range
from app.services.extractors.common import is_bullet, remove_span, strip_bullet, tidy

EDU_END_YEARS = PROFILE_LIMITS["dates"]["educationEndFutureYears"]

JOB_WORDS = [
    "intern", "internship", "engineer", "developer", "programmer", "manager", "director",
    "analyst", "architect", "specialist", "consultant", "coordinator", "officer",
    "executive", "administrator", "designer", "lead", "head", "scientist", "researcher",
    "assistant", "associate", "trainee", "teacher", "lecturer", "instructor", "technician",
    "tester", "qa", "devops", "sre", "founder", "co-founder", "cofounder", "freelancer",
    "contractor", "representative", "supervisor", "president", "cto", "ceo", "accountant",
]
TITLE_RE = re.compile(r"\b(?:" + "|".join(re.escape(w) for w in JOB_WORDS) + r")s?\b", re.IGNORECASE)

# Long degree words (any case) and short abbreviations (as written: "BS", "MSc").
DEGREE_LONG = re.compile(
    r"\b(?:bachelor(?:'s|s)?|master(?:'s|s)?|doctorate|ph\.?\s?d|diploma|associate degree"
    r"|matric(?:ulation)?|intermediate|o[\s-]?levels?|a[\s-]?levels?)\b",
    re.IGNORECASE,
)
DEGREE_SHORT = re.compile(
    r"(?<![\w.])(?:B\.?S\.?c?|B\.?E\.?|B\.?A\.?|B\.?Tech|M\.?S\.?c?|M\.?A\.?|M\.?E\.?|M\.?Tech|MBA|BBA|MPhil|M\.Phil"
    r"|BSCS|BSSE|BSIT|BSEE|MSCS|FSc|F\.Sc|ICS|I\.Com|HSSC|SSC|PhD|Ph\.D\.?)(?![\w])"
)
INSTITUTION_RE = re.compile(
    r"\b(?:university|college|institute|school|academy|polytechnic|campus|nuces|comsats|nust|lums|giki)\b",
    re.IGNORECASE,
)
GPA_RE = re.compile(r"\b(?:c?gpa|grade)\s*[:\-]?\s*([\d.]+(?:\s*/\s*[\d.]+)?)", re.IGNORECASE)
_PART_SPLIT = re.compile(r"\s*[|•·]\s*|\s+[–—-]\s+|\s*,\s*")


def has_degree(text: str) -> bool:
    return bool(DEGREE_LONG.search(text) or DEGREE_SHORT.search(text))


def _parts(line: str) -> List[str]:
    return [tidy(p) for p in _PART_SPLIT.split(line) if tidy(p)]


def split_blocks(lines: List[str], starts_new: Callable[[Dict, str], bool]) -> List[Dict]:
    """Group lines into {'header': [...], 'body': [...]} blocks."""
    blocks: List[Dict] = []
    current: Optional[Dict] = None
    for raw in lines:
        line = raw.strip()
        if not line:
            if current:
                current["closed"] = True
            continue
        if is_bullet(line):
            if current is None:
                current = {"header": [], "body": []}
                blocks.append(current)
            current["body"].append(strip_bullet(line))
            continue
        if current is None or current["body"] or current.get("closed") or starts_new(current, line):
            current = {"header": [line], "body": []}
            blocks.append(current)
        elif len(current["header"]) >= 3:
            current["body"].append(line)
        else:
            current["header"].append(line)
    return blocks


def _date_from_header(block: Dict, start_years_ahead: int = 1):
    """Find the date range on the header lines (or a short first body line) and cut it out."""
    header = list(block["header"])
    for i, line in enumerate(header):
        found = find_date_range(line, start_years_ahead)
        if found:
            header[i] = tidy(remove_span(line, found["span"]))
            return found, [h for h in header if h], block["body"]
    body = list(block["body"])
    for i, line in enumerate(body[:2]):
        if len(line) <= 40:
            found = find_date_range(line, start_years_ahead)
            if found:
                rest = tidy(remove_span(line, found["span"]))
                body = body[:i] + ([rest] if rest else []) + body[i + 1:]
                return found, [tidy(h) for h in header if tidy(h)], body
    return None, [tidy(h) for h in header if tidy(h)], body


# ── Experience ───────────────────────────────────────────────────────────────
def _experience_starts_new(current: Dict, line: str) -> bool:
    header = " ".join(current["header"])
    if find_date_range(line) and find_date_range(header):
        return True
    return bool(TITLE_RE.search(line) and TITLE_RE.search(header) and len(current["header"]) >= 2)


def _title_company(lines: List[str], org_finder) -> tuple:
    title = company = location = ""
    if not lines:
        return title, company, location
    first = lines[0]
    at = re.match(r"^(.+?)\s+(?:at|@)\s+(.+)$", first, re.IGNORECASE)
    if at and TITLE_RE.search(at.group(1)):
        title = tidy(at.group(1))
        rest = _parts(at.group(2))
        company, location = (rest[0] if rest else ""), ", ".join(rest[1:])
    else:
        parts = _parts(first)
        if len(parts) >= 2:
            title_idx = next((i for i, p in enumerate(parts) if TITLE_RE.search(p)), 0)
            title = parts[title_idx]
            others = [p for i, p in enumerate(parts) if i != title_idx]
            company, location = others[0], ", ".join(others[1:])
        elif parts and TITLE_RE.search(parts[0]):
            title = parts[0]
        elif parts:
            company = parts[0]
    for extra in lines[1:3]:
        parts = _parts(extra)
        if not parts:
            continue
        if not title and TITLE_RE.search(extra):
            title = parts[0]
            if not company and len(parts) > 1:
                company, location = parts[1], location or ", ".join(parts[2:])
        elif not company:
            company, location = parts[0], location or ", ".join(parts[1:])
        elif not location:
            location = ", ".join(parts)
    if not company and org_finder:
        company = org_finder(" ".join(lines)) or ""
        if company and title and company.lower() in title.lower():
            company = ""
    return title, company, location


def extract_experience(section: str, org_finder=None) -> List[Dict]:
    entries: List[Dict] = []
    for block in split_blocks(section.splitlines(), _experience_starts_new):
        found, header, body = _date_from_header(block)
        title, company, location = _title_company(header, org_finder)
        if not (title or company):
            continue
        dates = found or {"startDate": "", "endDate": "", "current": False, "flags": [], "text": ""}
        review = [f for f, v in (("title", title), ("company", company), ("startDate", dates["startDate"])) if not v]
        if not dates["current"] and not dates["endDate"] and "endDate" not in review:
            review.append("endDate")
        review += [f for f in dates["flags"] if f not in review]
        entries.append({
            "title": title,
            "company": company,
            "location": location,
            "startDate": dates["startDate"],
            "endDate": dates["endDate"],
            "current": dates["current"],
            "duration": dates.get("text", ""),
            "description": "\n".join(body),
            "confidence": 0.85 if title and company and dates["startDate"] else 0.6,
            "needsReview": review,
        })
    unique: Dict[tuple, Dict] = {}
    for e in entries:
        unique.setdefault((e["title"].lower(), e["company"].lower(), e["startDate"]), e)
    return list(unique.values())


# ── Education ────────────────────────────────────────────────────────────────
def _education_starts_new(current: Dict, line: str) -> bool:
    header = " ".join(current["header"])
    if has_degree(line) and has_degree(header):
        return True
    if INSTITUTION_RE.search(line) and INSTITUTION_RE.search(header) and has_degree(header):
        return True
    return bool(find_date_range(line, EDU_END_YEARS) and find_date_range(header, EDU_END_YEARS))


_SHORT_DEGREE_PREFIX = re.compile(r"^(" + DEGREE_SHORT.pattern + r")\s*(?:\(|in\b|of\b|-)?\s*(.*)$")


def _degree_and_field(text: str) -> tuple:
    t = tidy(text)
    m = re.match(r"^(.*?\b(?:bachelor|master|doctor|diploma|ph\.?\s?d)[^,]*?)\s+in\s+(.+)$", t, re.IGNORECASE)
    if m:
        return tidy(m.group(1)), tidy(m.group(2))
    m = _SHORT_DEGREE_PREFIX.match(t)
    if m and m.group(2):
        return tidy(m.group(1)), tidy(m.group(2).rstrip(")"))
    return t, ""


def extract_education(section: str, org_finder=None) -> List[Dict]:
    entries: List[Dict] = []
    for block in split_blocks(section.splitlines(), _education_starts_new):
        found, header, body = _date_from_header(block, EDU_END_YEARS)
        text_lines = header + body[:1]
        degree = field = institution = gpa = ""
        for line in text_lines:
            g = GPA_RE.search(line)
            if g and not gpa:
                gpa = g.group(1).replace(" ", "")
                line = tidy(line[: g.start()] + line[g.end():])
            for part in _parts(line):
                if not degree and has_degree(part):
                    degree, field = _degree_and_field(part)
                elif not institution and INSTITUTION_RE.search(part):
                    institution = part
        if not institution and org_finder:
            institution = org_finder(" ".join(header)) or ""
            if institution and degree and institution.lower() in degree.lower():
                institution = ""
        if not institution:
            rest = [p for line in header for p in _parts(line) if p != degree and not has_degree(p)]
            institution = rest[0] if rest else ""
        if not (degree or institution):
            continue
        dates = found or {"startDate": "", "endDate": "", "current": False, "flags": [], "text": ""}
        start, end = dates["startDate"], dates["endDate"]
        if start and not end and not dates["current"] and not re.search(r"since|from", dates.get("text", ""), re.I):
            start, end = "", start  # a single year is the graduation year
        review = [f for f, v in (("degree", degree), ("institution", institution)) if not v]
        review += [f for f in dates["flags"] if f not in review]
        entries.append({
            "degree": degree,
            "field": field,
            "institution": institution,
            "startDate": start,
            "endDate": end,
            "year": (end or start)[:4] or None,
            "gpa": gpa,
            "confidence": 0.85 if degree and institution else 0.65,
            "needsReview": review,
        })
    unique: Dict[tuple, Dict] = {}
    for e in entries:
        unique.setdefault((e["degree"].lower(), e["institution"].lower()), e)
    return list(unique.values())
