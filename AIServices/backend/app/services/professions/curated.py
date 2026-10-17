"""
Curated modern IT roles (Module 5.2): AIServices/data/curated/modern_roles_v1.json → profession documents.

An import source like O*NET and ESCO, through the same taxonomy pipeline (upload / CLI → validate → preview / diff →
publish with snapshot → post-checks → rollback). One JSON file (`FILE_NAME` when staged).

validate(): the rules of data/curated/validate_modern_roles.py, with one difference — a skill that is not in our skill
list is an ERROR here (the script only warns), because every requirement must be matchable:
  unique role ids and titles, related_onet_code like 15-1252.00, 8–15 requirements, at least one essential, evidence on
  every requirement, no vague phrase ("use …", "manage …", …) in any any_of, every any_of skill in the skill list.
A role with fewer than 3 essential requirements is a warning (weak evidence; review).

Documents: profession_id "curated:<id>", source "curated", source_version "curated v<dataset version>", category from
the role family. One stored skill per requirement: the first alternative is its name / key (embedded for the role-skill
index and the related hints); a requirement with 2+ alternatives is a requirement group — `alternatives` [{name, key}],
`label` (the requirement name), `phrase`, `source: "any_of"` — held at 1.0 by any one alternative (the Module 5.1
any-of mechanism). importance → type essential / optional; evidence and kind are kept.
"""

import json
import re
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from app.services.embeddings.normalise import normalise_skill
from app.services.professions.store import make_skill, profession_doc

SOURCE = "curated"
FILE_NAME = "curated_roles.json"
GROUP_SOURCE = "any_of"
VAGUE = re.compile(r"^(use|apply|manage|think|communicate|work|ensure|perform|develop|create|maintain|demonstrate|show|"
                   r"adapt|cooperate|assist|support)\b", re.I)
ONET_CODE = re.compile(r"\d{2}-\d{4}\.\d{2}")
FAMILY_CATEGORY = {"Web": "Development", "Mobile": "Development", "Cloud and Infrastructure": "Infrastructure & Cloud",
                   "Data and AI": "Data & AI", "Design and Product": "Design", "Games": "Development"}
VERSION = re.compile(r"^(?:curated\s*)?v?(\d{1,3}(?:\.\d{1,3}){0,2})$", re.I)
ATTRIBUTION = ("Muqayyim curated modern IT roles (AI-assisted selection; evidence: roadmap.sh, Stack Overflow Developer "
               "Survey 2025, Qureos, official certifications, O*NET technology skills — see METHOD.md)")


def vocabulary() -> Dict[str, str]:
    from app.services.professions.esco_role_map import vocabulary as vocab

    return vocab()


def find_file(directory: Path) -> Optional[Path]:
    """The staged dataset file (FILE_NAME), or the only *.json file of a folder (CLI: data/curated)."""
    directory = Path(directory)
    if (directory / FILE_NAME).is_file():
        return directory / FILE_NAME
    files = sorted(p for p in directory.glob("*.json") if p.is_file())
    return files[0] if len(files) == 1 else None


def load(directory: Path) -> Tuple[Optional[dict], List[str]]:
    path = find_file(directory)
    if path is None:
        return None, [f"Missing required file: one curated dataset JSON file ({FILE_NAME} or modern_roles_v1.json)."]
    try:
        return json.loads(path.read_text(encoding="utf-8")), []
    except UnicodeDecodeError:
        return None, ["the curated dataset is not UTF-8"]
    except ValueError as exc:
        return None, [f"the curated dataset is not valid JSON ({str(exc)[:80]})"]


def validate(doc: dict, vocab: Optional[Dict[str, str]] = None) -> Tuple[List[str], List[str]]:
    """(errors, warnings) — validate_modern_roles.py rules, with not-in-list skills as errors."""
    vocab = vocab if vocab is not None else vocabulary()
    errors, warnings = [], []
    if not isinstance(doc, dict) or not isinstance(doc.get("roles"), list) or not doc["roles"]:
        return ["the dataset must contain a non-empty 'roles' list"], []
    if not VERSION.match(str(doc.get("version") or "")):
        errors.append("the dataset needs a 'version' like 1.0.0")
    ids, titles = set(), set()
    for role in doc["roles"]:
        rid = role.get("id") or "?"
        if not re.fullmatch(r"[a-z0-9-]{2,80}", rid):
            errors.append(f"{rid}: id must be lowercase letters, digits and hyphens")
        if rid in ids:
            errors.append(f"duplicate id {rid}")
        ids.add(rid)
        title = (role.get("title") or "").strip()
        if not title:
            errors.append(f"{rid}: title is required")
        elif title.lower() in titles:
            errors.append(f"duplicate title {title}")
        titles.add(title.lower())
        if not ONET_CODE.fullmatch(role.get("related_onet_code") or ""):
            errors.append(f"{rid}: bad related_onet_code")
        reqs = role.get("required_skills") or []
        if not 8 <= len(reqs) <= 15:
            errors.append(f"{rid}: {len(reqs)} requirements (need 8-15)")
        if not any(q.get("importance") == "essential" for q in reqs):
            errors.append(f"{rid}: no essential requirement")
        for q in reqs:
            if q.get("importance") not in ("essential", "optional"):
                errors.append(f"{rid}: {q.get('skill')}: importance must be essential or optional")
            if not q.get("evidence"):
                errors.append(f"{rid}: {q.get('skill')} has no evidence")
            if not q.get("any_of"):
                errors.append(f"{rid}: {q.get('skill')} has an empty any_of")
            for s in q.get("any_of") or []:
                if VAGUE.match(s):
                    errors.append(f"{rid}: vague phrase '{s}'")
                if normalise_skill(s)[0] not in vocab:
                    errors.append(f"{rid}: '{s}' is not in the skill list")
        if sum(q.get("importance") == "essential" for q in reqs) < 3:
            warnings.append(f"{rid}: fewer than 3 essential requirements (weak evidence; review)")
    return errors, warnings


def requirement_skill(req: dict, vocab: Dict[str, str]) -> Optional[dict]:
    names = list(dict.fromkeys(vocab.get(normalise_skill(s)[0], s) for s in req["any_of"]))
    skill = make_skill(names[0], req["importance"], req["skill"])
    if skill is None:
        return None
    skill["evidence"] = list(req.get("evidence") or [])
    if req.get("kind"):
        skill["kind"] = req["kind"]
    if len(names) > 1:
        skill.update(source=GROUP_SOURCE, label=req["skill"], phrase=req["skill"],
                     alternatives=[{"name": n, "key": normalise_skill(n)[0]} for n in names])
    return skill


def parse_curated(data_dir: Path, version: Optional[str] = None) -> Dict:
    """→ {docs, stats, filtered_ids} without touching the database. Raises ValueError on validation errors."""
    doc, errors = load(data_dir)
    if errors:
        raise ValueError("; ".join(errors))
    vocab = vocabulary()
    errors, warnings = validate(doc, vocab)
    if errors:
        raise ValueError("; ".join(errors[:10]))
    dataset_version = str(doc["version"])
    docs, merged = [], []
    for role in doc["roles"]:
        skills = [requirement_skill(q, vocab) for q in role["required_skills"]]
        prof = profession_doc(profession_id=f"{SOURCE}:{role['id']}", title=role["title"].strip(), alt_titles=[],
                              description=role.get("description") or "", category=FAMILY_CATEGORY.get(role.get("family"), "Other"),
                              source=SOURCE, source_code=role["related_onet_code"],
                              source_version=f"curated v{dataset_version}", skills=[s for s in skills if s])
        if len(prof["skills"]) != len(skills):
            merged.append(f"{role['title']}: {len(skills)} requirements -> {len(prof['skills'])} after key de-duplication")
        docs.append(prof)
    stats = {"roles": len(docs), "requirements": sum(len(r["required_skills"]) for r in doc["roles"]),
             "groups": sum(1 for d in docs for s in d["skills"] if s.get("alternatives")),
             "essential": sum(1 for d in docs for s in d["skills"] if s["type"] == "essential"),
             "dataset_version": dataset_version, "warnings": warnings, "merged_by_key": merged}
    return {"docs": docs, "stats": stats, "filtered_ids": []}


def version_label(value: str) -> Tuple[str, str]:
    m = VERSION.match(" ".join((value or "").split()))
    if not m:
        raise ValueError(f"dataset version {value!r} is not a curated version like '1.0.0'")
    return f"curated v{m.group(1)}", m.group(1)


def validate_directory(directory: Path) -> Tuple[Dict[str, dict], List[str]]:
    """Upload validation: the file, its JSON and the dataset rules → ({file: {bytes, roles}}, [errors])."""
    path = find_file(directory)
    doc, errors = load(directory)
    if errors:
        return {}, errors
    errs, warnings = validate(doc)
    files = {path.name: {"bytes": path.stat().st_size, "rows": len(doc.get("roles") or []),
                         "dataset_version": str(doc.get("version") or "")}}
    if warnings and not errs:
        files["_notes"] = {"warnings": warnings}
    return files, errs
