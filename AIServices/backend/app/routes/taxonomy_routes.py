"""
Internal admin taxonomy routes (09c, Module 10 FE-4 / FR12.5), called by
CoreServices' /api/admin/taxonomy pass-through. Mounted at /internal (never proxied
by the gateway); X-Internal-Key required.

  POST /internal/admin/taxonomy/jobs            upload (multipart: source, dataset_version, created_by,
                                                files = one ZIP or the CSV files) → 202, validates in background
  GET  /internal/admin/taxonomy/jobs            list import jobs (page, limit, status, source)
  GET  /internal/admin/taxonomy/jobs/{job_id}   one job (poll for progress)
  POST /internal/admin/taxonomy/jobs/{job_id}/cancel
  POST /internal/admin/taxonomy/jobs/{job_id}/preview   stage + diff + checks (202, background)
  GET  /internal/admin/taxonomy/jobs/{job_id}/diff      ?section=&page=&limit= detail rows
  GET  /internal/admin/taxonomy/lock            who holds the taxonomy lock, if anyone
"""

from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse
from starlette.datastructures import UploadFile

from app.config.database import get_database
from app.middleware.internal_auth import require_internal_key
from app.config.settings import settings
from app.services.taxonomy import jobs, pipeline, uploads
from app.services.taxonomy.lock import current_lock

router = APIRouter(prefix="/internal/admin/taxonomy", tags=["Internal"], dependencies=[Depends(require_internal_key)])


def error(status: int, code: str, message: str, **extra) -> JSONResponse:
    return JSONResponse(status_code=status, content={"success": False, "code": code, "message": message, **extra})


def no_db() -> JSONResponse:
    return error(503, "DATABASE_UNAVAILABLE", "Database not available")


@router.get("/jobs")
async def list_jobs(
    page: int = Query(1, ge=1, le=10000),
    limit: int = Query(20, ge=1, le=100),
    status: Optional[Literal[jobs.STATUSES]] = None,  # type: ignore[valid-type]
    source: Optional[Literal["onet", "esco"]] = None,
):
    if get_database() is None:
        return no_db()
    result = await jobs.list_jobs(page, limit, status, source)
    return {"success": True, "data": result["items"],
            "pagination": {k: result[k] for k in ("page", "limit", "total", "pages")}}


@router.get("/jobs/{job_id}")
async def get_job(job_id: str):
    if get_database() is None:
        return no_db()
    try:
        return {"success": True, "data": jobs.public(await jobs.get_job(job_id))}
    except jobs.JobNotFound:
        return error(404, "NOT_FOUND", "Import job not found")


@router.get("/lock")
async def lock_status():
    if get_database() is None:
        return no_db()
    return {"success": True, "data": await current_lock()}


MAX_FILES = 10
FORM_OVERHEAD = 1024 * 1024  # multipart boundaries and small fields


@router.post("/jobs")
async def upload(request: Request):
    """Stage an upload for one source and start validation (202). 413 too large, 422 rejected."""
    if get_database() is None:
        return no_db()
    limit = settings.TAXONOMY_MAX_UPLOAD_MB * 1024 * 1024
    length = request.headers.get("content-length")
    if length is None:
        return error(411, "LENGTH_REQUIRED", "Content-Length is required for uploads")
    if not length.isdigit() or int(length) > limit + FORM_OVERHEAD:
        return error(413, "UPLOAD_TOO_LARGE", f"The upload is larger than {settings.TAXONOMY_MAX_UPLOAD_MB} MB")
    try:
        form = await request.form(max_files=MAX_FILES, max_fields=10)
    except Exception:  # noqa: BLE001 — malformed multipart, too many parts
        return error(422, "UPLOAD_REJECTED", f"Send multipart form data with at most {MAX_FILES} files")
    try:
        source = str(form.get("source") or "").strip().lower()
        files = [f for f in form.getlist("files") if isinstance(f, UploadFile)]
        try:
            job = await uploads.create_upload_job(
                source, str(form.get("dataset_version") or ""), str(form.get("created_by") or "unknown")[:100],
                [(f.filename, f) for f in files],
            )
        except uploads.UploadRejected as exc:
            return error(exc.status, exc.code, exc.safe_message, errors=exc.errors, job_id=getattr(exc, "job_id", None))
        return JSONResponse(status_code=202, content={"success": True, "data": jobs.public(job)})
    finally:
        await form.close()


@router.post("/jobs/{job_id}/cancel")
async def cancel(job_id: str):
    if get_database() is None:
        return no_db()
    try:
        return {"success": True, "data": jobs.public(await uploads.cancel_job(job_id))}
    except jobs.JobNotFound:
        return error(404, "NOT_FOUND", "Import job not found")
    except jobs.JobStateError as exc:
        return error(409, "JOB_STATE", str(exc), job_status=exc.status)


@router.post("/jobs/{job_id}/preview")
async def preview(job_id: str):
    """Build the staged data, diff it against the live data and run the checks (FR12.5)."""
    if get_database() is None:
        return no_db()
    try:
        job = await pipeline.start_preview(job_id)
    except jobs.JobNotFound:
        return error(404, "NOT_FOUND", "Import job not found")
    except jobs.JobStateError as exc:
        return error(409, "JOB_STATE", f"A preview needs a validated job; this one is {exc.status}", job_status=exc.status)
    return JSONResponse(status_code=202, content={"success": True, "data": jobs.public(job)})


@router.get("/jobs/{job_id}/diff")
async def diff_detail(
    job_id: str,
    section: Literal[pipeline.SECTIONS],  # type: ignore[valid-type]
    page: int = Query(1, ge=1, le=100000),
    limit: int = Query(50, ge=1, le=200),
):
    if get_database() is None:
        return no_db()
    try:
        job = await jobs.get_job(job_id)
    except jobs.JobNotFound:
        return error(404, "NOT_FOUND", "Import job not found")
    if not job.get("diff_summary"):
        return error(409, "NO_PREVIEW", "This job has no preview yet")
    result = await pipeline.diff_page(job_id, section, page, limit)
    return {"success": True, "data": result["items"],
            "pagination": {k: result[k] for k in ("page", "limit", "total", "pages")}}
