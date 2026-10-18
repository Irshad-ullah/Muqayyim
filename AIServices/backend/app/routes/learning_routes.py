"""
Internal learning-path routes (Module 6), called only by CoreServices' /api/learning-paths. The user is X-User-Id
(from Core's verified JWT), trusted only with X-Internal-Key. Mounted at /internal (never proxied by the gateway).

  POST /internal/learning/structure   {profession_id, choices?: {requirement key: alternative key},
                                       prerequisites?: [[before, after], ...]} → the deterministic path structure

Errors: 400 INVALID_USER_ID, 404 PROFESSION_NOT_FOUND, 422 INVALID_CHOICE, 503 as in career matching
(EMBEDDINGS_PENDING / MODEL_LOADING / INDEX_BUILDING / NO_PROFESSIONS / MATCHING_UNAVAILABLE).
"""

from typing import Dict, List, Optional

from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, ConfigDict, Field

from app.config.database import get_database
from app.middleware.internal_auth import require_internal_key
from app.routes.matching_routes import PROFESSION_ID, USER_ID, bad_user, error, unavailable
from app.services.embeddings.user_profiles import EmbeddingsPending
from app.services.learning import structure
from app.services.matching import service
from app.services.professions.role_index import IndexUnavailable, ThresholdUnavailable

router = APIRouter(prefix="/internal/learning", tags=["Internal"], dependencies=[Depends(require_internal_key)])


class StructureRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    profession_id: str = Field(..., max_length=120)
    choices: Dict[str, str] = Field(default_factory=dict, max_length=40)
    prerequisites: List[List[str]] = Field(default_factory=list, max_length=60)


@router.post("/structure")
async def build_structure(body: StructureRequest, user_id: Optional[str] = Header(default=None, alias="X-User-Id")):
    if not user_id or not USER_ID.match(user_id):
        return bad_user()
    if not PROFESSION_ID.match(body.profession_id):
        return error(404, "PROFESSION_NOT_FOUND")
    db = get_database()
    if db is None:
        return error(503, "MATCHING_UNAVAILABLE")
    try:
        owned = await service.user_skills(user_id, db)
        data = await structure.build(owned, body.profession_id, db, body.choices, body.prerequisites)
    except (service.NoSkills, structure.ProfessionNotFound):
        return error(404, "PROFESSION_NOT_FOUND")
    except structure.InvalidChoice as exc:
        return error(422, "INVALID_CHOICE", exc.safe_message)
    except (EmbeddingsPending, IndexUnavailable, ThresholdUnavailable) as exc:
        return unavailable(exc)
    return {"success": True, "data": data}
