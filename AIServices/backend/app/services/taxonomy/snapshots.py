"""
Taxonomy snapshots and restore (09c Part 4).

A snapshot is the WHOLE taxonomy state, written to local disk under
TAXONOMY_WORK_DIR/snapshots/<id>/ (outside the repository):
  professions.jsonl.gz, esco_skills.jsonl.gz   (MongoDB Extended JSON, one doc per line;
                                                role-skill links live inside the professions)
  index/role_skills.faiss, index/role_skills.meta.json
  data/<the five editable app/data JSON files>
  manifest.json                                 (sha256 + size of every file)
and one ai_db.taxonomy_snapshots record:
  { snapshot_id, created_at, created_by, reason, pool, job_id, source_versions,
    counts, state_hash, fingerprint, size_bytes }

Two retention pools: "publish" (publish / pre-restore snapshots, keep
TAXONOMY_SNAPSHOTS_KEEP = 5) and "edit" (direct edits, keep TAXONOMY_EDIT_SNAPSHOTS_KEEP = 10).

Restore is whole-state: the files are verified against the manifest, the
collections are loaded into new collections with the live indexes and swapped in
with renameCollection, the data files are replaced atomically and reloaded, and the
index files are put back (or the index is rebuilt). Callers hold the taxonomy lock.
"""

import asyncio
import gzip
import hashlib
import json
import os
import secrets
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional

from bson import json_util

from app.config.database import get_database
from app.config.settings import settings
from app.services.professions.role_index import INDEX_FILE, META_FILE, get_role_index, index_dir
from app.services.professions.store import ESCO_SKILLS, PROFESSIONS, ensure_profession_indexes

SNAPSHOTS = "taxonomy_snapshots"
DATA_DIR = Path(__file__).resolve().parents[2] / "data"
DATA_FILES = ("skill_descriptions.json", "skill_aliases.json", "skill_categories.json",
              "onet_name_map.json", "esco_name_map.json")
POOLS = {"publish": ("publish", "pre-restore"), "edit": ("edit",)}
JSON_OPTIONS = json_util.CANONICAL_JSON_OPTIONS


class SnapshotError(Exception):
    def __init__(self, message: str):
        self.safe_message = message
        super().__init__(message)


class SnapshotNotFound(SnapshotError):
    pass


def snapshots_root() -> Path:
    from app.services.taxonomy.uploads import work_dir

    path = work_dir() / "snapshots"
    path.mkdir(parents=True, exist_ok=True)
    return path


def data_dir() -> Path:
    return DATA_DIR


def pool_of(reason: str) -> str:
    return "edit" if reason in POOLS["edit"] else "publish"


def keep_for(pool: str) -> int:
    return settings.TAXONOMY_EDIT_SNAPSHOTS_KEEP if pool == "edit" else settings.TAXONOMY_SNAPSHOTS_KEEP


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        while chunk := handle.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def public(record: Optional[dict]) -> Optional[dict]:
    if not record:
        return None
    out = {k: v for k, v in record.items() if k not in ("_id", "path")}
    for key in ("created_at",):
        if isinstance(out.get(key), datetime):
            value = out[key]
            out[key] = (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).isoformat()
    return out


async def ensure_snapshot_indexes(db) -> None:
    await db[SNAPSHOTS].create_index("snapshot_id", unique=True, name="snapshot_id_unique")
    await db[SNAPSHOTS].create_index([("pool", 1), ("created_at", -1)], name="pool_created")


# ── create ────────────────────────────────────────────────────────────────────
async def _dump(db, collection: str, target: Path) -> int:
    count = 0

    def write(lines: List[str], handle):
        handle.write("".join(lines).encode("utf8"))

    with gzip.open(target, "wb") as handle:
        batch = []
        async for doc in db[collection].find({}):
            batch.append(json_util.dumps(doc, json_options=JSON_OPTIONS) + "\n")
            count += 1
            if len(batch) >= 1000:
                await asyncio.to_thread(write, batch, handle)
                batch = []
        if batch:
            await asyncio.to_thread(write, batch, handle)
    return count


async def source_versions(db) -> Dict[str, List[str]]:
    versions = {}
    for source in ("onet", "esco", "manual"):
        values = await db[PROFESSIONS].distinct("source_version", {"source": source})
        if values:
            versions[source] = sorted(v for v in values if v)
    return versions


async def create_snapshot(db=None, created_by: str = "system", reason: str = "publish",
                          job_id: Optional[str] = None) -> dict:
    """Write the current state to disk and record it; prunes the reason's pool afterwards."""
    from app.services.taxonomy.pipeline import live_fingerprint

    db = db if db is not None else get_database()
    snapshot_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S") + "-" + secrets.token_hex(4)
    root = snapshots_root()
    tmp = root / f".tmp-{snapshot_id}"
    final = root / snapshot_id
    tmp.mkdir()
    try:
        counts = {
            "professions": await _dump(db, PROFESSIONS, tmp / "professions.jsonl.gz"),
            "esco_skills": await _dump(db, ESCO_SKILLS, tmp / "esco_skills.jsonl.gz"),
            "active_professions": await db[PROFESSIONS].count_documents({"active": True}),
        }
        (tmp / "index").mkdir()
        meta = None
        for name in (INDEX_FILE, META_FILE):
            src = index_dir() / name
            if src.is_file():
                shutil.copy2(src, tmp / "index" / name)
        if (tmp / "index" / META_FILE).is_file():
            meta = json.loads((tmp / "index" / META_FILE).read_text(encoding="utf8"))
        counts["role_skills"] = (meta or {}).get("count", 0)
        (tmp / "data").mkdir()
        for name in DATA_FILES:
            src = data_dir() / name
            if src.is_file():
                shutil.copy2(src, tmp / "data" / name)
        manifest = {str(p.relative_to(tmp)).replace("\\", "/"): {"sha256": _sha256(p), "bytes": p.stat().st_size}
                    for p in sorted(tmp.rglob("*")) if p.is_file()}
        (tmp / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf8")
        os.replace(tmp, final)
    except BaseException:
        shutil.rmtree(tmp, ignore_errors=True)
        raise
    record = {
        "snapshot_id": snapshot_id,
        "created_at": datetime.now(timezone.utc),
        "created_by": created_by,
        "reason": reason,
        "pool": pool_of(reason),
        "job_id": job_id,
        "source_versions": await source_versions(db),
        "counts": counts,
        "state_hash": (meta or {}).get("state_hash"),
        "fingerprint": await live_fingerprint(db),
        "size_bytes": sum(v["bytes"] for v in manifest.values()),
        "path": str(final),
    }
    await db[SNAPSHOTS].insert_one(dict(record))
    await prune(db, record["pool"])
    return record


async def prune(db, pool: str) -> int:
    """Keep the newest `keep_for(pool)` snapshots of a pool; delete the rest (files and records)."""
    keep = keep_for(pool)
    old = [r async for r in db[SNAPSHOTS].find({"pool": pool}).sort("created_at", -1).skip(keep)]
    for record in old:
        path = Path(record.get("path") or "")
        if path.parent == snapshots_root() and path.is_dir():
            shutil.rmtree(path, ignore_errors=True)
        await db[SNAPSHOTS].delete_one({"_id": record["_id"]})
    return len(old)


async def delete_snapshot(db, record: dict) -> None:
    """Remove a snapshot that turned out to be unnecessary (an edit refused by validation)."""
    path = Path(record.get("path") or "")
    if path.parent == snapshots_root() and path.is_dir():
        shutil.rmtree(path, ignore_errors=True)
    await db[SNAPSHOTS].delete_one({"snapshot_id": record["snapshot_id"]})


async def get_snapshot(snapshot_id: str, db=None) -> dict:
    db = db if db is not None else get_database()
    record = await db[SNAPSHOTS].find_one({"snapshot_id": snapshot_id})
    if not record:
        raise SnapshotNotFound(f"Snapshot {snapshot_id} not found")
    return record


async def list_snapshots(db=None, pool: Optional[str] = None) -> List[dict]:
    db = db if db is not None else get_database()
    query = {"pool": pool} if pool else {}
    return [public(r) async for r in db[SNAPSHOTS].find(query).sort("created_at", -1)]


async def undone_by_restore(snapshot_id: str, db=None) -> dict:
    """What restoring this snapshot undoes: imports and edits recorded after it."""
    from app.services.taxonomy import jobs

    db = db if db is not None else get_database()
    record = await get_snapshot(snapshot_id, db)
    after = record["created_at"]
    imports = [{"job_id": j["job_id"], "source": j["source"], "dataset_version": j["dataset_version"],
                "created_by": j["created_by"], "updated_at": jobs.public(j)["updated_at"]}
               async for j in db[jobs.JOBS].find({"status": jobs.PUBLISHED, "updated_at": {"$gt": after}})]
    edits = [public(r) async for r in db[SNAPSHOTS].find({"pool": "edit", "created_at": {"$gt": after}})
             .sort("created_at", 1)]
    restores = [public(r) async for r in db[SNAPSHOTS].find({"reason": "pre-restore", "created_at": {"$gt": after}})]
    return {"snapshot": public(record), "imports_undone": imports, "edits_undone": edits, "restores_after": restores}


# ── restore ───────────────────────────────────────────────────────────────────
def verify(path: Path) -> dict:
    manifest_path = path / "manifest.json"
    if not manifest_path.is_file():
        raise SnapshotError("The snapshot's manifest is missing")
    manifest = json.loads(manifest_path.read_text(encoding="utf8"))
    for rel, info in manifest.items():
        file = path / rel
        if not file.is_file() or _sha256(file) != info["sha256"]:
            raise SnapshotError(f"The snapshot file {rel} is missing or damaged")
    return manifest


async def _load(db, source: Path, target: str) -> int:
    count = 0
    batch = []
    with gzip.open(source, "rb") as handle:
        for line in handle:
            batch.append(json_util.loads(line.decode("utf8"), json_options=JSON_OPTIONS))
            if len(batch) >= 1000:
                await db[target].insert_many(batch, ordered=False)
                count += len(batch)
                batch = []
    if batch:
        await db[target].insert_many(batch, ordered=False)
        count += len(batch)
    return count


def _replace_file(src: Path, dest: Path) -> None:
    tmp = dest.with_name(dest.name + ".restore-tmp")
    shutil.copy2(src, tmp)
    os.replace(tmp, dest)


def reload_taxonomy_files() -> None:
    """Drop every cache built from the app/data JSON files (after a restore or an edit)."""
    from app.services.embeddings import normalise
    from app.services.embeddings.descriptions import use_description_provider
    from app.services.professions import categories, cleaning

    normalise._alias_table.cache_clear()
    cleaning.curated_names.cache_clear()
    cleaning._onet_config.cache_clear()
    cleaning._esco_map.cache_clear()
    categories._config.cache_clear()
    use_description_provider(None)


async def swap_in(db, staged: Dict[str, str]) -> None:
    """renameCollection staged → live (dropTarget), professions first. Each rename is atomic;
    the pair is not — a crash in between is recovered from the job's snapshot."""
    from app.services.taxonomy import pipeline

    await db[staged["professions"]].rename(PROFESSIONS, dropTarget=True)
    await pipeline.between_swaps_hook()
    await db[staged["esco_skills"]].rename(ESCO_SKILLS, dropTarget=True)


async def check_files(record: dict) -> Path:
    """The snapshot's directory, after verifying every file against the manifest."""
    path = Path(record["path"])
    if path.parent != snapshots_root() or not path.is_dir():
        raise SnapshotError("The snapshot's files are no longer on disk")
    await asyncio.to_thread(verify, path)
    return path


async def restore_files(db, record: dict) -> dict:
    """Put a snapshot back (whole state). The caller holds the taxonomy lock."""
    from app.services.taxonomy.pipeline import copy_indexes

    path = await check_files(record)
    await ensure_profession_indexes(db)
    token = secrets.token_hex(6)
    staged = {"professions": f"{PROFESSIONS}__restore_{token}", "esco_skills": f"{ESCO_SKILLS}__restore_{token}"}
    try:
        for kind, live in (("professions", PROFESSIONS), ("esco_skills", ESCO_SKILLS)):
            await db.create_collection(staged[kind])
            await copy_indexes(db, live, staged[kind])
            await _load(db, path / f"{kind}.jsonl.gz", staged[kind])
        await swap_in(db, staged)
    except BaseException:
        for name in staged.values():
            await db.drop_collection(name)
        raise
    for name in DATA_FILES:
        src = path / "data" / name
        if src.is_file():
            await asyncio.to_thread(_replace_file, src, data_dir() / name)
    reload_taxonomy_files()
    index = get_role_index()
    restored_index = (path / "index" / INDEX_FILE).is_file() and (path / "index" / META_FILE).is_file()
    if restored_index:
        index.dir.mkdir(parents=True, exist_ok=True)
        for name in (INDEX_FILE, META_FILE):
            await asyncio.to_thread(_replace_file, path / "index" / name, index.dir / name)
    index.last_build_seconds = None
    state = await index.load_or_build(db)  # loads the restored files if they match the data, else rebuilds
    vectors = await repair_vectors(db)
    return {"index_state": state, "index_files_restored": restored_index,
            "index_rebuilt": index.last_build_seconds is not None, "vectors": vectors}


async def repair_vectors(db) -> dict:
    """
    The vector cache is not part of a snapshot. A description edit replaced the vector
    of the edited text (the old one is deleted as stale), so after restoring the old
    text, role skills and users' skills may have no vector for their current text.
    Embed exactly those (only misses); if the model is not loaded yet, mark the affected
    user profiles pending so the embedding worker completes them (role skills are
    embedded by the next index rebuild).
    """
    from app.services.embeddings.descriptions import text_mode
    from app.services.embeddings.model import ModelNotReady, get_embedder
    from app.services.embeddings.normalise import normalise_skills
    from app.services.embeddings.user_profiles import PENDING
    from app.services.embeddings.vector_store import USER_SKILL_PROFILES, get_skill_vectors, load_vectors
    from app.services.professions.role_skills import active_professions, distinct_role_skills

    embedder = get_embedder()
    pairs = dict(distinct_role_skills(await active_professions(db)))
    async for record in db[USER_SKILL_PROFILES].find({}, {"skills": 1}):
        for skill in record.get("skills") or []:
            for key, name in normalise_skills([skill["name"]]):
                pairs.setdefault(key, name)
    cached = await load_vectors(list(pairs.items()), embedder.model_name, db, text_mode())
    missing = {k: n for k, n in pairs.items() if k not in cached}
    if not missing:
        return {"missing": 0, "re_embedded": 0, "profiles_marked_pending": 0}
    try:
        if not embedder.ready:
            raise ModelNotReady(embedder.model_name)
        await get_skill_vectors(list(missing.values()), embedder, db)
        return {"missing": len(missing), "re_embedded": len(missing), "profiles_marked_pending": 0}
    except ModelNotReady:
        result = await db[USER_SKILL_PROFILES].update_many(
            {"skills.key": {"$in": list(missing)}}, {"$set": {"embedding_status": PENDING}})
        return {"missing": len(missing), "re_embedded": 0, "profiles_marked_pending": result.modified_count}
