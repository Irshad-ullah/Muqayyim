"""
Internal profession routes (Module 10 FE-4), called by CoreServices'
/api/admin/professions pass-through. Mounted at /internal (never proxied by the
gateway); X-Internal-Key required.

  GET    /internal/professions             list (page, limit, search, category, active, source)
  GET    /internal/professions/{id}        one profession
  POST   /internal/professions             create a manual profession
  PATCH  /internal/professions/{id}        update (imported: category / active only)
  DELETE /internal/professions/{id}        soft delete
  POST   /internal/index/rebuild           rebuild the role-skill FAISS index
  GET    /internal/index/status            index state
"""

from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.config.database import get_database
from app.middleware.internal_auth import require_internal_key
from app.services.professions import crud
from app.services.professions.imports import embed_and_rebuild
from app.services.professions.role_index import get_role_index

router = APIRouter(prefix="/internal", tags=["Internal"], dependencies=[Depends(require_internal_key)])


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"success": False, "code": code, "message": message})


def _no_db() -> JSONResponse:
    return _error(503, "DATABASE_UNAVAILABLE", "Database not available")


class _SkillIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    name: str = Field(..., min_length=1, max_length=100)
    type: Literal["essential", "optional", "technology"] = "essential"


def _strip_list(values: Optional[List[str]]) -> Optional[List[str]]:
    if values is None:
        return None
    return list(dict.fromkeys(v.strip() for v in values if v and v.strip()))


class _ProfessionBase(BaseModel):
    model_config = ConfigDict(extra="forbid")
    description: Optional[str] = Field(None, max_length=5000)
    category: Optional[str] = Field(None, max_length=60)
    alt_titles: Optional[List[str]] = Field(None, max_length=15)
    source_code: Optional[str] = Field(None, max_length=50)
    skills: Optional[List[_SkillIn]] = Field(None, max_length=100)
    active: Optional[bool] = None
    actor: Optional[str] = Field(None, max_length=100)  # admin id, for the audit fields

    @field_validator("alt_titles")
    @classmethod
    def _alt_titles(cls, values):
        values = _strip_list(values)
        if values and any(len(v) > 200 for v in values):
            raise ValueError("alternative titles must be at most 200 characters")
        return values


class _ProfessionCreate(_ProfessionBase):
    title: str = Field(..., min_length=2, max_length=200)


class _ProfessionUpdate(_ProfessionBase):
    title: Optional[str] = Field(None, min_length=2, max_length=200)


def _body(model: BaseModel) -> dict:
    data = model.model_dump(exclude_unset=True, exclude={"actor"})
    if "skills" in data and data["skills"] is not None:
        data["skills"] = [dict(s) for s in data["skills"]]
    return {k: v for k, v in data.items() if v is not None or k == "description"}


async def _call(fn, *args, status: int = 200, **kwargs):
    if get_database() is None:
        return _no_db()
    try:
        data = await fn(*args, **kwargs)
    except crud.ProfessionError as exc:
        return _error(exc.status, exc.code, exc.message)
    return JSONResponse(status_code=status, content={"success": True, "data": data})


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
        return _no_db()
    result = await crud.list_professions(page, limit, search, category, active, source)
    return {"success": True, "data": result["items"],
            "pagination": {"page": result["page"], "limit": result["limit"], "total": result["total"], "pages": result["pages"]}}


@router.get("/professions/{profession_id}")
async def get_profession(profession_id: str):
    return await _call(crud.get_profession, profession_id)


@router.post("/professions")
async def create_profession(body: _ProfessionCreate):
    return await _call(crud.create_profession, _body(body), body.actor, status=201)


@router.patch("/professions/{profession_id}")
async def update_profession(profession_id: str, body: _ProfessionUpdate):
    return await _call(crud.update_profession, profession_id, _body(body), body.actor)


@router.delete("/professions/{profession_id}")
async def delete_profession(profession_id: str, actor: Optional[str] = Query(None, max_length=100)):
    return await _call(crud.delete_profession, profession_id, actor)


@router.post("/index/rebuild")
async def rebuild_index(wait: bool = False):
    """Re-embed missing role skills and rebuild the index (background unless wait=true)."""
    if get_database() is None:
        return _no_db()
    return {"success": True, "index": await embed_and_rebuild(wait=wait)}


@router.get("/index/status")
async def index_status():
    return {"success": True, "index": get_role_index().health()}
