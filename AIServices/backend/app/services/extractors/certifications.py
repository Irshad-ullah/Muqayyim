"""
Certification extraction (FR4.6).

Inside a certifications section every line is a certification:
  "AWS Certified Cloud Practitioner – Amazon Web Services (2023)"
  "Google Data Analytics Certificate | Coursera | 2022"
  "Meta Front-End Developer, Coursera, Jan 2023"
  "Azure Fundamentals — Issued by Microsoft"
The date (Algorithm 4) and any link are cut out first; "issued by / by /
from X" names the issuer; otherwise the line is split on – — - | , and the
issuer is the part that is a known issuer (app/data/known_issuers.json), else
the part after the name. A line holding only "Issued by …", a date or a link
continues the previous certification. A missing issuer is left empty and
flagged in needsReview (the profile requires it, FR5.6).

Outside that section a line counts only if it has a known issuer AND a
certification word (certified / certificate / certification) and does not
start with an action verb — precision over recall.
"""

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from app.constants.profile_limits import PROFILE_LIMITS
from app.services.date_parser import find_date_range
from app.services.extractors.common import URL_RE, normalise_url, remove_span, strip_bullet, tidy

ISSUERS_FILE = Path(__file__).resolve().parents[2] / "data" / "known_issuers.json"
MAX_CERTIFICATIONS = PROFILE_LIMITS["maxEntries"]["certifications"]
CERT_WORD = re.compile(r"\bcertifi(?:ed|cates?|cations?)\b", re.IGNORECASE)
ISSUED_BY = re.compile(r"(?:^|\s|[|,–—-])\s*(?:issued\s+by|offered\s+by|awarded\s+by|by|from)\s+(.+)$", re.IGNORECASE)
ACTION_START = re.compile(
    r"^(?:built|developed|implemented|designed|created|used|worked|led|wrote|added|integrated|managed|helped)\b",
    re.IGNORECASE,
)
_SPLIT = re.compile(r"\s*[|–—]\s*|\s+-\s+|\s*,\s*")


@lru_cache(maxsize=1)
def _issuers() -> List[Tuple[str, re.Pattern]]:
    data = json.loads(ISSUERS_FILE.read_text(encoding="utf8"))
    patterns = []
    for issuer in data["issuers"]:
        for alias in sorted([issuer["name"], *issuer.get("aliases", [])], key=len, reverse=True):
            patterns.append((issuer["name"], re.compile(rf"(?<![\w.]){re.escape(alias)}(?![\w])", re.IGNORECASE)))
    # Longest aliases first so "Google Cloud" wins over "Google".
    return sorted(patterns, key=lambda p: len(p[1].pattern), reverse=True)


def find_issuer(text: str) -> Optional[str]:
    for name, pattern in _issuers():
        if pattern.search(text or ""):
            return name
    return None


def _canonical_issuer(text: str) -> str:
    text = tidy(text)
    known = find_issuer(text)
    if known and len(text) <= len(known) + 25:
        return known
    return text


def parse_certification_line(line: str) -> Dict:
    """One line → {name, issuer, date, url, needsReview}; name may be '' for continuation lines."""
    text = strip_bullet(line)
    url = ""
    for match in URL_RE.finditer(text):
        url = url or normalise_url(match.group(0))
    text = URL_RE.sub(" ", text)

    date = ""
    found = find_date_range(text)
    if found:
        date = found["startDate"]
        text = remove_span(text, found["span"])

    issuer = ""
    by = ISSUED_BY.search(text)
    if by:
        issuer = _canonical_issuer(_SPLIT.split(by.group(1))[0])
        text = text[: by.start()]

    parts = [tidy(p) for p in _SPLIT.split(text) if tidy(p)]
    name = parts[0] if parts else ""
    others = parts[1:]
    if not issuer:
        known = next((find_issuer(p) for p in others if find_issuer(p)), None)
        if known:
            issuer = known
            others = [p for p in others if find_issuer(p) != known]
        elif others and len(others[0].split()) <= 6 and not CERT_WORD.search(others[0]):
            issuer = others.pop(0)
        elif name:
            issuer = find_issuer(name) or ""  # e.g. "Microsoft Certified: Azure Fundamentals"
    if others and name:
        # Extra parts that are not the issuer belong to the name ("X, Y Specialization").
        name = ", ".join([name, *others]) if not issuer or len(others) < 2 else name
    review = [f for f, v in (("name", name), ("issuer", issuer)) if not v]
    return {"name": name, "issuer": issuer, "date": date, "url": url, "confidence": 0.85 if issuer else 0.6, "needsReview": review}


def extract_certifications(section: Optional[str], full_text: str) -> List[Dict]:
    certs: List[Dict] = []
    for raw in (section or "").splitlines():
        if not raw.strip():
            continue
        cert = parse_certification_line(raw)
        if not cert["name"] and certs:
            prev = certs[-1]  # continuation: "Issued by …", a date or a link
            for key in ("issuer", "date", "url"):
                if cert[key] and not prev[key]:
                    prev[key] = cert[key]
            prev["needsReview"] = [f for f in prev["needsReview"] if not prev.get(f)]
            if prev["issuer"]:
                prev["confidence"] = 0.85
            continue
        if cert["name"]:
            certs.append(cert)

    section_lines = {l.strip() for l in (section or "").splitlines() if l.strip()}
    for raw in full_text.splitlines():
        line = strip_bullet(raw)
        if not line or raw.strip() in section_lines or len(line) > 150:
            continue
        if CERT_WORD.search(line) and find_issuer(line) and not ACTION_START.match(line):
            cert = parse_certification_line(line)
            if cert["name"]:
                certs.append({**cert, "confidence": min(cert["confidence"], 0.7)})

    unique: Dict[str, Dict] = {}
    for c in certs:
        unique.setdefault(c["name"].lower(), c)
    return list(unique.values())[:MAX_CERTIFICATIONS]
