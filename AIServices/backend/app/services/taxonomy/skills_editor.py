"""
Skill taxonomy editing (09c Part 5): skill_descriptions.json, skill_aliases.json and
skill_categories.json in app/data, edited through the admin panel.

Rules:
  * The 283 benchmark seed descriptions are read-only (409 SEED_READ_ONLY); a seed
    skill's aliases and category can still be edited (they are not embedding text).
  * A change is validated BEFORE anything is written, with the same rules as
    scripts/check_skill_descriptions.py (run on the proposed data in memory), plus:
    category is one of the existing categories, aliases do not belong to another
    skill, new skills need a description and a category.
  * Applied through editing.run_edit (lock + edit snapshot + undo on failure). The
    files are replaced atomically in their existing format, every cache built from
    them is reloaded, and only the edited skill is re-embedded (its "Name:
    description" text changed); the index is rebuilt from cached vectors.
The embedding configuration (model, text modes, thresholds) is not touched.
"""

import importlib.util
import json
import os
from functools import lru_cache
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from app.services.embeddings.model import get_embedder
from app.services.embeddings.normalise import _compact, canonical_name, normalise_skill
from app.services.embeddings.vector_store import get_skill_vectors
from app.services.taxonomy import editing, snapshots

CHECKER = Path(__file__).resolve().parents[4] / "scripts" / "check_skill_descriptions.py"
MAX_ALIASES = 30
MAX_ALIAS_LENGTH = 60


@lru_cache(maxsize=1)
def checker():
    spec = importlib.util.spec_from_file_location("check_skill_descriptions", CHECKER)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@lru_cache(maxsize=1)
def parser_vocabulary() -> tuple:
    """The CV parser's vocabulary (fixed while the service runs), computed once."""
    return tuple(checker().parser_vocabulary())


# ── files ─────────────────────────────────────────────────────────────────────
def _path(name: str) -> Path:
    return snapshots.data_dir() / name


def _read(name: str) -> dict:
    return json.loads(_path(name).read_text(encoding="utf8"))


def load() -> Tuple[Dict[str, str], dict, Dict[str, str]]:
    return _read("skill_descriptions.json"), _read("skill_aliases.json"), _read("skill_categories.json")


def seed() -> Dict[str, str]:
    return json.loads(checker().SEED.read_text(encoding="utf8"))


def _newline(path: Path) -> str:
    return "\r\n" if b"\r\n" in path.read_bytes()[:4096] else "\n"


def _write_atomic(path: Path, text: str) -> None:
    tmp = path.with_name(path.name + ".edit-tmp")
    tmp.write_bytes(text.replace("\n", _newline(path)).encode("utf8"))
    os.replace(tmp, path)


def _dump_plain(data: dict) -> str:
    return json.dumps(data, indent=2, ensure_ascii=False) + "\n"


def _dump_aliases(doc: dict) -> str:
    """skill_aliases.json keeps one line per skill."""
    lines = ["{", f'  "_comment": {json.dumps(doc.get("_comment", ""), ensure_ascii=False)},', '  "canonical": {']
    items = list(doc["canonical"].items())
    for i, (name, values) in enumerate(items):
        comma = "," if i < len(items) - 1 else ""
        lines.append(f"    {json.dumps(name, ensure_ascii=False)}: {json.dumps(values, ensure_ascii=False)}{comma}")
    lines += ["  }", "}", ""]
    return "\n".join(lines)


def write(descriptions: dict, aliases_doc: dict, categories: dict) -> None:
    _write_atomic(_path("skill_descriptions.json"), _dump_plain(descriptions))
    _write_atomic(_path("skill_aliases.json"), _dump_aliases(aliases_doc))
    _write_atomic(_path("skill_categories.json"), _dump_plain(categories))


# ── read API ──────────────────────────────────────────────────────────────────
def _row(name: str, descriptions, aliases, categories, seed_names) -> dict:
    return {
        "name": name,
        "description": descriptions.get(name),
        "aliases": [a for a in aliases.get(name, []) if a != name.lower()],
        "category": categories.get(name),
        "seed": name in seed_names,
    }


def list_skills(search: Optional[str] = None, category: Optional[str] = None, page: int = 1, limit: int = 50) -> dict:
    descriptions, aliases_doc, categories = load()
    aliases = aliases_doc["canonical"]
    seed_names = set(seed())
    needle = (search or "").strip().lower()
    rows = []
    for name in sorted(descriptions, key=str.lower):
        if category and categories.get(name) != category:
            continue
        if needle and needle not in name.lower() and needle not in (descriptions[name] or "").lower() \
                and not any(needle in a for a in aliases.get(name, [])):
            continue
        rows.append(_row(name, descriptions, aliases, categories, seed_names))
    total = len(rows)
    start = (page - 1) * limit
    return {"items": rows[start:start + limit], "total": total, "page": page, "limit": limit,
            "pages": (total + limit - 1) // limit if limit else 0,
            "categories": sorted(set(categories.values()))}


def get_skill(name: str) -> Optional[dict]:
    descriptions, aliases_doc, categories = load()
    if name not in descriptions:
        return None
    return _row(name, descriptions, aliases_doc["canonical"], categories, set(seed()))


# ── validation ────────────────────────────────────────────────────────────────
def _clean_aliases(name: str, values: List[str]) -> Tuple[List[str], List[str]]:
    errors, out = [], [name.lower()]
    if len(values) > MAX_ALIASES:
        errors.append(f"At most {MAX_ALIASES} aliases")
    for raw in values:
        alias = " ".join(str(raw).split()).lower()
        if not alias:
            continue
        if len(alias) > MAX_ALIAS_LENGTH:
            errors.append(f"Alias too long (max {MAX_ALIAS_LENGTH}): {alias[:20]}…")
            continue
        if alias not in out:
            out.append(alias)
    return out, errors


def propose(change: dict, create: bool) -> Tuple[dict, dict, dict, List[str], dict]:
    """→ (descriptions, aliases_doc, categories, errors, info) for the proposed change; raises EditRefused
    for 404 / 409 cases. Nothing is written."""
    descriptions, aliases_doc, categories = load()
    aliases = aliases_doc["canonical"]
    seed_skills = seed()
    name = " ".join(str(change.get("name") or "").split())
    errors: List[str] = []
    info = {"description_changed": False}
    if not name:
        raise editing.EditRefused(422, "SKILL_INVALID", "A skill name is required", ["A skill name is required"])

    if create:
        key, canonical = normalise_skill(name)
        existing = canonical_name(name) or next((n for n in descriptions if normalise_skill(n)[0] == key), None)
        if existing:
            raise editing.EditRefused(409, "SKILL_EXISTS", f"{name!r} already exists as {existing!r}")
        if canonical != name:
            errors.append(f"{name!r} is not a canonical name (would be stored as {canonical!r})")
        for field in ("description", "category"):
            if not (change.get(field) or "").strip():
                errors.append(f"A new skill needs a {field}")
    else:
        if name not in descriptions:
            raise editing.EditRefused(404, "NOT_FOUND", f"Skill {name!r} not found")

    if "description" in change and change["description"] is not None:
        text = " ".join(str(change["description"]).split())
        if name in seed_skills and text != descriptions.get(name):
            raise editing.EditRefused(409, "SEED_READ_ONLY",
                                      f"{name!r} is a benchmark seed skill: its description is read-only")
        info["description_changed"] = text != descriptions.get(name)
        descriptions = {**descriptions, name: text}

    if "category" in change and change["category"] is not None:
        allowed = set(categories.values())
        if change["category"] not in allowed:
            errors.append(f"Unknown category {change['category']!r}; use one of: {', '.join(sorted(allowed))}")
        categories = {**categories, name: change["category"]}

    if "aliases" in change and change["aliases"] is not None:
        cleaned, alias_errors = _clean_aliases(name, change["aliases"])
        errors += alias_errors
        for alias in cleaned[1:]:
            owner = canonical_name(alias)
            other = next((n for n in descriptions if n != name and _compact(n.lower()) == _compact(alias)), None)
            if (owner and owner != name) or other:
                errors.append(f"Alias {alias!r} already belongs to {owner or other!r}")
        aliases = {**aliases, name: cleaned} if len(cleaned) > 1 or name in aliases else aliases
        if len(cleaned) == 1 and name in aliases:
            aliases = {k: v for k, v in aliases.items() if k != name}  # no aliases left
        aliases_doc = {**aliases_doc, "canonical": aliases}

    report = checker().run_checks(vocabulary=parser_vocabulary(), descriptions=descriptions, categories=categories,
                                  aliases=aliases_doc["canonical"])
    errors += [e for e in report["errors"] if e not in errors]
    return descriptions, aliases_doc, categories, errors, info


def validate(change: dict, create: bool) -> dict:
    """Dry run for the editor: the errors a change would produce (nothing written)."""
    try:
        _, _, _, errors, info = propose(change, create)
    except editing.EditRefused as exc:
        return {"valid": False, "status": exc.status, "code": exc.code, "errors": exc.errors or [exc.safe_message]}
    return {"valid": not errors, "errors": errors, **info}


# ── apply ─────────────────────────────────────────────────────────────────────
async def save(change: dict, create: bool, actor: str, db=None) -> dict:
    """Validate, then apply under the lock with an edit snapshot; re-embed only this skill."""
    _, _, _, errors, _ = propose(change, create)  # fail fast, before taking the lock / snapshot
    if errors:
        raise editing.EditRefused(422, "SKILL_INVALID", "The change does not pass the description checks", errors)
    name = " ".join(str(change["name"]).split())

    async def apply() -> dict:
        descriptions, aliases_doc, categories, errors, info = propose(change, create)  # again, under the lock
        if errors:
            raise editing.EditRefused(422, "SKILL_INVALID", "The change does not pass the description checks", errors)
        write(descriptions, aliases_doc, categories)
        snapshots.reload_taxonomy_files()
        embedded = []
        if info["description_changed"] or create:
            # Only this skill's text changed: get_skill_vectors embeds it (new text hash) and
            # nothing else; the index rebuild then uses cached vectors for every other skill.
            await get_skill_vectors([name], get_embedder(), db)
            embedded = [name]
        return {"skill": get_skill(name), "re_embedded": embedded}

    return await editing.run_edit(f"skill {name}", actor, apply, db)
