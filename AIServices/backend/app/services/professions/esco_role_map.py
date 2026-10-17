"""
ESCO role-aware phrase → skill map (Module 5.1): app/data/esco_role_phrase_skill_map.json.

Each entry links one (ESCO occupation URI, ESCO skill URI) pair to 0–8 skills from our skill vocabulary (curated
canonical names) whose use clearly demonstrates that ability in that role. The map was made AI-assisted, role-aware
and conservative (see docs/changes/11-career-matching.md, Module 5.1); an entry with no skills records a reviewed
pair that stays unmapped.

The ESCO import applies it as a TRANSFORM (parse_esco → apply_to_skill), never by editing the raw files: a mapped
phrase stays ONE requirement — same name, key and type, so the required count, the top-up to 10, the role-skill index
and the related-credit fallback are unchanged — and gains a requirement group:
    label         "JavaScript / Python / PHP (use programming languages)"   (display)
    alternatives  [{name, key}]   any one satisfies the group (credit 1.0)
    phrase        the original ESCO phrase (preferred label), phrase_uri its URI
    source        "role_map"
Unmapped phrases are untouched (the frozen 0.73 mixed / mutual-NN rule applies).

validate() is the build check: every mapped skill exists in the vocabulary, at most MAX_SKILLS per pair, no duplicate
pairs, and (given the ESCO data) every occupation / skill URI and their relation exist in the active ESCO data.
"""

import hashlib
import json
from functools import lru_cache
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Set, Tuple

from app.services.embeddings import descriptions as descriptions_module
from app.services.embeddings.normalise import normalise_skill

MAP_FILE = Path(__file__).resolve().parents[2] / "data" / "esco_role_phrase_skill_map.json"
MAX_SKILLS = 8
SOURCE = "role_map"
LABEL_SHOWN = 3  # skills named in the display label; the rest are listed as alternatives

Pair = Tuple[str, str]


class RoleMapError(Exception):
    """The map file is invalid (the build / import fails)."""

    def __init__(self, errors: List[str]):
        self.errors = errors
        super().__init__(f"{len(errors)} error(s) in {MAP_FILE.name}: " + "; ".join(errors[:5]))


# ── loading ───────────────────────────────────────────────────────────────────
def read_map(path: Optional[Path] = None) -> dict:
    return json.loads((path or MAP_FILE).read_text(encoding="utf8"))


@lru_cache(maxsize=1)
def _loaded() -> dict:
    return read_map() if MAP_FILE.is_file() else {"entries": []}


def reload_role_map() -> None:
    _loaded.cache_clear()
    map_hash.cache_clear()


@lru_cache(maxsize=1)
def map_hash() -> str:
    """sha256 of the map file (part of the career-match cache key); "missing" without a file."""
    return hashlib.sha256(MAP_FILE.read_bytes()).hexdigest() if MAP_FILE.is_file() else "missing"


def index(doc: Optional[dict] = None) -> Dict[Pair, dict]:
    """{(occupation_uri, skill_uri): entry} for every entry (mapped or reviewed-empty)."""
    doc = doc if doc is not None else _loaded()
    return {(e["occupation_uri"], e["skill_uri"]): e for e in doc.get("entries", [])}


# ── validation (the build check) ──────────────────────────────────────────────
def vocabulary() -> Dict[str, str]:
    """canonical key → curated name (the skill list)."""
    curated = json.loads(Path(descriptions_module.CURATED_FILE).read_text(encoding="utf8"))
    return {normalise_skill(name)[0]: name for name in curated if not name.startswith("_")}


def validate(doc: dict, vocab: Optional[Dict[str, str]] = None, *, occupations: Optional[Set[str]] = None,
             skills: Optional[Set[str]] = None, relations: Optional[Set[Pair]] = None) -> List[str]:
    """Errors (empty = valid). URI checks run when the active ESCO data is given: `occupations` (active occupation
    URIs), `skills` (skill URIs) and `relations` ((occupation URI, skill URI) pairs of the active occupations)."""
    vocab = vocab if vocab is not None else vocabulary()
    errors: List[str] = []
    entries = doc.get("entries")
    if not isinstance(entries, list):
        return ["'entries' must be a list"]
    seen: Set[Pair] = set()
    for i, entry in enumerate(entries):
        where = f"entry {i} ({entry.get('occupation', '?')} / {entry.get('phrase', '?')})"
        occ, skill = entry.get("occupation_uri"), entry.get("skill_uri")
        if not occ or not skill:
            errors.append(f"{where}: occupation_uri and skill_uri are required")
            continue
        if (occ, skill) in seen:
            errors.append(f"{where}: duplicate pair")
        seen.add((occ, skill))
        names = entry.get("skills")
        if not isinstance(names, list):
            errors.append(f"{where}: 'skills' must be a list")
            continue
        if len(names) > MAX_SKILLS:
            errors.append(f"{where}: {len(names)} skills (max {MAX_SKILLS})")
        for name in names:
            if normalise_skill(name)[0] not in vocab:
                errors.append(f"{where}: skill {name!r} is not in the skill list")
        if len({normalise_skill(n)[0] for n in names}) != len(names):
            errors.append(f"{where}: repeated skill")
        if occupations is not None and occ not in occupations:
            errors.append(f"{where}: occupation URI not in the active ESCO data")
        if skills is not None and skill not in skills:
            errors.append(f"{where}: skill URI not in the ESCO data")
        if relations is not None and (occ in (occupations or {occ})) and (skill in (skills or {skill})) \
                and (occ, skill) not in relations:
            errors.append(f"{where}: the occupation no longer lists this skill")
    return errors


# ── the transform ─────────────────────────────────────────────────────────────
def display_label(names: List[str], phrase: str) -> str:
    shown = " / ".join(names[:LABEL_SHOWN]) + (" / …" if len(names) > LABEL_SHOWN else "")
    return f"{shown} ({phrase})"


def apply_to_skill(skill: Optional[dict], occupation_uri: str, skill_uri: str, phrase_label: str,
                   entries: Dict[Pair, dict], vocab: Dict[str, str]) -> Optional[dict]:
    """The stored role skill with its requirement group added when the pair is mapped (else unchanged).
    Name, key and type are never changed: the group is ONE requirement."""
    entry = entries.get((occupation_uri, skill_uri))
    if skill is None or not entry or not entry.get("skills"):
        return skill
    alternatives = []
    for name in entry["skills"]:
        key = normalise_skill(name)[0]
        if key in vocab and key not in {a["key"] for a in alternatives}:
            alternatives.append({"name": vocab[key], "key": key})
    if not alternatives:
        return skill
    return {**skill, "source": SOURCE, "phrase": phrase_label, "phrase_uri": skill_uri,
            "label": display_label([a["name"] for a in alternatives], phrase_label), "alternatives": alternatives}


def is_group(skill: dict) -> bool:
    return skill.get("source") == SOURCE and bool(skill.get("alternatives"))


def alternative_keys(skill: dict) -> List[str]:
    """The alternatives' keys under TODAY's aliases (like current_skill), falling back to the stored key."""
    keys = []
    for alt in skill.get("alternatives") or []:
        key = normalise_skill(alt["name"])[0] or alt["key"]
        if key not in keys:
            keys.append(key)
    return keys


def coverage(pairs: Iterable[Tuple[Pair, str, bool]], entries: Dict[Pair, dict]) -> dict:
    """Stats for the import preview. `pairs`: ((occupation_uri, skill_uri), relation, described) of the parsed active
    occupations. → adjusted requirements (mapped pairs present), adjusted essential, reviewed-unmapped and
    not-in-map undescribed essential pairs, and stale map entries (pairs no longer in the data)."""
    present: Set[Pair] = set()
    adjusted = adjusted_essential = reviewed_empty = not_in_map = 0
    unmapped_examples = []
    for pair, relation, described in pairs:
        present.add(pair)
        entry = entries.get(pair)
        if entry and entry.get("skills"):
            adjusted += 1
            adjusted_essential += relation == "essential"
        elif relation == "essential" and not described:
            if entry is not None:
                reviewed_empty += 1
            else:
                not_in_map += 1
                if len(unmapped_examples) < 10:
                    unmapped_examples.append(pair)
    stale = [p for p in entries if p not in present]
    return {"entries": len(entries), "mapped_entries": sum(1 for e in entries.values() if e.get("skills")),
            "adjusted_requirements": adjusted, "adjusted_essential": adjusted_essential,
            "essential_reviewed_unmapped": reviewed_empty, "essential_not_in_map": not_in_map,
            "essential_not_in_map_examples": [list(p) for p in unmapped_examples],
            "stale_entries": len(stale), "stale_mapped_entries": sum(1 for p in stale if entries[p].get("skills"))}


def count_groups(professions: Iterable[dict]) -> int:
    """Requirement groups in the given (active ESCO) professions — the post-check figure."""
    return sum(1 for p in professions if p.get("active") and p.get("source") == "esco"
               for s in p.get("skills") or [] if is_group(s))
