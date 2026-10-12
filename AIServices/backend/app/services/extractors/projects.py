"""
Project extraction (SDS Algorithm 3, revised).

A line can be a project NAME only if it is not:
  longer than the profile title limit, a sentence (ends with "."), a bullet,
  led by an action verb (built, developed, implemented…), longer than 12
  words, mostly a URL or a date, a "Label: value" line, or starting lowercase.
Header forms:
  "Name | React, Node"   → technologies from the right side
  "Name – short tagline" → tagline becomes the start of the description
  "Name (React, Node)"   → technologies
A new project starts only once the current one has a description, unless the
line is clearly a header ("Name | …" / "Name – …"). GitHub repository and
live links on a project's lines go to githubUrl / liveUrl. At most 10.
"""

import re
from typing import Callable, Dict, List, Optional

from app.constants.profile_limits import PROFILE_LIMITS
from app.services.date_parser import find_date_range
from app.services.extractors.common import URL_RE, is_bullet, is_github_repo_url, normalise_url, strip_bullet, tidy

TITLE_MAX = PROFILE_LIMITS["titleMax"]
MAX_WORDS = 12
MAX_PROJECTS = 10

ACTION_VERBS = {
    "built", "build", "developed", "develop", "implemented", "implement", "designed", "design",
    "created", "create", "used", "using", "worked", "work", "led", "lead", "wrote", "write",
    "added", "integrated", "managed", "deployed", "optimized", "optimised", "improved",
    "maintained", "collaborated", "utilized", "utilised", "engineered", "architected",
    "programmed", "tested", "configured", "automated", "migrated", "refactored", "reduced",
    "increased", "achieved", "contributed", "responsible", "involved", "participated", "with",
}
LABEL_LINE = re.compile(
    r"^(?:technologies|technology|tech\s*stack|stack|tools|built\s+with|description|role|responsibilities"
    r"|link|links|github|demo|live|url|repo(?:sitory)?|source)\s*:",
    re.IGNORECASE,
)
_HEADER_SPLIT = re.compile(r"\s+[–—-]\s+|\s*:\s+")


def is_project_name(line: str) -> bool:
    s = (line or "").strip()
    if not s or len(s) > TITLE_MAX or is_bullet(s):
        return False
    if s.endswith(".") or LABEL_LINE.match(s) or s[0].islower():
        return False
    words = s.split()
    if len(words) > MAX_WORDS:
        return False
    if re.sub(r"[^a-z]", "", words[0].lower()) in ACTION_VERBS:
        return False
    rest = URL_RE.sub(" ", s)
    found = find_date_range(rest)
    if found:
        rest = rest[: found["span"][0]] + rest[found["span"][1]:]
    return len(re.sub(r"[^A-Za-z]", "", rest)) >= 3


def _strong_header(line: str) -> bool:
    if "|" in line:
        return True
    parts = _HEADER_SPLIT.split(line, maxsplit=1)
    return len(parts) == 2 and 1 <= len(parts[0].split()) <= 6


def _items(text: str) -> List[str]:
    return [tidy(t) for t in re.split(r"\s*[,/;|]\s*", text) if tidy(t)]


def _looks_like_tech_list(text: str, known: Callable[[str], List[str]]) -> bool:
    items = _items(text)
    return bool(items) and all(len(i) <= 30 and len(i.split()) <= 3 for i in items) and (
        len(items) > 1 or bool(known(text))
    )


def _split_header(line: str, known: Callable[[str], List[str]]) -> tuple:
    """→ (name, tagline, technologies)."""
    text = URL_RE.sub(" ", line)
    found = find_date_range(text)
    if found:
        text = text[: found["span"][0]] + " " + text[found["span"][1]:]
    text = tidy(text)
    techs: List[str] = []
    paren = re.search(r"\(([^)]{2,80})\)\s*$", text)
    if paren and _looks_like_tech_list(paren.group(1), known):
        techs = _items(paren.group(1))
        text = tidy(text[: paren.start()])
    if "|" in text:
        name, right = [tidy(p) for p in text.split("|", 1)]
        if _looks_like_tech_list(right, known):
            return name, "", techs + _items(right)
        return name, right, techs
    parts = _HEADER_SPLIT.split(text, maxsplit=1)
    if len(parts) == 2 and tidy(parts[0]):
        return tidy(parts[0]), tidy(parts[1]), techs
    return text, "", techs


def _blocks(lines: List[str]) -> List[List[str]]:
    blocks: List[List[str]] = []
    current: Optional[List[str]] = None
    has_body = False
    for raw in lines:
        line = raw.strip()
        if not line:
            has_body = has_body or bool(current)
            continue
        if is_bullet(line):
            if current is not None:
                current.append(strip_bullet(line))
                has_body = True
            continue
        if is_project_name(line) and (current is None or has_body or _strong_header(line)):
            current = [line]
            blocks.append(current)
            has_body = False
        elif current is not None:
            current.append(line)
            has_body = True
    return blocks


def extract_projects(section: Optional[str], known_skills: Callable[[str], List[str]]) -> List[Dict]:
    projects: List[Dict] = []
    for block in _blocks((section or "").splitlines()):
        name, tagline, techs = _split_header(block[0], known_skills)
        if not name or not is_project_name(name):
            continue
        github_url = live_url = ""
        for line in block:
            for match in URL_RE.finditer(line):
                url = normalise_url(match.group(0))
                if is_github_repo_url(url):
                    github_url = github_url or url
                elif url and not url.startswith("https://github.com"):
                    live_url = live_url or url
        body = [tidy(URL_RE.sub(" ", l)) for l in block[1:]]
        body = [l for l in body if l and not re.fullmatch(r"(?i)(?:github|demo|live|link|links|url|repo)\s*:?", l)]
        description = "\n".join([t for t in [tagline, *body] if t])
        seen, technologies = set(), []
        for t in techs + known_skills(f"{name} {description}"):
            if t.lower() not in seen:
                seen.add(t.lower())
                technologies.append(t)
        projects.append({
            "name": name,
            "description": description,
            "technologies": technologies,
            "githubUrl": github_url,
            "liveUrl": live_url,
            "needsReview": [],
        })
        if len(projects) >= MAX_PROJECTS:
            break
    return projects
