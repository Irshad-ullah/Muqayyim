"""
Profession database: ai_db.professions (Module 5 FE-2, Module 10 FE-4).

  { profession_id ("onet:15-1254.00" | "esco:<uuid>" | "manual:<id>"),
    title, alt_titles[], description, category,
    source ('onet' | 'esco' | 'manual'), source_code, source_version,
    skills: [{ name, key, type: 'essential' | 'optional' | 'technology',
               hot, in_demand, original_label, element_name? }],
    active, inactive_reason, created_at, updated_at }

Role skills are de-duplicated by canonical key, keeping the strongest type:
essential > technology (hot or in-demand) > technology > optional.
A profession with fewer than MIN_SKILLS skills is stored but inactive.
Admin overrides (disabled_by_admin; title / description / category _set_by_admin)
survive re-imports.
"""

from datetime import datetime, timezone
from typing import Dict, Iterable, List, Optional, Tuple

from pymongo import ASCENDING

from app.config.database import get_database
from app.config.settings import settings
from app.services.embeddings.normalise import normalise_skill

PROFESSIONS = "professions"
ESCO_SKILLS = "esco_skills"
SOURCES = ("onet", "esco", "manual")
SKILL_TYPES = ("essential", "optional", "technology")
MIN_SKILLS = 5


def active_sources() -> List[str]:
    """Sources whose professions are used by the index (PROFESSION_SOURCES)."""
    wanted = [s.strip().lower() for s in (settings.PROFESSION_SOURCES or "").split(",") if s.strip()]
    return [s for s in SOURCES if s in wanted]


async def ensure_profession_indexes(db, professions: str = PROFESSIONS, esco_skills: str = ESCO_SKILLS) -> None:
    coll = db[professions]
    await coll.create_index([("profession_id", ASCENDING)], unique=True, name="profession_id_unique")
    await coll.create_index([("source", ASCENDING)], name="source")
    await coll.create_index([("category", ASCENDING)], name="category")
    await coll.create_index([("skills.key", ASCENDING)], name="skills_key")
    await db[esco_skills].create_index([("uri", ASCENDING)], unique=True, name="uri_unique")


def skill_rank(skill: dict) -> int:
    """Higher is stronger: essential > technology (hot/in-demand) > technology > optional."""
    if skill.get("type") == "essential":
        return 3
    if skill.get("type") == "technology":
        return 2 if (skill.get("hot") or skill.get("in_demand")) else 1
    return 0


def make_skill(name: str, skill_type: str, original_label: str, hot: bool = False,
               in_demand: bool = False, element_name: Optional[str] = None) -> Optional[dict]:
    key, canonical = normalise_skill(name)
    if not key:
        return None
    skill = {
        "name": canonical,
        "key": key,
        "type": skill_type if skill_type in SKILL_TYPES else "optional",
        "hot": bool(hot),
        "in_demand": bool(in_demand),
        "original_label": original_label,
    }
    if element_name:
        skill["element_name"] = element_name
    return skill


def dedupe_skills(skills: Iterable[dict]) -> List[dict]:
    """One entry per key, the strongest type wins; first-seen order is kept."""
    best: Dict[str, dict] = {}
    order: List[str] = []
    for skill in skills:
        if not skill:
            continue
        key = skill["key"]
        if key not in best:
            best[key] = skill
            order.append(key)
        elif skill_rank(skill) > skill_rank(best[key]):
            best[key] = skill
    return [best[k] for k in order]


def activity(skills: List[dict], explicit_inactive: Optional[str] = None) -> dict:
    if explicit_inactive:
        return {"active": False, "inactive_reason": explicit_inactive}
    if len(skills) < MIN_SKILLS:
        return {"active": False, "inactive_reason": f"only {len(skills)} skills (minimum {MIN_SKILLS})"}
    return {"active": True, "inactive_reason": None}


def profession_doc(*, profession_id: str, title: str, alt_titles: List[str], description: str, category: str,
                   source: str, source_code: str, source_version: str, skills: List[dict]) -> dict:
    skills = dedupe_skills(skills)
    return {
        "profession_id": profession_id,
        "title": title,
        "alt_titles": alt_titles,
        "description": description,
        "category": category,
        "source": source,
        "source_code": source_code,
        "source_version": source_version,
        "skills": skills,
        **activity(skills),
    }


def comparable(doc: dict) -> dict:
    """The fields an import owns, for change detection."""
    return {k: doc.get(k) for k in ("title", "alt_titles", "description", "category", "source_code",
                                     "source_version", "skills", "active", "inactive_reason", "dataset_values")}


# Fields an admin can override on an imported profession; the override survives re-imports.
ADMIN_OVERRIDES = {"title": "title_set_by_admin", "description": "description_set_by_admin",
                   "category": "category_set_by_admin"}


def apply_admin_overrides(doc: dict, current: Optional[dict]) -> Tuple[dict, List[str]]:
    """The dataset doc with the admin's overrides from `current` kept → (doc, kept fields).
    The dataset's own value of every overridden field is kept in `dataset_values`, so
    "reset to dataset value" always gives the latest dataset value."""
    if not current:
        return doc, []
    kept = []
    if current.get("disabled_by_admin"):
        # An admin deactivation (or delete) survives re-imports.
        doc = {**doc, "active": False, "inactive_reason": current.get("inactive_reason")}
    dataset_values = {}
    for field_name, flag in ADMIN_OVERRIDES.items():
        if current.get(flag):
            if current.get(field_name) != doc.get(field_name):
                kept.append(field_name)
            dataset_values[field_name] = doc.get(field_name)
            doc = {**doc, field_name: current.get(field_name)}
    if dataset_values:
        doc = {**doc, "dataset_values": dataset_values}
    return doc, kept


async def upsert_professions(docs: List[dict], db=None, collection: str = PROFESSIONS) -> Dict[str, int]:
    """Insert or update by profession_id; unchanged documents are not touched."""
    db = db if db is not None else get_database()
    coll = db[collection]
    now = datetime.now(timezone.utc)
    existing = {d["profession_id"]: d async for d in coll.find({"profession_id": {"$in": [d["profession_id"] for d in docs]}})}
    counts = {"inserted": 0, "updated": 0, "unchanged": 0}
    for doc in docs:
        current = existing.get(doc["profession_id"])
        doc, _ = apply_admin_overrides(doc, current)
        if current and comparable(current) == comparable(doc):
            counts["unchanged"] += 1
            continue
        await coll.update_one(
            {"profession_id": doc["profession_id"]},
            {"$set": {**doc, "updated_at": now}, "$setOnInsert": {"created_at": now}},
            upsert=True,
        )
        counts["inserted" if current is None else "updated"] += 1
    return counts


FILTER_REASON = {"onet": "excluded by role filter (SOC selection)", "esco": "excluded by role filter (ISCO selection)"}


async def deactivate_missing(source: str, keep_ids: Iterable[str], reason: str, db=None,
                             collection: str = PROFESSIONS, filtered_ids: Iterable[str] = ()) -> int:
    """Professions of `source` that are not kept become inactive (never deleted), with the reason:
    - in the dataset but outside the role filter (`filtered_ids`) → FILTER_REASON[source]; one that is
      already inactive with another reason is corrected too, unless an admin disabled it;
    - not in the dataset at all → `reason` ("not in <dataset version>")."""
    db = db if db is not None else get_database()
    now = datetime.now(timezone.utc)
    keep = list(keep_ids)
    kept = set(keep)
    filtered = [pid for pid in filtered_ids if pid not in kept]
    changed = 0
    if filtered:
        filter_reason = FILTER_REASON.get(source, "excluded by role filter")
        changed += (await db[collection].update_many(
            {"source": source, "profession_id": {"$in": filtered}, "disabled_by_admin": {"$ne": True},
             "$or": [{"active": True}, {"inactive_reason": {"$ne": filter_reason}}]},
            {"$set": {"active": False, "inactive_reason": filter_reason, "updated_at": now}},
        )).modified_count
    changed += (await db[collection].update_many(
        {"source": source, "profession_id": {"$nin": keep + filtered}, "active": True},
        {"$set": {"active": False, "inactive_reason": reason, "updated_at": now}},
    )).modified_count
    return changed


def active_filter() -> dict:
    return {"active": True, "source": {"$in": active_sources()}}
