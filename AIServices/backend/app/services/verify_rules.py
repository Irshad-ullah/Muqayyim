"""
Cross-field rules for PUT /api/cv/verify — the same rules CoreServices applies
when the data is imported into the profile (FR5.3, FR5.4, FR5.6, FR5.7), so a
verified CV can always be imported:

  experience     start date required, valid, not in the future; end date
                 required unless current, not in the future, not before start
                 ("Present" as end date → current)
  education      dates valid, start not after end ("Present" end → empty)
  certifications date valid and not in the future; link must be http(s)
  projects       githubUrl must be a GitHub repository link; liveUrl http(s)

Pydantic (CVVerifyRequestSchema) has already checked types, required text
fields and lengths. Returns (normalised data, errors[{field, message}]).
"""

from typing import Dict, List, Tuple

from app.constants.profile_limits import PROFILE_LIMITS
from app.services.date_parser import is_future, is_present_word, normalize_stored_date, stored_compare
from app.services.extractors.common import is_github_repo_url, normalise_url

DATE_FORMAT_MESSAGE = "Use a date like 2022-01, Jan 2022 or 2022"
GITHUB_REPO_MESSAGE = "Must be a GitHub repository link like https://github.com/owner/repo"
EDU_YEARS = PROFILE_LIMITS["dates"]["educationEndFutureYears"]


def check_verified_data(data: Dict, prefix: str = "verified_data") -> Tuple[Dict, List[Dict]]:
    errors: List[Dict] = []

    def add(path: str, message: str):
        errors.append({"field": f"{prefix}.{path}", "message": message})

    def date(path: str, value, years_ahead: int):
        stored = normalize_stored_date(value or "", years_ahead)
        if stored is None:
            add(path, DATE_FORMAT_MESSAGE)
        return stored

    def url(path: str, value, github_only: bool = False) -> str:
        raw = (value or "").strip()
        if not raw:
            return ""
        normalised = normalise_url(raw)
        if not normalised:
            add(path, "Must be a valid http(s) link")
        elif github_only and not is_github_repo_url(normalised):
            add(path, GITHUB_REPO_MESSAGE)
        return normalised

    for i, e in enumerate(data.get("experience") or []):
        p = f"experience[{i}]"
        if is_present_word(e.get("endDate")):
            e["current"], e["endDate"] = True, ""
        start = date(f"{p}.startDate", e.get("startDate"), 1)
        if start == "":
            add(f"{p}.startDate", "Start date is required")
        elif start and is_future(start):
            add(f"{p}.startDate", "Start date cannot be in the future")
        if e.get("current"):
            end = ""
        else:
            end = date(f"{p}.endDate", e.get("endDate"), EDU_YEARS)
            if end == "":
                add(f"{p}.endDate", "End date is required unless this is your current role")
            elif end and is_future(end):
                add(f"{p}.endDate", "End date cannot be in the future")
            elif end and start and not is_future(start) and stored_compare(start, end) > 0:
                add(f"{p}.endDate", "End date must be after the start date")
        e["startDate"], e["endDate"] = start or "", end or ""

    for i, e in enumerate(data.get("education") or []):
        p = f"education[{i}]"
        if is_present_word(e.get("endDate")):
            e["endDate"] = ""
        start = date(f"{p}.startDate", e.get("startDate"), EDU_YEARS)
        end = date(f"{p}.endDate", e.get("endDate"), EDU_YEARS)
        if start and end and stored_compare(start, end) > 0:
            add(f"{p}.endDate", "End date must be after the start date")
        e["startDate"], e["endDate"] = start or "", end or ""

    for i, c in enumerate(data.get("certifications") or []):
        p = f"certifications[{i}]"
        when = date(f"{p}.date", c.get("date"), 0)
        if when and is_future(when):
            add(f"{p}.date", "Date cannot be in the future")
        c["date"] = when or ""
        c["url"] = url(f"{p}.url", c.get("url"))

    for i, pr in enumerate(data.get("projects") or []):
        p = f"projects[{i}]"
        pr["githubUrl"] = url(f"{p}.githubUrl", pr.get("githubUrl"), github_only=True)
        pr["liveUrl"] = url(f"{p}.liveUrl", pr.get("liveUrl"))

    return data, errors
