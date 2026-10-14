"""
Skill-label cleaning for imported role skills (O*NET and ESCO).

"Known" skills are curated canonical names (app/data/skill_descriptions.json)
or alias-file names. A known skill is always returned with its curated
spelling, e.g. "Single sign-on" → "Single Sign-On".
"""

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Dict, Optional

from app.services.embeddings.descriptions import CURATED_FILE
from app.services.embeddings.normalise import canonical_name, normalise_skill

NAME_MAP_FILE = Path(__file__).resolve().parents[2] / "data" / "onet_name_map.json"


@lru_cache(maxsize=1)
def curated_names() -> Dict[str, str]:
    """canonical key → curated name."""
    data = json.loads(CURATED_FILE.read_text(encoding="utf8"))
    return {normalise_skill(name)[0]: name for name in data}


def known(name: str) -> bool:
    """A curated canonical skill, or a name the alias file resolves."""
    return normalise_skill(name)[0] in curated_names() or canonical_name(name) is not None


def curated_spelling(name: str) -> str:
    key, canonical = normalise_skill(name)
    return curated_names().get(key, canonical)


def is_curated(name: str) -> bool:
    return normalise_skill(name)[0] in curated_names()


# ── O*NET ─────────────────────────────────────────────────────────────────────
@lru_cache(maxsize=1)
def _onet_config():
    data = json.loads(NAME_MAP_FILE.read_text(encoding="utf8"))
    mapping = {k.lower(): v for k, v in data["map"].items()}
    vendors = sorted(data["vendor_prefixes"], key=len, reverse=True)
    return mapping, vendors


_SOFTWARE_SUFFIX = re.compile(r"\s+software$", re.IGNORECASE)
_AWS = re.compile(r"^Amazon Web Services(?:\s+AWS)?(?:\s+(?P<rest>.+))?$", re.IGNORECASE)


def _abbreviates(acronym: str, phrase: str) -> bool:
    """The acronym starts with the phrase's first letter and its letters appear in order
    ("JSON" ~ "JavaScript Object Notation", "HTML" ~ "Hypertext markup language")."""
    text, acr = phrase.lower(), acronym.lower()
    if not text or text[0] != acr[0]:
        return False
    position = 0
    for letter in acr:
        position = text.find(letter, position)
        if position < 0:
            return False
        position += 1
    return True


def collapse_acronym(label: str) -> str:
    """"JavaScript Object Notation JSON" → "JSON" (if known) or "JavaScript Object Notation"."""
    words = label.split()
    if len(words) < 3:
        return label
    acronym = words[-1]
    if not re.fullmatch(r"[A-Z][A-Z0-9]{1,7}", acronym):
        return label
    long_words = words[:-1]
    # The acronym must abbreviate the long name, or its trailing words (after a vendor).
    for start in range(len(long_words) - 1):
        if _abbreviates(acronym, " ".join(long_words[start:])):
            return acronym if known(acronym) else " ".join(long_words)
    return label


def clean_onet_label(label: str) -> str:
    """O*NET 'Workplace Example' → a skill name (curated spelling when known)."""
    mapping, vendors = _onet_config()
    text = " ".join((label or "").split())
    if text.lower() in mapping:
        return curated_spelling(mapping[text.lower()])
    text = _SOFTWARE_SUFFIX.sub("", text)
    if text.lower() in mapping:
        return curated_spelling(mapping[text.lower()])
    if known(text):
        return curated_spelling(text)

    aws = _AWS.match(text)
    if aws:
        rest = (aws.group("rest") or "").strip()
        for candidate in (f"AWS {rest}", f"Amazon {rest}", rest):
            if rest and known(candidate):
                return curated_spelling(candidate)
        return curated_spelling("AWS")

    collapsed = collapse_acronym(text)
    if collapsed != text and known(collapsed):
        return curated_spelling(collapsed)

    for vendor in vendors:
        if text.lower().startswith(vendor.lower() + " "):
            rest = text[len(vendor) + 1:].strip()
            for candidate in (rest, collapse_acronym(rest)):
                if known(candidate):
                    return curated_spelling(candidate)
            break
    return curated_spelling(collapsed)


# ── ESCO ──────────────────────────────────────────────────────────────────────
_QUALIFIER = re.compile(r"^(?P<base>.+?)\s*\((?P<qualifier>[^()]*)\)\s*$")


def clean_esco_label(label: str) -> str:
    """"Python (computer programming)" → "Python" when the base is a known skill; else unchanged."""
    text = " ".join((label or "").split())
    match = _QUALIFIER.match(text)
    if match and known(match.group("base")):
        return curated_spelling(match.group("base"))
    return curated_spelling(text)


def clean_label(source: str, label: str) -> Optional[str]:
    if source == "onet":
        return clean_onet_label(label)
    if source == "esco":
        return clean_esco_label(label)
    return curated_spelling(label)
