"""
Skill-name normalisation (Module 2 FE-4).

normalise_skill(name) -> (key, canonical)
  1. trim, strip control characters, unify dashes/quotes/slashes, collapse
     whitespace;
  2. alias lookup (app/data/skill_aliases.json), ignoring case, spaces, dots,
     hyphens, underscores and slashes: 'ReactJS', 'react.js', 'React JS' → React;
  3. an aliased skill always becomes its canonical name; anything else keeps
     the user's spelling and casing (cleaned).
The key is the canonical name in lower case with spaces/hyphens/underscores
collapsed to one space: 'React' → 'react', 'Node.js' → 'node.js',
'Data-Analysis' → 'data analysis'. One key = one vector per model.
"""

import json
import re
from functools import lru_cache
from pathlib import Path
from typing import Iterable, List, Optional, Tuple

ALIASES_FILE = Path(__file__).resolve().parents[2] / "data" / "skill_aliases.json"

_CONTROL = re.compile(r"[\x00-\x1f\x7f]")
_DASHES = re.compile(r"[‐‑‒–—―−]")
_QUOTES = {"’": "'", "‘": "'", "`": "'", "“": '"', "”": '"'}
_SLASHES = re.compile(r"\s*[/／]\s*")


def _compact(text: str) -> str:
    return re.sub(r"[\s._\-/]+", "", text.lower())


@lru_cache(maxsize=1)
def _alias_table() -> dict:
    data = json.loads(ALIASES_FILE.read_text(encoding="utf8"))["canonical"]
    table = {}
    for canonical, aliases in data.items():
        for alias in [canonical, *aliases]:
            table[_compact(alias)] = canonical
    return table


def clean_skill_name(name) -> str:
    if not isinstance(name, str):
        return ""
    text = _CONTROL.sub(" ", name)
    text = _DASHES.sub("-", text)
    for fancy, plain in _QUOTES.items():
        text = text.replace(fancy, plain)
    text = _SLASHES.sub("/", text)
    return re.sub(r"\s+", " ", text).strip(" ,;")


def skill_key(canonical: str) -> str:
    return re.sub(r"[\s_\-]+", " ", canonical.lower()).strip()


def canonical_name(name) -> Optional[str]:
    """Alias match for `name`, or None when it is not a known alias."""
    cleaned = clean_skill_name(name)
    return _alias_table().get(_compact(cleaned)) if cleaned else None


def normalise_skill(name) -> Tuple[str, str]:
    """(key, canonical) — ('', '') for empty input."""
    cleaned = clean_skill_name(name)
    if not cleaned:
        return "", ""
    canonical = _alias_table().get(_compact(cleaned), cleaned)
    return skill_key(canonical), canonical


def normalise_skills(names: Iterable) -> List[Tuple[str, str]]:
    """Normalised (key, canonical) pairs, de-duplicated by key, first occurrence wins."""
    seen, out = set(), []
    for name in names:
        key, canonical = normalise_skill(name)
        if key and key not in seen:
            seen.add(key)
            out.append((key, canonical))
    return out
