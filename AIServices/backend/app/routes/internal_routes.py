"""
Internal (service-to-service) routes. Mounted at /internal and never proxied
by the API Gateway. Protected by X-Internal-Key.
"""

import logging
from typing import List, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from app.config.database import get_database
from app.middleware.internal_auth import require_internal_key
from app.services.embeddings.user_profiles import delete_user_skills, upsert_user_skills

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/internal", tags=["Internal"], dependencies=[Depends(require_internal_key)])


@router.get("/cv/{user_id}/latest")
async def get_latest_cv_internal(user_id: str):
    """Latest parsed CV for a user (used by CoreServices' CV generator)."""
    db = get_database()
    if db is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Database not available")

    record = await db["cv_parsed_data"].find_one({"user_id": user_id}, sort=[("upload_date", -1)])
    if not record:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No CV data for this user")

    return {
        "cv": {
            "parsed_data": record.get("parsed_data") or {},
            "parsing_status": record.get("parsing_status"),
            "upload_date": record.get("upload_date"),
        }
    }


# ── Skill embeddings (Module 2 FE-5, FR-B9) ──────────────────────────────────
# CoreServices sends a user's merged profile skills whenever they change.


class _SkillIn(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    source: Literal["manual", "cv", "github"] = "manual"  # display only


class _UserSkillsIn(BaseModel):
    skills: List[_SkillIn] = Field(default_factory=list, max_length=500)
    requestedAt: Optional[float] = None  # ms since epoch; the latest request wins


@router.put("/embeddings/users/{user_id}")
async def put_user_skills(user_id: str, body: _UserSkillsIn):
    """Store the user's skill list and ensure every skill has a vector (202 while the model loads)."""
    if get_database() is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Database not available")
    code, payload = await upsert_user_skills(user_id, [s.model_dump() for s in body.skills], body.requestedAt)
    return JSONResponse(status_code=code, content=payload)


@router.delete("/embeddings/users/{user_id}")
async def delete_user_skill_profile(user_id: str):
    """Remove the user's skill profile (account deleted). Shared skill vectors stay cached."""
    if get_database() is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Database not available")
    return {"success": True, "deleted": await delete_user_skills(user_id)}
