"""
Internal admin taxonomy routes (09c, Module 10 FE-4 / FR12.5), called by
CoreServices' /api/admin/taxonomy pass-through. Mounted at /internal (never proxied
by the gateway); X-Internal-Key required.

  GET  /internal/admin/taxonomy/jobs            list import jobs (page, limit, status, source)
  GET  /internal/admin/taxonomy/jobs/{job_id}   one job (poll for progress)
  GET  /internal/admin/taxonomy/lock            who holds the taxonomy lock, if anyone
"""

from typing import Literal, Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse

from app.config.database import get_database
from app.middleware.internal_auth import require_internal_key
from app.services.taxonomy import jobs
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
