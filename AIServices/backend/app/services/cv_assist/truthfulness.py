"""
Truthfulness post-check for CV assist (12 Part 2). The model may only reword the user's own facts;
this check flags anything in a suggestion that the input does not contain, so the user sees it in
the review step before accepting. Nothing is accepted or saved automatically.

Flagged, with a reason shown to the user:
  - a number (incl. years, percentages, "10+") that is not in the input      → "number not in your input"
  - a known skill / tool (alias table + curated skills) not in the profile    → "skill not in your profile"
  - an organisation after "at / for / with / from / joined / by" not in input → "employer not in your profile"
  - another capitalised name mid-sentence that the input does not contain     → "name not in your profile"
  - a degree word (Bachelor, MSc, PhD, …) not in the input                    → "degree not in your profile"
  - certification wording ("certified", "certification") not in the input    → "certification not in your profile"

It is a safety net, not a guarantee: the prompt forbids invention, and the user reviews every suggestion.
"""

import json
import re
from dataclasses import dataclass
from functools import lru_cache
from typing import Any, Dict, Iterable, List, Set

from app.services.embeddings import descriptions as descriptions_module
from app.services.embeddings import normalise as normalise_module

REASON_NUMBER = "number not in your input"
REASON_SKILL = "skill not in your profile"
REASON_EMPLOYER = "employer not in your profile"
REASON_NAME = "name not in your profile"
REASON_DEGREE = "degree not in your profile"
REASON_CERT = "certification not in your profile"

# Skill names that are also everyday words, or very short: they only count with the exact spelling.
AMBIGUOUS = {"go", "r", "c", "swift", "spring", "express", "rust", "ruby", "excel", "access", "word", "dart", "flask",
             "pandas", "chef", "puppet", "salt", "make", "ant", "julia", "elm", "crystal", "scheme", "vue", "next",
             "nest", "ember", "meteor", "mocha", "jest", "jasmine", "rest", "kafka", "spark", "hive", "pig", "unity"}
NOT_NAMES = {"i", "ai", "it", "ui", "ux", "api", "apis", "cv", "mvp", "b2b", "b2c", "saas", "kpi", "kpis", "qa", "ci",
             "cd", "ci/cd", "devops", "frontend", "backend", "full-stack", "fullstack", "agile", "scrum", "remote",
             "january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
             "november", "december", "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov",
             "dec", "present", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"}
DEGREES = re.compile(r"\b(Bachelor(?:'s)?|Master(?:'s)?|BSc|B\.Sc|BS|BE|BCS|MSc|M\.Sc|MS|MPhil|PhD|Ph\.D|Doctorate|"
                     r"Diploma|MBA|Associate degree)\b")
CERT = re.compile(r"\b(certified|certification|certificate)\b", re.I)
NUMBER = re.compile(r"(?<![\w.])\d+(?:[.,]\d+)*(?:\+|%)?")
# A capitalised name of one or more words. Words are joined by single spaces only, and a word may
# contain an inner dot (Node.js) but never end with one — a name never runs across a sentence end
# ("… University Islamabad. Proficient …" is two things).
_WORD = r"[A-Z][\w&+#'-]*(?:\.[A-Za-z0-9]+)*"
EMPLOYER_CUE = re.compile(rf"\b(?:at|for|with|from|joined|by) ((?:{_WORD})(?: (?:{_WORD}|&|of))*)")
CAPITALISED = re.compile(rf"(?<![\w.])({_WORD}(?: {_WORD})*)")


@dataclass(frozen=True)
class Flag:
    text: str
    reason: str
    start: int
    end: int

    def public(self) -> dict:
        return {"text": self.text, "reason": self.reason, "start": self.start, "end": self.end}


def _strings(value: Any) -> Iterable[str]:
    if isinstance(value, str):
        yield value
    elif isinstance(value, dict):
        for v in value.values():
            yield from _strings(v)
    elif isinstance(value, (list, tuple)):
        for v in value:
            yield from _strings(v)


def _numbers(text: str) -> Set[str]:
    return {re.sub(r"[+%,]", "", m.group()) for m in NUMBER.finditer(text)}


@lru_cache(maxsize=1)
def _skill_surfaces() -> Dict[str, str]:
    """surface form (lower case) → canonical name, from the alias table and the curated skills."""
    table: Dict[str, str] = {}
    aliases = json.loads(normalise_module.ALIASES_FILE.read_text(encoding="utf8"))["canonical"]
    for canonical, forms in aliases.items():
        for form in [canonical, *forms]:
            table.setdefault(form.lower(), canonical)
    curated = json.loads(descriptions_module.CURATED_FILE.read_text(encoding="utf8"))
    for name in curated:
        if not name.startswith("_"):
            table.setdefault(name.lower(), name)
    return table


def reload_skill_surfaces() -> None:
    _skill_surfaces.cache_clear()


def _skill_mentions(text: str):
    """(start, end, surface, canonical) for known skills in `text`, longest match first, no overlaps."""
    surfaces = _skill_surfaces()
    found, taken = [], []
    for surface in sorted(surfaces, key=len, reverse=True):
        if len(surface) < 2:
            continue
        for m in re.finditer(rf"(?<![\w.+#-]){re.escape(surface)}(?![\w+#-])", text, flags=re.I):
            if any(m.start() < e and s < m.end() for s, e in taken):
                continue
            exact_needed = len(surface) <= 3 or surface in AMBIGUOUS
            if exact_needed and m.group() != surfaces[surface] and m.group() not in (surfaces[surface].upper(),):
                continue  # e.g. "go" / "rest" / "py" in ordinary prose
            taken.append((m.start(), m.end()))
            found.append((m.start(), m.end(), m.group(), surfaces[surface]))
    return found


def check(suggestion: str, facts: Any) -> List[Flag]:
    """Flags for everything in `suggestion` that `facts` (all input text: profile context, the entry,
    the current text) does not contain."""
    source = "\n".join(_strings(facts))
    source_lower = source.lower()
    source_numbers = _numbers(source)

    def in_source(term: str) -> bool:
        """A whole-word match in the input ("go" is not in "Django", "Lab" is not "Labs")."""
        return re.search(rf"(?<!\w){re.escape(term.lower())}(?!\w)", source_lower) is not None

    source_words = set(re.findall(r"[a-z0-9+#]+", source_lower))

    def reworded_in_source(term: str) -> bool:
        """A multi-word term whose every word is in the input in some form ("inventory management" ←
        "managing inventory"). Single words keep the strict whole-word rule (Java is not JavaScript)."""
        words = re.findall(r"[a-z0-9+#]+", term.lower())
        if len(words) < 2:
            return False
        return all(any(s.startswith(w[:max(4, len(w) - 5)]) for s in source_words) for w in words)

    known_canonicals = {canon.lower() for *_, canon in _skill_mentions(source)}
    flags: List[Flag] = []
    covered: List[tuple] = []

    def add(start, end, reason):
        if not any(start < e and s < end for s, e in covered):
            covered.append((start, end))
            flags.append(Flag(suggestion[start:end], reason, start, end))

    for m in NUMBER.finditer(suggestion):
        if re.sub(r"[+%,]", "", m.group()) not in source_numbers:
            add(m.start(), m.end(), REASON_NUMBER)
    for m in DEGREES.finditer(suggestion):
        if not in_source(m.group()):
            add(m.start(), m.end(), REASON_DEGREE)
    for m in CERT.finditer(suggestion):
        if not CERT.search(source):
            add(m.start(), m.end(), REASON_CERT)
    skill_spans = []
    for start, end, surface, canonical in _skill_mentions(suggestion):
        skill_spans.append((start, end))
        if canonical.lower() not in known_canonicals and not in_source(surface) and not reworded_in_source(surface):
            add(start, end, REASON_SKILL)
    for m in EMPLOYER_CUE.finditer(suggestion):
        name = m.group(1).strip(" .,'")
        if name and not in_source(name) and name.lower() not in NOT_NAMES \
                and not any(s <= m.start(1) < e for s, e in skill_spans):
            add(m.start(1), m.start(1) + len(name), REASON_EMPLOYER)
    for m in CAPITALISED.finditer(suggestion):
        start = m.start(1)
        before = suggestion[:start].rstrip()
        if not before or before[-1] in ".!?:\n•-*":
            continue  # sentence or bullet start: capitalised anyway
        name = m.group(1).strip(" .,'")
        if name.lower() in NOT_NAMES or in_source(name) or any(s <= start < e for s, e in skill_spans):
            continue
        add(start, start + len(name), REASON_NAME)
    return sorted(flags, key=lambda f: f.start)
