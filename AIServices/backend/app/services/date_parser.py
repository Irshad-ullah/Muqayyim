"""
Date-range parser for CV entries (SDS Algorithm 4).

Finds a date or date range in free text and returns it in the profile's
stored format (CoreServices FR5.3/FR5.4):
    { startDate: 'YYYY-MM' | 'YYYY' | '', endDate: same | '', current: bool,
      flags: [field names that need review], text: matched text, span: (start, end) }

Handles: "Jan 2020 – Present", "January 2020 - March 2022", "01/2020 - 03/2022",
"2020/01 – 2022/03", "2019 - 2021", "2019 – Current", "Mar'21 – Jun'22",
"Since 2021", "2021 – Now", "2020 till date", "2018 to 2020", a single "2022".
Separators: - – — to till until through. "Present / Current / Now / Ongoing /
Till date / To date" → current: true with an empty end date.

Impossible values are rejected: month > 12, year < 1950, a start year after
next year. An end before the start is dropped (start kept) and flagged.
Regex + month map only — deterministic, no extra dependencies.
"""

import re
from datetime import datetime, timezone
from typing import Optional

from app.constants.profile_limits import PROFILE_LIMITS

MIN_YEAR = PROFILE_LIMITS["dates"]["minYear"]
END_FUTURE_YEARS = PROFILE_LIMITS["dates"]["educationEndFutureYears"]

MONTHS = {
    "jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6,
    "jul": 7, "aug": 8, "sep": 9, "oct": 10, "nov": 11, "dec": 12,
}
_FULL_MONTHS = [
    "january", "february", "march", "april", "may", "june",
    "july", "august", "september", "october", "november", "december",
]

_MON = (
    r"(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?"
    r"|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)"
)
_APOS = r"['’‘`]"
DATE = (
    rf"(?:{_MON}\.?\s*{_APOS}\s*\d{{2}}(?!\d)"        # Mar'21
    rf"|{_MON}\.?,?\s+\d{{4}}"                         # Jan 2020, January, 2020, Sept. 2020
    r"|\d{1,2}[/.\-]\d{4}"                             # 01/2020
    r"|\d{4}[/.\-](?:1[0-2]|0?[1-9])(?![\d/.\-]*\d)"   # 2020/01 (not 2019-2021)
    r"|\d{4})"                                         # 2020
)
PRESENT = r"(?:present|current(?:ly)?|now|ongoing|till\s+date|to\s+date|till\s+now|date)"
_SEP = r"(?:\s*[-–—−~]+\s*|\s+(?:to|till|until|through)\s+)"

_RANGE_RE = re.compile(
    rf"(?<![\w])(?P<start>{DATE})(?:{_SEP}(?P<end>{DATE}|{PRESENT}))?(?![\w])",
    re.IGNORECASE,
)
_SINCE_RE = re.compile(rf"(?<![\w])(?:since|from)\s+(?P<start>{DATE})(?![\w])", re.IGNORECASE)
_PRESENT_RE = re.compile(rf"^{PRESENT}$", re.IGNORECASE)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _two_digit_year(yy: int) -> int:
    century_cut = (_now().year % 100) + 1
    return 2000 + yy if yy <= century_cut else 1900 + yy


def _month_from_word(word: str) -> Optional[int]:
    w = word.lower().rstrip(".")
    for i, name in enumerate(_FULL_MONTHS):
        if len(w) >= 3 and name.startswith(w):
            return i + 1
    return MONTHS.get(w[:3])


def parse_date_token(token: str) -> Optional[tuple]:
    """'Jan 2020' → (2020, 1); '2019' → (2019, None); invalid → None."""
    t = token.strip()
    m = re.fullmatch(rf"({_MON})\.?\s*{_APOS}\s*(\d{{2}})", t, re.IGNORECASE)
    if m:
        return _two_digit_year(int(m.group(2))), _month_from_word(m.group(1))
    m = re.fullmatch(rf"({_MON})\.?,?\s+(\d{{4}})", t, re.IGNORECASE)
    if m:
        return int(m.group(2)), _month_from_word(m.group(1))
    m = re.fullmatch(r"(\d{1,2})[/.\-](\d{4})", t)
    if m:
        return int(m.group(2)), int(m.group(1))
    m = re.fullmatch(r"(\d{4})[/.\-](\d{1,2})", t)
    if m:
        return int(m.group(1)), int(m.group(2))
    m = re.fullmatch(r"(\d{4})", t)
    if m:
        return int(m.group(1)), None
    return None


def _valid(year: int, month: Optional[int], max_year: int) -> bool:
    if month is not None and not 1 <= month <= 12:
        return False
    return MIN_YEAR <= year <= max_year


def to_stored(year: int, month: Optional[int]) -> str:
    return f"{year:04d}" if month is None else f"{year:04d}-{month:02d}"


def _compare(a: tuple, b: tuple) -> int:
    if a[0] != b[0]:
        return a[0] - b[0]
    if a[1] is None or b[1] is None:
        return 0
    return a[1] - b[1]


def _result(match, start: tuple, end: Optional[tuple], current: bool, flags: list) -> dict:
    return {
        "startDate": to_stored(*start),
        "endDate": to_stored(*end) if end else "",
        "current": current,
        "flags": flags,
        "text": match.group(0).strip(),
        "span": match.span(),
    }


def _from_match(match, allow_end: bool = True, start_years_ahead: int = 1) -> Optional[dict]:
    now_year = _now().year
    start = parse_date_token(match.group("start"))
    if not start or not _valid(*start, max_year=now_year + start_years_ahead):
        return None
    flags: list = []
    end_text = match.groupdict().get("end") if allow_end else None
    if end_text and _PRESENT_RE.match(end_text.strip()):
        return _result(match, start, None, True, flags)
    end = parse_date_token(end_text) if end_text else None
    if end_text and (not end or not _valid(*end, max_year=now_year + END_FUTURE_YEARS)):
        end, flags = None, ["endDate"]
    if end and _compare(start, end) > 0:
        end, flags = None, ["endDate"]
    return _result(match, start, end, False, flags)


def find_date_range(text: str, start_years_ahead: int = 1) -> Optional[dict]:
    """
    First (best) date or date range in `text`, or None. `start_years_ahead`
    raises the start-year limit (a lone education year may be a future
    graduation year).
    """
    if not text:
        return None
    since = _SINCE_RE.search(text)
    if since:
        found = _from_match(since, allow_end=False, start_years_ahead=start_years_ahead)
        if found:
            found["current"] = True
            return found
    candidates = []
    for m in _RANGE_RE.finditer(text):
        found = _from_match(m, start_years_ahead=start_years_ahead)
        if found:
            candidates.append(found)
    if not candidates:
        return None
    # Prefer a real range (or "– Present") over a lone date.
    ranged = [c for c in candidates if c["endDate"] or c["current"]]
    return (ranged or candidates)[0]


def parse_date_range(text: str) -> dict:
    """Like find_date_range, but always returns the output shape."""
    found = find_date_range(text)
    if not found:
        return {"startDate": "", "endDate": "", "current": False, "flags": []}
    return {k: found[k] for k in ("startDate", "endDate", "current", "flags")}


def normalize_stored_date(value, max_years_ahead: int = END_FUTURE_YEARS) -> Optional[str]:
    """
    A single user/parsed date → stored form ('' when empty), None when invalid.
    Accepts the same inputs as the range parser, plus an ISO date.
    """
    if value is None:
        return ""
    if not isinstance(value, str):
        return None
    v = value.strip()
    if not v:
        return ""
    iso = re.fullmatch(r"(\d{4})-(\d{2})-\d{2}(?:T.*)?", v)
    if iso:
        v = f"{iso.group(1)}-{iso.group(2)}"
    parsed = parse_date_token(v)
    if not parsed or not _valid(*parsed, max_year=_now().year + max_years_ahead):
        return None
    return to_stored(*parsed)


def is_present_word(value) -> bool:
    return isinstance(value, str) and bool(_PRESENT_RE.match(value.strip()))


def stored_compare(a: str, b: str) -> int:
    """Compare two stored dates at the precision both have."""
    pa = [int(x) for x in a.split("-")]
    pb = [int(x) for x in b.split("-")]
    return _compare((pa[0], pa[1] if len(pa) > 1 else None), (pb[0], pb[1] if len(pb) > 1 else None))


def is_future(stored: str) -> bool:
    now = _now()
    return stored_compare(stored, f"{now.year:04d}-{now.month:02d}") > 0
