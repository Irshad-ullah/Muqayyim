"""
Upload, staging, validation and cleanup for taxonomy import jobs (09c Part 2).

Staging: TAXONOMY_WORK_DIR/staging/<random token>/ — outside the repository, one
directory per job, its name never derived from user input. Only the expected CSV
files are written there; everything is deleted when the job finishes
(published / failed / cancelled / rolled back) or after TAXONOMY_STAGING_TTL_HOURS.

Accepted uploads, for ONE source:
  * one ZIP (as downloaded: extra files are ignored, a single top-level folder is fine)
  * or the individual CSV files
Expected files (case-insensitive; ESCO with or without "_en"):
  onet  occupation_data.csv, job_titles.csv, software_skills.csv
  esco  occupations_en.csv, skills_en.csv, occupationSkillRelations_en.csv,
        digitalSkillsCollection_en.csv (optional)

ZIP safety (the whole archive is rejected):
  * absolute paths, drive letters, ".." segments, backslash tricks (zip-slip)
  * symlink entries, encrypted entries
  * more than TAXONOMY_MAX_ZIP_ENTRIES entries
  * more than TAXONOMY_MAX_UNZIPPED_MB in total (declared sizes AND the bytes
    actually written while extracting — headers can lie)
  * the same expected file twice
Nothing in an upload is ever logged or stored in the job except file names,
sizes and row counts.
"""

import asyncio
import os
import re
import secrets
import shutil
import stat
import time
import zipfile
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Tuple

from app.config.database import get_database
from app.config.settings import settings
from app.services.professions import esco as esco_module
from app.services.professions import onet as onet_module
from app.services.professions.csv_io import check_files, scan_rows
from app.services.taxonomy import jobs

CHUNK = 1024 * 1024
ONET_FILES = {"occupation_data.csv": "occupation_data", "job_titles.csv": "job_titles",
              "software_skills.csv": "software_skills"}
ESCO_BASES = ("occupations", "skills", "occupationSkillRelations", "digitalSkillsCollection")


class UploadRejected(Exception):
    """The upload itself is unacceptable (HTTP 413 / 422). `errors` are readable, content-free."""

    def __init__(self, errors: List[str], status: int = 422, code: str = "UPLOAD_REJECTED"):
        self.errors = errors
        self.status = status
        self.code = code
        self.safe_message = "; ".join(errors)
        super().__init__(self.safe_message)


# ── paths ─────────────────────────────────────────────────────────────────────
def work_dir() -> Path:
    base = settings.TAXONOMY_WORK_DIR.strip() or str(Path.home() / ".muqayyim" / "taxonomy")
    return Path(base).expanduser().resolve()


def staging_root() -> Path:
    path = work_dir() / "staging"
    path.mkdir(parents=True, exist_ok=True)
    return path


def new_staging_dir() -> Path:
    path = staging_root() / secrets.token_hex(16)
    path.mkdir(mode=0o700)
    return path


def remove_staging(path: Optional[str]) -> bool:
    """Delete a job's staging directory; only ever inside the staging root."""
    if not path:
        return False
    target = Path(path).resolve()
    root = staging_root().resolve()
    if target.parent != root or not target.is_dir():
        return False
    shutil.rmtree(target, ignore_errors=True)
    return True


# ── expected names ────────────────────────────────────────────────────────────
def expected_name(source: str, filename: str) -> Optional[str]:
    """The canonical staged name for an expected file, or None if it is not expected."""
    name = filename.replace("\\", "/").rsplit("/", 1)[-1]
    lower = name.lower()
    if source == "onet":
        return name.lower() if lower in ONET_FILES else None
    for base in ESCO_BASES:
        if lower in (f"{base.lower()}_en.csv", f"{base.lower()}.csv"):
            return f"{base}_en.csv"
    return None


def version_label(source: str, value: str) -> Tuple[str, str]:
    """('O*NET 31.0', '31.0') / ('ESCO v1.2.1', '1.2.1') from what the admin typed."""
    text = " ".join((value or "").split())
    if source == "onet":
        m = re.fullmatch(r"(?:O\*NET\s*)?(\d{1,3}(?:\.\d{1,3})?)", text, re.IGNORECASE)
        if not m:
            raise UploadRejected([f"dataset version {text!r} is not an O*NET version like 'O*NET 31.0'"])
        return f"O*NET {m.group(1)}", m.group(1)
    m = re.fullmatch(r"(?:ESCO\s*)?v?(\d{1,3}(?:\.\d{1,3}){0,2})", text, re.IGNORECASE)
    if not m:
        raise UploadRejected([f"dataset version {text!r} is not an ESCO version like 'ESCO v1.2.1'"])
    return f"ESCO v{m.group(1)}", m.group(1)


# ── ZIP extraction ────────────────────────────────────────────────────────────
@dataclass
class Staged:
    files: Dict[str, int] = field(default_factory=dict)  # staged name → bytes
    ignored: List[str] = field(default_factory=list)
    mode: str = "files"
    upload_bytes: int = 0
    zip_entries: int = 0
    uncompressed_bytes: int = 0

    def summary(self) -> dict:
        return {
            "mode": self.mode,
            "upload_bytes": self.upload_bytes,
            "zip_entries": self.zip_entries,
            "uncompressed_bytes": self.uncompressed_bytes,
            "files": {name: {"bytes": size} for name, size in sorted(self.files.items())},
            "ignored": self.ignored[:50],
            "ignored_count": len(self.ignored),
        }


def _unsafe(info: zipfile.ZipInfo) -> Optional[str]:
    name = info.filename
    normalised = name.replace("\\", "/")
    if normalised.startswith("/") or re.match(r"^[A-Za-z]:", normalised):
        return "absolute path"
    if ".." in normalised.split("/"):
        return "'..' path segment"
    mode = (info.external_attr >> 16) & 0xFFFF
    if stat.S_ISLNK(mode):
        return "symbolic link"
    if info.flag_bits & 0x1:
        return "encrypted entry"
    if "\x00" in name:
        return "invalid name"
    return None


def extract_zip(source: str, zip_path: Path, dest: Path, staged: Staged) -> None:
    max_entries = settings.TAXONOMY_MAX_ZIP_ENTRIES
    max_total = settings.TAXONOMY_MAX_UNZIPPED_MB * 1024 * 1024
    try:
        archive = zipfile.ZipFile(zip_path)
    except (zipfile.BadZipFile, OSError):
        raise UploadRejected(["the file is not a valid ZIP archive"])
    with archive:
        infos = archive.infolist()
        staged.zip_entries = len(infos)
        if len(infos) > max_entries:
            raise UploadRejected([f"the ZIP has {len(infos)} entries; the limit is {max_entries}"], code="ZIP_TOO_MANY_ENTRIES")
        problems = [f"{info.filename[:120]}: {reason}" for info in infos if (reason := _unsafe(info))]
        if problems:
            raise UploadRejected(["unsafe ZIP entries rejected: " + "; ".join(problems[:10])], code="ZIP_UNSAFE")
        declared = sum(info.file_size for info in infos)
        if declared > max_total:
            raise UploadRejected([f"the ZIP expands to {declared // 2**20} MB; the limit is "
                                  f"{settings.TAXONOMY_MAX_UNZIPPED_MB} MB"], status=413, code="ZIP_TOO_LARGE")
        staged.uncompressed_bytes = declared
        written_total = 0
        for info in infos:
            if info.is_dir():
                continue
            target_name = expected_name(source, info.filename)
            if target_name is None:
                staged.ignored.append(info.filename[:200])
                continue
            if target_name in staged.files:
                raise UploadRejected([f"the ZIP contains {target_name} more than once"], code="ZIP_DUPLICATE")
            target = dest / target_name
            written = 0
            with archive.open(info) as src, open(target, "wb") as out:
                while chunk := src.read(CHUNK):
                    written += len(chunk)
                    written_total += len(chunk)
                    if written > info.file_size or written_total > max_total:
                        raise UploadRejected(["the ZIP expands beyond its declared size or the limit "
                                              f"of {settings.TAXONOMY_MAX_UNZIPPED_MB} MB"], status=413, code="ZIP_TOO_LARGE")
                    out.write(chunk)
            staged.files[target_name] = written


# ── staging an upload ─────────────────────────────────────────────────────────
async def stage_upload(source: str, uploads: List[Tuple[str, object]], dest: Path) -> Staged:
    """
    uploads: [(filename, async-readable file with .read(n))]. Copies in chunks (never
    holding a whole file in memory), enforcing TAXONOMY_MAX_UPLOAD_MB in total.
    """
    max_upload = settings.TAXONOMY_MAX_UPLOAD_MB * 1024 * 1024
    staged = Staged()
    if not uploads:
        raise UploadRejected(["no files were uploaded"])
    names = [(name or "").lower() for name, _ in uploads]
    zips = [n for n in names if n.endswith(".zip")]
    if zips and len(uploads) > 1:
        raise UploadRejected(["upload either one ZIP or the individual CSV files, not both"])

    async def copy(handle, target: Path) -> int:
        size = 0
        with open(target, "wb") as out:
            while chunk := await handle.read(CHUNK):
                size += len(chunk)
                staged.upload_bytes += len(chunk)
                if staged.upload_bytes > max_upload:
                    raise UploadRejected([f"the upload is larger than {settings.TAXONOMY_MAX_UPLOAD_MB} MB"],
                                         status=413, code="UPLOAD_TOO_LARGE")
                out.write(chunk)
        return size

    if zips:
        staged.mode = "zip"
        archive = dest / "upload.zip"
        await copy(uploads[0][1], archive)
        try:
            await asyncio.to_thread(extract_zip, source, archive, dest, staged)
        finally:
            archive.unlink(missing_ok=True)
        return staged

    for filename, handle in uploads:
        target_name = expected_name(source, filename or "")
        if target_name is None:
            staged.ignored.append((filename or "")[:200])
            continue
        if target_name in staged.files:
            raise UploadRejected([f"{target_name} was uploaded more than once"])
        staged.files[target_name] = await copy(handle, dest / target_name)
    return staged


# ── validation ────────────────────────────────────────────────────────────────
def file_spec(source: str) -> Tuple[dict, tuple, tuple]:
    """(columns per base, suffixes, optional bases): the importers' own requirements."""
    if source == "onet":
        return onet_module.FILES, ("",), ()
    return esco_module.FILES, ("_en", ""), esco_module.OPTIONAL


def validate_directory(source: str, directory: Path) -> Tuple[Dict[str, dict], List[str]]:
    """Required files and columns, UTF-8 and row counts — the same rules the importers use.
    → ({file name: {bytes, rows}}, [errors])."""
    spec, suffixes, optional = file_spec(source)
    found, errors = check_files(directory, spec, suffixes, optional)
    files = {}
    for base, path in found.items():
        rows, problem = scan_rows(path)
        files[path.name] = {"bytes": path.stat().st_size, "rows": rows}
        if problem:
            errors.append(problem)
    missing_optional = [b for b in optional if b not in found]
    if missing_optional and not errors:
        files["_notes"] = {"optional_missing": missing_optional}
    return files, errors


async def run_validation(job_id: str, db=None) -> None:
    """Background step: validating → validated | failed (errors stored in the job)."""
    job = await jobs.transition(job_id, jobs.VALIDATING, note="Checking files and columns", db=db)
    directory = Path(job["staging_dir"])
    files, errors = await asyncio.to_thread(validate_directory, job["source"], directory)
    summary = {**(job.get("file_summary") or {}), "validated_files": files}
    if errors:
        remove_staging(job.get("staging_dir"))
        await jobs.transition(job_id, jobs.FAILED, note=f"{len(errors)} validation error(s)", db=db,
                              validation_errors=errors, file_summary=summary, error="Validation failed",
                              staging_dir=None)
        return
    await jobs.transition(job_id, jobs.VALIDATED, note="Files and columns are valid", db=db,
                          validation_errors=[], file_summary=summary)


async def create_upload_job(source: str, dataset_version: str, created_by: str,
                            uploads: List[Tuple[str, object]], db=None) -> dict:
    """
    Stage an upload and start validation in the background → the job (status uploaded).
    An unsafe or oversized upload raises UploadRejected after recording a failed job,
    so every attempt appears in the history.
    """
    if source not in jobs.SOURCES:
        raise UploadRejected([f"source must be one of {', '.join(jobs.SOURCES)}"])
    label, _ = version_label(source, dataset_version)
    dest = new_staging_dir()
    job = await jobs.create_job(source, label, created_by, db=db)
    await jobs.update_job(job["job_id"], db, staging_dir=str(dest))
    try:
        staged = await stage_upload(source, uploads, dest)
    except UploadRejected as exc:
        remove_staging(str(dest))
        await jobs.transition(job["job_id"], jobs.VALIDATING, db=db)
        await jobs.transition(job["job_id"], jobs.FAILED, note=exc.code, db=db, validation_errors=exc.errors,
                              error="Upload rejected", staging_dir=None)
        exc.job_id = job["job_id"]
        raise
    await jobs.update_job(job["job_id"], db, file_summary=staged.summary())
    jobs.run_in_background(job["job_id"], lambda: run_validation(job["job_id"], db), db=db)
    return await jobs.get_job(job["job_id"], db=db)


async def cancel_job(job_id: str, note: str = "Cancelled by an admin", db=None) -> dict:
    job = await jobs.transition(job_id, jobs.CANCELLED, note=note, db=db)
    remove_staging(job.get("staging_dir"))
    await jobs.update_job(job_id, db, staging_dir=None)
    return await jobs.get_job(job_id, db=db)


# ── cleanup ───────────────────────────────────────────────────────────────────
async def cleanup_staging(db=None, now: Optional[float] = None) -> Dict[str, int]:
    """
    Delete staging directories of finished jobs, of jobs older than the TTL (those
    jobs are cancelled as expired) and orphan directories with no job.
    Running jobs (validating / previewing / publishing) are never touched.
    """
    now = now or time.time()
    ttl = settings.TAXONOMY_STAGING_TTL_HOURS * 3600
    root = staging_root()
    counts = {"removed": 0, "expired_jobs": 0}
    db = db if db is not None else get_database()
    by_dir = {}
    async for job in db[jobs.JOBS].find({"staging_dir": {"$ne": None}}, {"job_id": 1, "status": 1, "staging_dir": 1}):
        by_dir[str(Path(job["staging_dir"]).resolve())] = job
    for entry in root.iterdir():
        if not entry.is_dir():
            continue
        job = by_dir.get(str(entry.resolve()))
        age = now - entry.stat().st_mtime
        if job is None:
            if age > 3600:  # orphan (e.g. a crash before the job was written)
                counts["removed"] += remove_staging(str(entry))
            continue
        if job["status"] in jobs.RUNNING:
            continue
        if job["status"] in jobs.FINAL:
            counts["removed"] += remove_staging(str(entry))
            await jobs.update_job(job["job_id"], db, staging_dir=None)
        elif age > ttl:
            try:
                await cancel_job(job["job_id"], note=f"Expired after {settings.TAXONOMY_STAGING_TTL_HOURS} h", db=db)
                counts["expired_jobs"] += 1
                counts["removed"] += 1
            except jobs.JobStateError:
                pass
    return counts


async def run_cleanup(db=None, interval: Optional[float] = None) -> None:
    interval = interval or settings.TAXONOMY_CLEANUP_INTERVAL_SECONDS
    while True:
        try:
            await cleanup_staging(db)
        except Exception:  # noqa: BLE001 — retried next round
            pass
        await asyncio.sleep(interval)


def staged_dir_of(job: dict) -> Optional[Path]:
    path = job.get("staging_dir")
    return Path(path) if path and os.path.isdir(path) else None
