"""
Profession imports as reusable services (Module 10 FE-4, FR12.5).

  preview_import(source, data_dir, version)          → ImportReport, no writes
  publish_import(source, data_dir, version, actor)   → ImportReport; writes, then
                                                       embeds role skills and
                                                       rebuilds the FAISS index

The CLI scripts (scripts/import_onet.py, scripts/import_esco.py) and the future
admin page both call these. Required files and headers are validated first;
a dataset problem returns a report with `errors` and writes nothing.
"""

import logging
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

from pymongo import ReplaceOne

from app.config.database import get_database
from app.config.settings import settings
from app.services.embeddings.descriptions import EscoDescriptionProvider, load_description_provider
from app.services.embeddings.model import ModelNotReady
from app.services.professions.cleaning import clean_esco_label
from app.services.professions.csv_io import DatasetError
from app.services.professions.esco import parse_esco
from app.services.professions.onet import parse_onet
from app.services.professions.role_index import get_role_index
from app.services.professions.role_skills import active_professions, distinct_role_skills, ensure_role_skill_vectors
from app.services.professions.store import (
    ESCO_SKILLS,
    PROFESSIONS,
    comparable,
    deactivate_missing,
    ensure_profession_indexes,
    upsert_professions,
)

logger = logging.getLogger(__name__)

IMPORT_SOURCES = ("onet", "esco")
IMPORT_LOG = "profession_imports"
BACKEND_DIR = Path(__file__).resolve().parents[3]


@dataclass
class ImportReport:
    source: str
    version: str
    data_dir: str
    mode: str  # 'preview' | 'publish'
    ok: bool = True
    errors: List[str] = field(default_factory=list)
    warnings: List[str] = field(default_factory=list)
    occupations: int = 0
    active: int = 0
    inactive: int = 0
    skills: int = 0  # role-skill entries over all occupations
    distinct_skills: int = 0
    added: List[str] = field(default_factory=list)
    updated: List[str] = field(default_factory=list)
    removed: List[str] = field(default_factory=list)  # in the DB, no longer in the dataset → deactivated on publish
    unchanged: int = 0
    stats: Dict = field(default_factory=dict)  # source-specific: coverage %, unmapped / undescribed labels, …
    written: Dict = field(default_factory=dict)  # publish only
    index: Dict = field(default_factory=dict)  # publish only
    actor: Optional[str] = None
    started_at: Optional[str] = None
    finished_at: Optional[str] = None

    def to_dict(self) -> dict:
        return asdict(self)


def default_data_dir(source: str) -> Path:
    if source == "curated":  # the curated dataset is not raw data (Module 5.2)
        return (BACKEND_DIR / ".." / "data" / "curated").resolve()
    base = Path(settings.PROFESSION_DATA_DIR)
    base = base if base.is_absolute() else (BACKEND_DIR / base).resolve()
    return base / source


def default_version(source: str) -> str:
    if source == "curated":  # the dataset's own version field
        from app.services.professions.curated import load

        doc, _ = load(default_data_dir("curated"))
        return str((doc or {}).get("version") or "")
    return settings.ONET_VERSION if source == "onet" else settings.ESCO_VERSION


def _parse(source: str, data_dir: Path, version: str) -> dict:
    if source == "onet":
        return parse_onet(data_dir, version)
    return parse_esco(data_dir, version)


def _new_report(source: str, data_dir, version, mode: str) -> ImportReport:
    source = (source or "").strip().lower()
    version = version or (default_version(source) if source in IMPORT_SOURCES else "")
    data_dir = Path(data_dir) if data_dir else (default_data_dir(source) if source in IMPORT_SOURCES else Path("."))
    return ImportReport(source=source, version=version, data_dir=str(data_dir), mode=mode,
                        started_at=datetime.now(timezone.utc).isoformat())


async def _prepare(report: ImportReport, db) -> Optional[dict]:
    """Validate and parse, then diff against the DB. None (with report.errors) on a dataset problem."""
    if report.source not in IMPORT_SOURCES:
        report.ok = False
        report.errors.append(f"Unknown source {report.source!r}; expected one of {', '.join(IMPORT_SOURCES)}")
        return None
    try:
        parsed = _parse(report.source, Path(report.data_dir), report.version)
    except DatasetError as exc:
        report.ok = False
        report.errors.append(str(exc))
        return None

    docs = parsed["docs"]
    report.occupations = len(docs)
    report.active = sum(1 for d in docs if d["active"])
    report.inactive = report.occupations - report.active
    report.skills = sum(len(d["skills"]) for d in docs)
    report.distinct_skills = len({s["key"] for d in docs for s in d["skills"]})
    report.stats = parsed["stats"]
    if report.inactive:
        report.warnings.append(
            f"{report.inactive} occupation(s) have fewer than 5 skills and will be stored inactive: "
            + ", ".join(d["title"] for d in docs if not d["active"])[:500]
        )

    if db is None:
        report.warnings.append("Database not available: added/updated/removed could not be compared")
        return parsed
    existing = {d["profession_id"]: d async for d in db[PROFESSIONS].find({"source": report.source}, {"_id": 0})}
    new_ids = set()
    for doc in docs:
        new_ids.add(doc["profession_id"])
        current = existing.get(doc["profession_id"])
        if current is None:
            report.added.append(doc["profession_id"])
        elif comparable(current) != comparable(doc):
            report.updated.append(doc["profession_id"])
        else:
            report.unchanged += 1
    report.removed = sorted(pid for pid, d in existing.items() if pid not in new_ids and d.get("active"))
    return parsed


async def preview_import(source: str, data_dir=None, version: Optional[str] = None, db=None) -> ImportReport:
    """Everything an import would do, without writing (FR12.5: validate before publishing)."""
    db = db if db is not None else get_database()
    report = _new_report(source, data_dir, version, "preview")
    await _prepare(report, db)
    report.finished_at = datetime.now(timezone.utc).isoformat()
    return report


async def upsert_esco_skills(skills: List[dict], db, collection: str = ESCO_SKILLS) -> Dict[str, int]:
    now = datetime.now(timezone.utc)
    ops = [ReplaceOne({"uri": s["uri"]}, {**s, "updated_at": now}, upsert=True) for s in skills]
    result = await db[collection].bulk_write(ops, ordered=False) if ops else None
    return {
        "esco_skills": len(skills),
        "esco_skills_inserted": result.upserted_count if result else 0,
        "esco_skills_modified": result.modified_count if result else 0,
    }


async def refresh_esco_descriptions(db=None) -> int:
    """With ESCO_DESCRIPTIONS_ENABLED, put ESCO skill descriptions after the curated
    ones in the description chain. → number of ESCO descriptions loaded (0 when off)."""
    if not settings.ESCO_DESCRIPTIONS_ENABLED:
        return 0
    db = db if db is not None else get_database()
    if db is None:
        return 0
    descriptions = {}
    async for doc in db[ESCO_SKILLS].find({"description": {"$nin": ["", None]}}, {"label": 1, "description": 1}):
        descriptions.setdefault(clean_esco_label(doc["label"]), doc["description"])
    provider = EscoDescriptionProvider(descriptions)
    load_description_provider(provider)
    return len(provider)


async def embed_and_rebuild(db=None, wait: bool = True) -> dict:
    """Embed every active role skill that has no vector yet (batched, shared cache) and
    rebuild the index. wait=False runs it in the background. If the model is still
    loading, the build waits for it in the background."""
    db = db if db is not None else get_database()
    index = get_role_index()
    if not wait:
        index.schedule_rebuild(db)
        return {**index.health(), "scheduled": True}
    pairs = distinct_role_skills(await active_professions(db))
    try:
        await ensure_role_skill_vectors(pairs, db=db)
    except ModelNotReady:
        index.schedule_rebuild(db)
        return {**index.health(), "scheduled": True, "note": "embedding model still loading; the index is built once it is ready"}
    await index.rebuild(db)
    return index.health()


async def publish_import(source: str, data_dir=None, version: Optional[str] = None,
                         actor: Optional[str] = None, db=None, rebuild: bool = True) -> ImportReport:
    """Validate, write professions (and ESCO skills), deactivate missing ones, embed, rebuild the index."""
    db = db if db is not None else get_database()
    report = _new_report(source, data_dir, version, "publish")
    report.actor = actor
    if db is None:
        report.ok = False
        report.errors.append("Database not available")
        return report
    parsed = await _prepare(report, db)
    if parsed is None:
        report.finished_at = datetime.now(timezone.utc).isoformat()
        return report

    await ensure_profession_indexes(db)
    written = await upsert_professions(parsed["docs"], db)
    label = f"O*NET {report.version}" if report.source == "onet" else f"ESCO v{report.version}"
    written["deactivated"] = await deactivate_missing(
        report.source, [d["profession_id"] for d in parsed["docs"]], f"not in {label}", db,
        filtered_ids=parsed.get("filtered_ids", ()),
    )
    if report.source == "esco":
        written.update(await upsert_esco_skills(parsed["esco_skills"], db))
        written["esco_descriptions_loaded"] = await refresh_esco_descriptions(db)
    report.written = written

    if rebuild:
        report.index = await embed_and_rebuild(db)
    report.finished_at = datetime.now(timezone.utc).isoformat()
    try:
        await db[IMPORT_LOG].insert_one({
            "source": report.source, "version": report.version, "actor": actor,
            "occupations": report.occupations, "active": report.active, "written": written,
            "added": len(report.added), "updated": len(report.updated), "removed": len(report.removed),
            "at": datetime.now(timezone.utc),
        })
    except Exception as exc:  # noqa: BLE001 — the import itself succeeded
        logger.warning("Could not record the import summary: %s", type(exc).__name__)
    return report
