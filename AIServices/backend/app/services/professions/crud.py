"""
Profession CRUD for the admin panel (Module 10 FE-4), behind /internal/professions.

Manual professions (source 'manual') are fully editable. Imported ones (O*NET,
ESCO) are owned by their dataset: only `category` and `active` can be changed
here, and an admin deactivation survives later imports. Deleting is a soft
delete (inactive, disabled_by_admin), so a re-import never brings it back.
Admin overrides on imported professions (category, deactivation) are kept by
later imports. Every change schedules a background index rebuild.
"""

import re
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from app.config.database import get_database
from app.services.professions.categories import categories
from app.services.professions.role_index import get_role_index
from app.services.professions.store import (
    ADMIN_OVERRIDES,
    PROFESSIONS,
    activity,
    dedupe_skills,
    make_skill,
    profession_doc,
)

ADMIN_DISABLED = "disabled by admin"
DELETED = "deleted by admin"
# Imported professions: these fields can be overridden by an admin (the override survives
# re-imports and can be reset to the dataset value); everything else comes from the dataset.
IMPORTED_EDITABLE = {"title", "description", "category", "active"}
OVERRIDABLE = ("title", "description", "category")


class ProfessionError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message


def public(doc: dict) -> dict:
    doc = {k: v for k, v in doc.items() if k != "_id"}
    for key in ("created_at", "updated_at"):
        if isinstance(doc.get(key), datetime):
            doc[key] = doc[key].isoformat()
    return doc


def _skills(items: List[dict]) -> List[dict]:
    return [make_skill(s["name"], s.get("type") or "essential", s["name"]) for s in items]


def _check_category(category: Optional[str]) -> None:
    if category is not None and category not in categories():
        raise ProfessionError(400, "VALIDATION_ERROR", f"Unknown category {category!r}")


async def list_professions(page: int = 1, limit: int = 20, search: Optional[str] = None, category: Optional[str] = None,
                           active: Optional[bool] = None, source: Optional[str] = None, db=None) -> dict:
    db = db if db is not None else get_database()
    query: dict = {}
    if search:
        pattern = {"$regex": re.escape(search.strip()), "$options": "i"}
        query["$or"] = [{"title": pattern}, {"alt_titles": pattern}, {"source_code": pattern}]
    if category:
        query["category"] = category
    if active is not None:
        query["active"] = active
    if source:
        query["source"] = source
    total = await db[PROFESSIONS].count_documents(query)
    cursor = db[PROFESSIONS].find(query).sort([("title", 1), ("profession_id", 1)]).skip((page - 1) * limit).limit(limit)
    items = [public(d) async for d in cursor]
    return {"items": items, "total": total, "page": page, "limit": limit, "pages": (total + limit - 1) // limit if limit else 0}


async def get_profession(profession_id: str, db=None) -> dict:
    db = db if db is not None else get_database()
    doc = await db[PROFESSIONS].find_one({"profession_id": profession_id})
    if not doc:
        raise ProfessionError(404, "NOT_FOUND", "Profession not found")
    return public(doc)


async def create_profession(body: dict, actor: Optional[str] = None, db=None) -> dict:
    db = db if db is not None else get_database()
    _check_category(body.get("category"))
    title = body["title"].strip()
    if await db[PROFESSIONS].find_one({"source": "manual", "title": {"$regex": f"^{re.escape(title)}$", "$options": "i"}}):
        raise ProfessionError(409, "DUPLICATE_PROFESSION", "A manual profession with this title already exists")
    profession_id = body.get("profession_id") or f"manual:{uuid.uuid4().hex[:12]}"
    if await db[PROFESSIONS].find_one({"profession_id": profession_id}):
        raise ProfessionError(409, "DUPLICATE_PROFESSION", "A profession with this id already exists")
    doc = profession_doc(
        profession_id=profession_id,
        title=title,
        alt_titles=body.get("alt_titles") or [],
        description=body.get("description") or "",
        category=body.get("category") or "Other",
        source="manual",
        source_code=body.get("source_code") or "",
        source_version="manual",
        skills=_skills(body.get("skills") or []),
    )
    if body.get("active") is False:
        doc.update(active=False, inactive_reason=ADMIN_DISABLED, disabled_by_admin=True)
    now = datetime.now(timezone.utc)
    doc.update(created_at=now, updated_at=now, created_by=actor, updated_by=actor)
    await db[PROFESSIONS].insert_one(doc)
    get_role_index().schedule_rebuild(db)
    return public(doc)


async def update_profession(profession_id: str, body: dict, actor: Optional[str] = None, db=None,
                            rebuild: bool = True) -> dict:
    db = db if db is not None else get_database()
    current = await db[PROFESSIONS].find_one({"profession_id": profession_id})
    if not current:
        raise ProfessionError(404, "NOT_FOUND", "Profession not found")
    _check_category(body.get("category"))
    if current["source"] != "manual":
        locked = sorted(set(body) - IMPORTED_EDITABLE)
        if locked:
            raise ProfessionError(
                409, "IMPORTED_PROFESSION",
                f"{current['source'].upper()} professions are updated by re-importing the dataset; "
                f"only title, description, category and active can be changed here (not: {', '.join(locked)})",
            )

    changes: dict = {}
    for field in ("title", "description", "category", "alt_titles", "source_code"):
        if field in body:
            changes[field] = body[field].strip() if isinstance(body[field], str) else body[field]
    skills = _skills(body["skills"]) if "skills" in body else current.get("skills") or []
    if "skills" in body:
        skills = dedupe_skills(skills)
        changes["skills"] = skills
    if body.get("active") is False:
        changes.update(active=False, inactive_reason=ADMIN_DISABLED, disabled_by_admin=True)
    elif body.get("active") is True or (not current.get("disabled_by_admin") and "skills" in body):
        changes.update(activity(skills), disabled_by_admin=False)
    if current["source"] != "manual":
        for field in OVERRIDABLE:
            if field in body and changes.get(field) != current.get(field):
                changes[ADMIN_OVERRIDES[field]] = True
                if not current.get(ADMIN_OVERRIDES[field]):  # remember the dataset's value
                    changes[f"dataset_values.{field}"] = current.get(field)
    changes.update(updated_at=datetime.now(timezone.utc), updated_by=actor)
    await db[PROFESSIONS].update_one({"profession_id": profession_id}, {"$set": changes})
    if rebuild:
        get_role_index().schedule_rebuild(db)
    return await get_profession(profession_id, db)


async def reset_to_dataset(profession_id: str, fields: Optional[List[str]] = None, actor: Optional[str] = None,
                           db=None, rebuild: bool = True) -> dict:
    """Drop admin overrides on an imported profession: each field goes back to the
    dataset's value (and follows the dataset again on re-imports). `fields` None = all,
    including an admin deactivation."""
    db = db if db is not None else get_database()
    current = await db[PROFESSIONS].find_one({"profession_id": profession_id})
    if not current:
        raise ProfessionError(404, "NOT_FOUND", "Profession not found")
    if current["source"] == "manual":
        raise ProfessionError(409, "NO_DATASET_VALUE", "Manual professions have no dataset value to reset to")
    wanted = list(fields) if fields else [*OVERRIDABLE, "active"]
    unknown = sorted(set(wanted) - set(OVERRIDABLE) - {"active"})
    if unknown:
        raise ProfessionError(400, "VALIDATION_ERROR", f"Cannot reset: {', '.join(unknown)}")
    dataset_values = current.get("dataset_values") or {}
    changes, unset, reset, pending = {}, {}, [], []
    for field in OVERRIDABLE:
        if field in wanted and current.get(ADMIN_OVERRIDES[field]):
            unset[ADMIN_OVERRIDES[field]] = ""
            unset[f"dataset_values.{field}"] = ""
            if field in dataset_values:
                changes[field] = dataset_values[field]
                reset.append(field)
            else:  # overridden before 09c: the dataset value comes back with the next import
                pending.append(field)
    if "active" in wanted and current.get("disabled_by_admin"):
        changes.update(activity(current.get("skills") or []), disabled_by_admin=False)
        reset.append("active")
    if not (changes or unset):
        raise ProfessionError(409, "NO_OVERRIDE", "This profession has no admin override to reset")
    changes.update(updated_at=datetime.now(timezone.utc), updated_by=actor)
    update = {"$set": changes}
    if unset:
        update["$unset"] = unset
    await db[PROFESSIONS].update_one({"profession_id": profession_id}, update)
    if rebuild:
        get_role_index().schedule_rebuild(db)
    result = await get_profession(profession_id, db)
    return {**result, "reset_fields": reset, "reset_at_next_import": pending}


async def delete_profession(profession_id: str, actor: Optional[str] = None, db=None) -> dict:
    """Soft delete: inactive and disabled_by_admin (kept for history, ignored by the index)."""
    db = db if db is not None else get_database()
    result = await db[PROFESSIONS].update_one(
        {"profession_id": profession_id},
        {"$set": {"active": False, "inactive_reason": DELETED, "disabled_by_admin": True,
                  "updated_at": datetime.now(timezone.utc), "updated_by": actor}},
    )
    if not result.matched_count:
        raise ProfessionError(404, "NOT_FOUND", "Profession not found")
    get_role_index().schedule_rebuild(db)
    return await get_profession(profession_id, db)
