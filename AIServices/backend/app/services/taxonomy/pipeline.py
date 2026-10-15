"""
The shared taxonomy import pipeline (09c Part 3). The admin UI (via import jobs)
and the CLI importers run exactly these steps, so the same input gives the same
result.

  stage    copy the live professions / esco_skills into job-scoped staging
           collections created with the SAME indexes, then apply the importer
           (parse → upsert_professions → deactivate_missing → esco skills) there.
           The live collections are never written.
  diff     staged vs live: professions added / removed / changed (title,
           description, category, with "kept admin override"), role-skill links
           added / removed, new skills without a description, counts per category.
           A summary goes into the job; every item into ai_db.import_job_diffs
           (paginated detail endpoint).
  checks   role_skill_coverage (live vs staged) and background_credit_rate on the
           staged data (index built from it in the job's staging directory).

The preview also records `preview_base`, a fingerprint of the live data, so a
publish can refuse when the live data changed after the preview.
"""

import asyncio
import hashlib
import importlib.util
import json
import logging
from collections import Counter, defaultdict
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from pymongo import ASCENDING, MongoClient

from app.config.database import get_database
from app.config.settings import settings
from app.services.embeddings.descriptions import get_description_provider
from app.services.professions.esco import parse_esco
from app.services.professions.imports import upsert_esco_skills
from app.services.professions.onet import parse_onet
from app.services.professions.role_skills import current_skill
from app.services.professions.store import (
    ESCO_SKILLS,
    PROFESSIONS,
    apply_admin_overrides,
    deactivate_missing,
    ensure_profession_indexes,
    upsert_professions,
)
from app.services.taxonomy import jobs

logger = logging.getLogger(__name__)

DIFFS = "import_job_diffs"
STAGING_PREFIX = "__staging_"
SAMPLE = 5
SECTIONS = ("professions_added", "professions_removed", "professions_changed",
            "links_added", "links_removed", "new_undescribed_skills")
EVAL_DIR = Path(__file__).resolve().parents[4] / "eval"
MODEL_WAIT_SECONDS = 600


def staging_names(job_id: str) -> Dict[str, str]:
    return {"professions": f"{PROFESSIONS}{STAGING_PREFIX}{job_id}", "esco_skills": f"{ESCO_SKILLS}{STAGING_PREFIX}{job_id}"}


def is_staging_collection(name: str) -> bool:
    return STAGING_PREFIX in name and name.split(STAGING_PREFIX)[0] in (PROFESSIONS, ESCO_SKILLS)


async def drop_staging(db, job_id: str) -> None:
    for name in staging_names(job_id).values():
        await db.drop_collection(name)
    await db[DIFFS].delete_many({"job_id": job_id})


# ── indexes ───────────────────────────────────────────────────────────────────
INDEX_OPTIONS = ("unique", "sparse", "partialFilterExpression", "expireAfterSeconds", "collation", "weights",
                 "default_language", "language_override", "textIndexVersion", "2dsphereIndexVersion")


async def index_specs(db, collection: str) -> Dict[str, dict]:
    """{name: {key, options}} without the default _id index."""
    info = await db[collection].index_information()
    return {name: {"key": spec["key"], **{k: spec[k] for k in INDEX_OPTIONS if k in spec}}
            for name, spec in info.items() if name != "_id_"}


async def copy_indexes(db, source: str, target: str) -> None:
    for name, spec in (await index_specs(db, source)).items():
        options = {k: v for k, v in spec.items() if k != "key"}
        await db[target].create_index(spec["key"], name=name, **options)


async def copy_collection(db, source: str, target: str) -> None:
    """target := source, created with the same indexes BEFORE the documents arrive."""
    await db.drop_collection(target)
    await db.create_collection(target)
    await copy_indexes(db, source, target)
    if await db[source].estimated_document_count():
        # $out into an existing collection keeps the target's indexes.
        async for _ in db[source].aggregate([{"$match": {}}, {"$out": target}]):
            pass


# ── stage ─────────────────────────────────────────────────────────────────────
def parse(source: str, directory: Path, version: str) -> dict:
    return parse_onet(directory, version) if source == "onet" else parse_esco(directory, version)


async def stage(db, job_id: str, source: str, directory: Path, version_number: str, label: str) -> dict:
    """Build the post-import state in staging collections. → parsed result (docs, stats)."""
    names = staging_names(job_id)
    await ensure_profession_indexes(db)  # the live collections define the index set
    await copy_collection(db, PROFESSIONS, names["professions"])
    await copy_collection(db, ESCO_SKILLS, names["esco_skills"])
    parsed = await asyncio.to_thread(parse, source, directory, version_number)
    written = await upsert_professions(parsed["docs"], db, collection=names["professions"])
    written["deactivated"] = await deactivate_missing(
        source, [d["profession_id"] for d in parsed["docs"]], f"not in {label}", db, collection=names["professions"])
    if source == "esco":
        written.update(await upsert_esco_skills(parsed["esco_skills"], db, collection=names["esco_skills"]))
    parsed["written"] = written
    return parsed


# ── diff ──────────────────────────────────────────────────────────────────────
CHANGE_FIELDS = ("title", "description", "category")


def _links(professions: Dict[str, dict]) -> Dict[Tuple[str, str], dict]:
    links = {}
    for pid, prof in professions.items():
        if not prof.get("active"):
            continue
        for skill in prof.get("skills") or []:
            key, name = current_skill(skill)
            links[(pid, key)] = {"profession_id": pid, "title": prof.get("title"), "skill": name, "key": key,
                                 "type": skill.get("type")}
    return links


async def diff(db, job_id: str, source: str, parsed_docs: List[dict]) -> dict:
    names = staging_names(job_id)
    projection = {"_id": 0, "profession_id": 1, "title": 1, "description": 1, "category": 1, "active": 1,
                  "source": 1, "skills": 1, "inactive_reason": 1,
                  "title_set_by_admin": 1, "description_set_by_admin": 1, "category_set_by_admin": 1}
    live = {d["profession_id"]: d async for d in db[PROFESSIONS].find({}, projection)}
    staged = {d["profession_id"]: d async for d in db[names["professions"]].find({}, projection)}
    dataset = {d["profession_id"]: d for d in parsed_docs}

    items: Dict[str, List[dict]] = defaultdict(list)
    for pid, new in staged.items():
        old = live.get(pid)
        brief = {"profession_id": pid, "title": new.get("title"), "category": new.get("category"),
                 "source": new.get("source")}
        if new.get("active") and not (old and old.get("active")):
            items["professions_added"].append({**brief, "reactivated": bool(old)})
        elif old and old.get("active") and not new.get("active"):
            items["professions_removed"].append({**brief, "reason": new.get("inactive_reason")})
        if old:
            changes = {f: {"from": old.get(f), "to": new.get(f)} for f in CHANGE_FIELDS if old.get(f) != new.get(f)}
            _, kept = apply_admin_overrides(dataset[pid], old) if pid in dataset else ({}, [])
            if changes or kept:
                items["professions_changed"].append({**brief, "changes": changes, "kept_admin_override": kept})

    live_links, staged_links = _links(live), _links(staged)
    items["links_added"] = [staged_links[k] for k in sorted(set(staged_links) - set(live_links))]
    items["links_removed"] = [live_links[k] for k in sorted(set(live_links) - set(staged_links))]

    provider = get_description_provider()
    live_keys = {k for _, k in live_links}
    new_skill_professions = Counter(k for (_, k) in staged_links if k not in live_keys)
    new_names = {link["key"]: link["skill"] for link in staged_links.values()}
    items["new_undescribed_skills"] = sorted(
        ({"key": k, "name": new_names[k], "professions": n} for k, n in new_skill_professions.items()
         if not provider.lookup(new_names[k])),
        key=lambda r: (-r["professions"], r["name"].lower()))

    def per_category(profs):
        return Counter(p.get("category") or "Other" for p in profs.values() if p.get("active"))

    live_cat, staged_cat = per_category(live), per_category(staged)
    categories = {c: {"live": live_cat.get(c, 0), "staged": staged_cat.get(c, 0)}
                  for c in sorted(set(live_cat) | set(staged_cat))}

    await db[DIFFS].delete_many({"job_id": job_id})
    rows = [{"job_id": job_id, "section": section, "seq": i, "item": item}
            for section in SECTIONS for i, item in enumerate(items[section])]
    if rows:
        await db[DIFFS].insert_many(rows, ordered=True)
    kept_total = sum(1 for i in items["professions_changed"] if i["kept_admin_override"])
    return {
        "counts": {section: len(items[section]) for section in SECTIONS},
        "samples": {section: items[section][:SAMPLE] for section in SECTIONS},
        "kept_admin_overrides": kept_total,
        "categories": categories,
        "active_professions": {"live": sum(1 for p in live.values() if p.get("active")),
                               "staged": sum(1 for p in staged.values() if p.get("active"))},
    }


async def ensure_diff_indexes(db) -> None:
    await db[DIFFS].create_index([("job_id", ASCENDING), ("section", ASCENDING), ("seq", ASCENDING)],
                                 unique=True, name="job_section_seq")


async def diff_page(job_id: str, section: str, page: int = 1, limit: int = 50, db=None) -> dict:
    db = db if db is not None else get_database()
    query = {"job_id": job_id, "section": section}
    total = await db[DIFFS].count_documents(query)
    cursor = db[DIFFS].find(query, {"_id": 0, "item": 1}).sort("seq", 1).skip((page - 1) * limit).limit(limit)
    return {"items": [d["item"] async for d in cursor], "total": total, "page": page, "limit": limit,
            "pages": (total + limit - 1) // limit if limit else 0}


# ── fingerprint of the live data ──────────────────────────────────────────────
async def live_fingerprint(db) -> str:
    """Changes whenever a live profession or ESCO skill is written (any updated_at / count)."""
    digest = hashlib.sha256()
    for name in (PROFESSIONS, ESCO_SKILLS):
        count = await db[name].estimated_document_count()
        latest = await db[name].find_one({}, {"updated_at": 1}, sort=[("updated_at", -1)])
        digest.update(f"{name}|{count}|{(latest or {}).get('updated_at')}".encode())
    return digest.hexdigest()


# ── checks (eval scripts, reused as modules) ─────────────────────────────────
def _load_eval(name: str):
    spec = importlib.util.spec_from_file_location(f"eval_{name}", EVAL_DIR / f"{name}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _coverage(db_name: str, professions: str, esco: str) -> dict:
    module = _load_eval("role_skill_coverage")
    client = MongoClient(settings.MONGODB_URL)
    try:
        result = module.measure(client[db_name], professions, esco)
    finally:
        client.close()
    return {"coverage": result["coverage"], "undescribed_total": result["undescribed_total"], "groups": result["groups"]}


async def run_checks(db, collection: str, esco_collection: str, index_dir: Path,
                     live_coverage: bool = True) -> dict:
    """Coverage (live and the given data) and the background credit check on the given data."""
    result = {}
    if live_coverage:
        result["coverage_live"] = await asyncio.to_thread(_coverage, db.name, PROFESSIONS, ESCO_SKILLS)
    result["coverage"] = await asyncio.to_thread(_coverage, db.name, collection, esco_collection)
    credit = _load_eval("background_credit_rate")
    try:
        bg = await credit.run(db=db, collection=collection, index_dir=index_dir, model_wait_seconds=MODEL_WAIT_SECONDS)
        result["background"] = {
            "check": bg["check"],
            "rates": {name: {k: p[k] for k in ("pooled_related_pct", "median_profession_related_pct", "related_by_kind")}
                      for name, p in bg["profiles"].items()},
            "role_skills": bg["role_skills"],
        }
        result["background_warning"] = not bg["check"]["passed"]
    except (credit.CheckUnavailable, asyncio.TimeoutError) as exc:
        result["background"] = {"error": str(exc) or "The embedding model did not become ready in time"}
        result["background_warning"] = True
    return result


# ── preview (job step) ────────────────────────────────────────────────────────
async def start_preview(job_id: str, db=None) -> dict:
    """validated|previewed → previewing now (JobStateError otherwise), the work in the background."""
    db = db if db is not None else get_database()
    job = await jobs.transition(job_id, jobs.PREVIEWING, note="Building the staged data", db=db)
    jobs.run_in_background(job_id, lambda: run_preview(job, db), db=db)
    return job


async def run_preview(job: dict, db) -> None:
    """Stage, diff and check; previewing → previewed. Live data is never written.
    On failure the staging collections are dropped (the runner marks the job failed)."""
    job_id = job["job_id"]
    try:
        await _preview(job, db)
    except BaseException:
        await drop_staging(db, job_id)
        from app.services.taxonomy.uploads import remove_staging

        remove_staging(job.get("staging_dir"))
        await jobs.update_job(job_id, db, staging_dir=None)
        raise


async def _preview(job: dict, db) -> None:
    job_id = job["job_id"]
    directory = Path(job["staging_dir"])
    from app.services.taxonomy.uploads import version_label

    label, number = version_label(job["source"], job["dataset_version"])
    base = await live_fingerprint(db)
    parsed = await stage(db, job_id, job["source"], directory, number, label)
    await jobs.set_progress(job_id, "Comparing with the live data", db=db)
    summary = await diff(db, job_id, job["source"], parsed["docs"])
    summary["import_stats"] = _jsonable(parsed["stats"])
    summary["written"] = parsed["written"]
    await jobs.set_progress(job_id, "Running coverage and the background credit check", db=db)
    names = staging_names(job_id)
    checks = await run_checks(db, names["professions"], names["esco_skills"], directory / "index")
    await jobs.transition(job_id, jobs.PREVIEWED, note="Preview ready", db=db, diff_summary=summary, checks=checks,
                          preview_base=base, background_acknowledged=False)


def _jsonable(value):
    return json.loads(json.dumps(value, default=str))
