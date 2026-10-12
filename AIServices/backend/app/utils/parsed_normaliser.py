"""
Normalises freshly parsed CV data so it always fits the profile limits
(app/constants/profile_limits.py ↔ CoreServices profileLimits.json):
trims, strips control characters, truncates text, caps list sizes,
de-duplicates skills case-insensitively and normalises dates to the stored
form. Every field that had to be truncated or dropped, and every required
field that is missing, is listed in the entry's `needsReview`.

The result is what gets stored, so CV import → profile save never fails on
limits; only the fields flagged for review can still need the user.
"""

import re
from typing import Dict, List

from app.constants.profile_limits import PROFILE_LIMITS
from app.services.date_parser import is_future, normalize_stored_date, stored_compare
from app.services.extractors.common import is_github_repo_url, normalise_url

L = PROFILE_LIMITS
TITLE, ORG, DESC, LOCATION = L["titleMax"], L["orgMax"], L["descriptionMax"], L["locationMax"]
SKILL_MAX, SKILLS_TOTAL, TECH_MAX = L["skill"]["max"], L["skill"]["maxTotal"], L["technologiesMax"]
ENTRIES = L["maxEntries"]
_CONTROL = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")


def clean(value, multiline: bool = False) -> str:
    if not isinstance(value, str):
        return ""
    text = _CONTROL.sub("", value.replace("\r\n", "\n").replace("\r", "\n"))
    if not multiline:
        text = re.sub(r"[\t\n]+", " ", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return text.strip()


class _Entry:
    """Builds one normalised entry and its needsReview list."""

    def __init__(self, raw: Dict):
        self.raw = raw if isinstance(raw, dict) else {}
        self.out: Dict = {}
        self.review: List[str] = [f for f in self.raw.get("needsReview") or [] if isinstance(f, str)]

    def flag(self, field: str):
        if field not in self.review:
            self.review.append(field)

    def text(self, field: str, max_length: int, required: bool = False, multiline: bool = False):
        value = clean(self.raw.get(field), multiline)
        if len(value) > max_length:
            value = value[:max_length].rstrip()
            self.flag(field)
        if required and not value:
            self.flag(field)
        self.out[field] = value

    def date(self, field: str, years_ahead: int = L["dates"]["educationEndFutureYears"]):
        stored = normalize_stored_date(self.raw.get(field) or "", years_ahead)
        if stored is None:
            stored = ""
            self.flag(field)
        self.out[field] = stored

    def url(self, field: str, github_only: bool = False):
        raw = clean(self.raw.get(field))
        value = normalise_url(raw) if raw else ""
        if value and github_only and not is_github_repo_url(value):
            value = ""
        if raw and not value:
            self.flag(field)
        self.out[field] = value

    def names(self, field: str, max_items: int):
        seen, items = set(), []
        for item in self.raw.get(field) or []:
            name = clean(item if isinstance(item, str) else "")
            if name and len(name) <= SKILL_MAX and name.lower() not in seen:
                seen.add(name.lower())
                items.append(name)
        if len(items) > max_items:
            self.flag(field)
        self.out[field] = items[:max_items]

    def done(self, **extra) -> Dict:
        confidence = self.raw.get("confidence", 1.0)
        confidence = confidence if isinstance(confidence, (int, float)) and 0 <= confidence <= 1 else 1.0
        return {**self.out, **extra, "confidence": confidence, "needsReview": self.review}


def _skills(raw: List) -> List[Dict]:
    seen, out = set(), []
    for skill in raw or []:
        name = clean(skill.get("name") if isinstance(skill, dict) else skill)
        if not name or len(name) > SKILL_MAX or name.lower() in seen:
            continue
        seen.add(name.lower())
        confidence = skill.get("confidence", 1.0) if isinstance(skill, dict) else 1.0
        out.append({"name": name, "confidence": confidence if isinstance(confidence, (int, float)) else 1.0})
    return out[:SKILLS_TOTAL]


def _experience(raw: Dict) -> Dict:
    e = _Entry(raw)
    e.text("title", TITLE, required=True)
    e.text("company", ORG, required=True)
    e.text("location", LOCATION)
    e.text("description", DESC, multiline=True)
    e.text("duration", 100)
    e.date("startDate", years_ahead=1)
    e.date("endDate")
    current = raw.get("current") is True
    start, end = e.out["startDate"], e.out["endDate"]
    if not start or is_future(start):
        e.flag("startDate")
    if current:
        e.out["endDate"] = ""
    elif not end or is_future(end):
        e.flag("endDate")
    elif start and stored_compare(start, end) > 0:
        e.out["endDate"] = ""
        e.flag("endDate")
    return e.done(current=current)


def _education(raw: Dict) -> Dict:
    e = _Entry(raw)
    e.text("degree", TITLE, required=True)
    e.text("institution", ORG, required=True)
    e.text("field", TITLE)
    e.text("gpa", L["gpaMax"])
    e.date("startDate")
    e.date("endDate")
    if e.out["startDate"] and e.out["endDate"] and stored_compare(e.out["startDate"], e.out["endDate"]) > 0:
        e.out["endDate"] = ""
        e.flag("endDate")
    year = (e.out["endDate"] or e.out["startDate"])[:4] or clean(raw.get("year"))[:10] or None
    return e.done(year=year)


def _certification(raw: Dict) -> Dict:
    e = _Entry(raw)
    e.text("name", TITLE, required=True)
    e.text("issuer", ORG, required=True)
    e.date("date", years_ahead=0)
    if e.out["date"] and is_future(e.out["date"]):
        e.out["date"] = ""
        e.flag("date")
    e.url("url")
    return e.done()


def _project(raw: Dict) -> Dict:
    e = _Entry(raw)
    e.text("name", TITLE, required=True)
    e.text("description", DESC, multiline=True)
    e.names("technologies", TECH_MAX)
    e.url("githubUrl", github_only=True)
    e.url("liveUrl")
    return e.done()


def _keep(entry: Dict, *fields: str) -> bool:
    return any(entry.get(f) for f in fields)


def normalise_parsed(parsed: Dict) -> Dict:
    """Parsed lists → limit-conforming lists (same keys), ready to store."""
    parsed = parsed or {}

    def entries(key, fn, keep_fields, max_items):
        items = [fn(x) for x in parsed.get(key) or [] if isinstance(x, dict)]
        return [x for x in items if _keep(x, *keep_fields)][:max_items]

    return {
        "skills": _skills(parsed.get("skills")),
        "experience": entries("experience", _experience, ("title", "company"), ENTRIES["experience"]),
        "education": entries("education", _education, ("degree", "institution"), ENTRIES["education"]),
        "certifications": entries("certifications", _certification, ("name",), ENTRIES["certifications"]),
        "projects": entries("projects", _project, ("name",), ENTRIES["projects"]),
    }
