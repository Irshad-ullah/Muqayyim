"""Small text helpers shared by the entry, certification and project extractors."""

import re

from app.constants.profile_limits import PROFILE_LIMITS

# "- item", "* item", "• item", "1. item", "2) item" (clean_text turns most
# bullet glyphs into "-").
BULLET_RE = re.compile(r"^\s*(?:[-*•▪◦●‣>–]|\d{1,2}[.)])\s*")
URL_RE = re.compile(r"(?:https?://|www\.)[^\s,;()<>\"']+|\bgithub\.com/[^\s,;()<>\"']+", re.IGNORECASE)

GITHUB_REPO_URL = re.compile(PROFILE_LIMITS["githubRepoUrlPattern"])
HTTP_URL = re.compile(PROFILE_LIMITS["httpUrlPattern"])

_EDGE = " \t|,;:–—-·•()[]"


def is_bullet(line: str) -> bool:
    return bool(BULLET_RE.match(line)) and not re.match(r"^\s*\d{4}", line)


def strip_bullet(line: str) -> str:
    return BULLET_RE.sub("", line, count=1).strip() if is_bullet(line) else line.strip()


def tidy(text: str) -> str:
    """Remove empty brackets and stray separators left after cutting text out."""
    t = re.sub(r"[(\[]\s*[)\]]", " ", text or "")
    t = re.sub(r"\s{2,}", " ", t)
    t = re.sub(r"(\s*[|,;]\s*){2,}", " | ", t)
    return t.strip(_EDGE).strip()


def remove_span(text: str, span) -> str:
    return text[: span[0]] + " " + text[span[1]:]


def normalise_url(raw: str) -> str:
    """'github.com/a/b.' → 'https://github.com/a/b'; '' when not a valid http(s) link."""
    url = (raw or "").strip().rstrip(".,;:)]}>\"'")
    if not url:
        return ""
    if not re.match(r"^[a-z][a-z0-9+.-]*://", url, re.IGNORECASE):
        url = "https://" + url
    url = re.sub(r"^(https?)://", lambda m: m.group(1).lower() + "://", url, flags=re.IGNORECASE)
    url = re.sub(r"^https?://(?:www\.)?github\.com(?=/|$)", "https://github.com", url, flags=re.IGNORECASE)
    if len(url) > PROFILE_LIMITS["urlMax"] or not HTTP_URL.match(url):
        return ""
    return url


def is_github_repo_url(url: str) -> bool:
    return bool(url) and bool(GITHUB_REPO_URL.match(url))
