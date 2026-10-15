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
  POST /internal/admin/taxonomy/jobs/{job_id}/publish   {acknowledge_background_warning, actor} → 202
  GET  /internal/admin/taxonomy/snapshots               kept snapshots (?pool=publish|edit)
  GET  /internal/admin/taxonomy/snapshots/{id}          one snapshot + what a restore would undo
  POST /internal/admin/taxonomy/snapshots/{id}/restore  {actor} → 202, whole-state restore in the background
  GET  /internal/admin/taxonomy/restores[/{restore_id}] restore progress and result (poll)
  GET  /internal/admin/taxonomy/lock            who holds the taxonomy lock, if anyone
"""

from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, Query, Request
from fastapi.responses import JSONResponse
from starlette.datastructures import UploadFile

from app.config.database import get_database
from app.middleware.internal_auth import require_internal_key
from app.config.settings import settings
from pydantic import BaseModel, ConfigDict, Field

from app.services.taxonomy import jobs, pipeline, publishing, snapshots, uploads
from app.services.taxonomy.lock import TaxonomyBusy, current_lock

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


def busy(exc: TaxonomyBusy) -> JSONResponse:
    return error(409, "TAXONOMY_BUSY", str(exc), lock=exc.current)


class _PublishIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    acknowledge_background_warning: bool = False
    actor: str = Field("unknown", max_length=100)


@router.post("/jobs/{job_id}/publish")
async def publish(job_id: str, body: _PublishIn):
    """Publish a previewed job (202). 409 busy / not previewed / live data changed; 422 needs the acknowledgement."""
    if get_database() is None:
        return no_db()
    try:
        job = await publishing.start_publish(job_id, body.acknowledge_background_warning, body.actor)
    except jobs.JobNotFound:
        return error(404, "NOT_FOUND", "Import job not found")
    except jobs.JobStateError as exc:
        return error(409, "JOB_STATE", f"Only a previewed job can be published; this one is {exc.status}",
                     job_status=exc.status)
    except publishing.PublishRefused as exc:
        return error(exc.status, exc.code, exc.safe_message)
    except TaxonomyBusy as exc:
        return busy(exc)
    return JSONResponse(status_code=202, content={"success": True, "data": jobs.public(job)})


@router.get("/snapshots")
async def list_snapshots(pool: Optional[Literal["publish", "edit"]] = None):
    if get_database() is None:
        return no_db()
    return {"success": True, "data": await snapshots.list_snapshots(pool=pool)}


@router.get("/snapshots/{snapshot_id}")
async def get_snapshot(snapshot_id: str):
    """The snapshot and what restoring it would undo (for the confirmation dialog)."""
    if get_database() is None:
        return no_db()
    try:
        return {"success": True, "data": await snapshots.undone_by_restore(snapshot_id)}
    except snapshots.SnapshotNotFound:
        return error(404, "NOT_FOUND", "Snapshot not found")


class _RestoreIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    actor: str = Field("unknown", max_length=100)


@router.post("/snapshots/{snapshot_id}/restore")
async def restore(snapshot_id: str, body: _RestoreIn):
    """Start a whole-state restore (202); poll GET /restores/{restore_id}."""
    if get_database() is None:
        return no_db()
    try:
        record = await publishing.start_restore(snapshot_id, body.actor)
    except snapshots.SnapshotNotFound:
        return error(404, "NOT_FOUND", "Snapshot not found")
    except TaxonomyBusy as exc:
        return busy(exc)
    return JSONResponse(status_code=202, content={"success": True, "data": jobs.public(record)})


@router.get("/restores")
async def list_restores():
    if get_database() is None:
        return no_db()
    return {"success": True, "data": await publishing.list_restores()}


@router.get("/restores/{restore_id}")
async def get_restore(restore_id: str):
    if get_database() is None:
        return no_db()
    record = await publishing.get_restore(restore_id)
    if not record:
        return error(404, "NOT_FOUND", "Restore not found")
    return {"success": True, "data": jobs.public(record)}


# ── Part 5: direct edits (lock + edit snapshot + undo on failure) ────────────
from app.services.professions import crud as profession_crud  # noqa: E402
from app.services.taxonomy import editing, skills_editor  # noqa: E402


def edit_error(exc) -> JSONResponse:
    if isinstance(exc, profession_crud.ProfessionError):
        return error(exc.status, exc.code, exc.message)
    if isinstance(exc, editing.EditRefused):
        return error(exc.status, exc.code, exc.safe_message, errors=exc.errors)
    if isinstance(exc, TaxonomyBusy):
        return busy(exc)
    if isinstance(exc, editing.EditFailed):
        return error(500, "EDIT_FAILED", exc.safe_message, rolled_back=exc.rolled_back)
    raise exc


async def run_guarded(coro):
    if get_database() is None:
        return no_db()
    try:
        return {"success": True, "data": await coro}
    except (profession_crud.ProfessionError, editing.EditRefused, TaxonomyBusy, editing.EditFailed) as exc:
        return edit_error(exc)


@router.get("/professions")
async def list_professions(
    page: int = Query(1, ge=1, le=10000),
    limit: int = Query(20, ge=1, le=100),
    search: Optional[str] = Query(None, max_length=100),
    category: Optional[str] = Query(None, max_length=60),
    active: Optional[bool] = None,
    source: Optional[Literal["onet", "esco", "manual"]] = None,
):
    if get_database() is None:
        return no_db()
    result = await profession_crud.list_professions(page, limit, search, category, active, source)
    return {"success": True, "data": result["items"],
            "pagination": {k: result[k] for k in ("page", "limit", "total", "pages")}}


@router.get("/professions/{profession_id}")
async def get_profession(profession_id: str):
    return await run_guarded(profession_crud.get_profession(profession_id))


class _ProfessionEditIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: Optional[str] = Field(None, min_length=2, max_length=200)
    description: Optional[str] = Field(None, max_length=5000)
    category: Optional[str] = Field(None, max_length=60)
    active: Optional[bool] = None
    actor: str = Field("unknown", max_length=100)


@router.patch("/professions/{profession_id}")
async def edit_profession(profession_id: str, body: _ProfessionEditIn):
    """Edit title / description / category / active. Imported professions: an admin override
    that survives re-imports (reset with POST .../reset)."""
    changes = body.model_dump(exclude_unset=True, exclude={"actor"})
    if not changes:
        return error(422, "VALIDATION_ERROR", "Nothing to change")
    return await run_guarded(editing.edit_profession(profession_id, changes, body.actor))


class _ResetIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    fields: Optional[List[Literal["title", "description", "category", "active"]]] = None
    actor: str = Field("unknown", max_length=100)


@router.post("/professions/{profession_id}/reset")
async def reset_profession(profession_id: str, body: _ResetIn):
    """Reset admin overrides to the dataset values (all, or the given fields)."""
    return await run_guarded(editing.reset_profession(profession_id, body.fields, body.actor))


@router.get("/skills")
async def list_skills(
    search: Optional[str] = Query(None, max_length=100),
    category: Optional[str] = Query(None, max_length=60),
    page: int = Query(1, ge=1, le=10000),
    limit: int = Query(50, ge=1, le=200),
):
    result = skills_editor.list_skills(search, category, page, limit)
    return {"success": True, "data": result["items"], "categories": result["categories"],
            "pagination": {k: result[k] for k in ("page", "limit", "total", "pages")}}


@router.get("/skills/{name}")
async def get_skill(name: str):
    skill = skills_editor.get_skill(name)
    if not skill:
        return error(404, "NOT_FOUND", "Skill not found")
    return {"success": True, "data": skill}


class _SkillIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(..., min_length=1, max_length=100)
    description: Optional[str] = Field(None, max_length=400)
    aliases: Optional[List[str]] = Field(None, max_length=50)
    category: Optional[str] = Field(None, max_length=60)
    actor: str = Field("unknown", max_length=100)


class _SkillValidateIn(_SkillIn):
    create: bool = False


@router.post("/skills/validate")
async def validate_skill(body: _SkillValidateIn):
    """Dry run: the errors the change would produce. Nothing is written."""
    change = body.model_dump(exclude_unset=True, exclude={"actor", "create"})
    return {"success": True, "data": skills_editor.validate(change, body.create)}


@router.post("/skills")
async def create_skill(body: _SkillIn):
    change = body.model_dump(exclude_unset=True, exclude={"actor"})
    response = await run_guarded(skills_editor.save(change, True, body.actor))
    if isinstance(response, dict):
        return JSONResponse(status_code=201, content=response)
    return response


class _SkillUpdateIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    description: Optional[str] = Field(None, max_length=400)
    aliases: Optional[List[str]] = Field(None, max_length=50)
    category: Optional[str] = Field(None, max_length=60)
    actor: str = Field("unknown", max_length=100)


@router.put("/skills/{name}")
async def update_skill(name: str, body: _SkillUpdateIn):
    change = {"name": name, **body.model_dump(exclude_unset=True, exclude={"actor"})}
    if len(change) == 1:
        return error(422, "VALIDATION_ERROR", "Nothing to change")
    return await run_guarded(skills_editor.save(change, False, body.actor))
