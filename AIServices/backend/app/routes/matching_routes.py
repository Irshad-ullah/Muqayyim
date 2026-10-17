"""
Internal career-matching routes (Module 5, FR7.1–FR7.7, FR7.10), called only by CoreServices'
/api/career-matches. The user is X-User-Id, set by Core from the verified JWT and trusted only
together with X-Internal-Key. It is a header, not part of the path, so access logs never contain
it. Mounted at /internal (never proxied by the gateway).

  GET /internal/matching/matches                      ranked list (cached per user)
  GET /internal/matching/matches/{profession_id}      one result: breakdown, explanation, gaps

Errors (safe messages, no internal details — FR7.10):
  503 EMBEDDINGS_PENDING / MODEL_LOADING / INDEX_BUILDING / NO_PROFESSIONS (Retry-After),
  503 MATCHING_UNAVAILABLE (database or configuration), 404 PROFESSION_NOT_FOUND, 400 INVALID_*.
Logs: a hash of the user id, timings and the result count only — never skills.

Scoring mode (Module 5.2): X-Related-Credit: true|false, set by CoreServices from its systemconfigs key
matching.related_credit (default false). Anything but "true" means off (exact / alias / any-of credit only).
"""

import hashlib
import logging
import re
import time

from typing import Optional

from fastapi import APIRouter, Depends, Header
from fastapi.responses import JSONResponse

from app.config.database import get_database
from app.middleware.internal_auth import require_internal_key
from app.services.embeddings.model import get_embedder
from app.services.embeddings.user_profiles import EmbeddingsPending
from app.services.matching import service
from app.services.professions.role_index import WAITING_FOR_MODEL, IndexUnavailable, ThresholdUnavailable, get_role_index

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/internal/matching", tags=["Internal"], dependencies=[Depends(require_internal_key)])

USER_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
PROFESSION_ID = re.compile(r"^(onet|esco|curated|manual):[A-Za-z0-9._-]{1,100}$")

RETRY = {"EMBEDDINGS_PENDING": 10, "MODEL_LOADING": 15, "INDEX_BUILDING": 10, "NO_PROFESSIONS": 60}
MESSAGES = {
    "EMBEDDINGS_PENDING": "Your skills are still being analysed. Career matches will be ready in a moment.",
    "MODEL_LOADING": "The skill model is starting up. Career matches will be available shortly.",
    "INDEX_BUILDING": "The career database is being prepared. Please try again shortly.",
    "NO_PROFESSIONS": "No careers are available yet. Please try again later.",
    "MATCHING_UNAVAILABLE": "Career matching is temporarily unavailable. Please try again shortly.",
    "PROFESSION_NOT_FOUND": "That career was not found.",
}


def user_ref(user_id: str) -> str:
    """For logs: never the id itself."""
    return hashlib.sha256(user_id.encode()).hexdigest()[:12]


def error(status: int, code: str, message: str = None) -> JSONResponse:
    retry = RETRY.get(code)
    body = {"success": False, "code": code, "message": message or MESSAGES[code]}
    if retry:
        body["retry_after_seconds"] = retry
    return JSONResponse(status_code=status, content=body, headers={"Retry-After": str(retry)} if retry else None)


def unavailable(exc: Exception) -> JSONResponse:
    """Maps the not-ready states to their own codes so the page can tell them apart."""
    if isinstance(exc, EmbeddingsPending):
        return error(503, "EMBEDDINGS_PENDING" if get_embedder().ready else "MODEL_LOADING")
    if isinstance(exc, IndexUnavailable):
        if exc.code == "NO_PROFESSIONS":
            return error(503, "NO_PROFESSIONS")
        return error(503, "MODEL_LOADING" if get_role_index().state == WAITING_FOR_MODEL else "INDEX_BUILDING")
    return error(503, "MATCHING_UNAVAILABLE")  # ThresholdUnavailable: a configuration problem, not shown


def related_credit_on(value: Optional[str]) -> bool:
    return (value or "").strip().lower() == "true"


def bad_user() -> JSONResponse:
    return error(400, "INVALID_USER_ID", "X-User-Id (the signed-in user, set by CoreServices) is required")


@router.get("/matches")
async def list_matches(user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
                       related_credit: Optional[str] = Header(default=None, alias="X-Related-Credit")):
    if not user_id or not USER_ID.match(user_id):
        return bad_user()
    db = get_database()
    if db is None:
        return error(503, "MATCHING_UNAVAILABLE")
    started = time.perf_counter()
    try:
        data = await service.get_matches(user_id, db, related_credit_on(related_credit))
    except service.NoSkills:
        return {"success": True, "data": {"state": "no_skills", "results": [], "skill_count": 0, "gaps": []}}
    except (EmbeddingsPending, IndexUnavailable, ThresholdUnavailable) as exc:
        return unavailable(exc)
    logger.info("career matches user=%s results=%d cached=%s ms=%.0f", user_ref(user_id), len(data["results"]),
                data["cached"], (time.perf_counter() - started) * 1000)
    return {"success": True, "data": {"state": "ready", **data}}


@router.get("/matches/{profession_id}")
async def match_detail(profession_id: str, user_id: Optional[str] = Header(default=None, alias="X-User-Id"),
                       related_credit: Optional[str] = Header(default=None, alias="X-Related-Credit")):
    if not user_id or not USER_ID.match(user_id):
        return bad_user()
    if not PROFESSION_ID.match(profession_id):
        return error(404, "PROFESSION_NOT_FOUND")
    db = get_database()
    if db is None:
        return error(503, "MATCHING_UNAVAILABLE")
    started = time.perf_counter()
    try:
        data = await service.get_match_detail(user_id, profession_id, db, related_credit_on(related_credit))
    except service.ProfessionNotFound:
        return error(404, "PROFESSION_NOT_FOUND")  # unknown or inactive
    except service.NoSkills:
        return error(404, "PROFESSION_NOT_FOUND", "Add skills to your profile to see career details.")
    except (EmbeddingsPending, IndexUnavailable, ThresholdUnavailable) as exc:
        return unavailable(exc)
    logger.info("career match detail user=%s members=%d ms=%.0f", user_ref(user_id), len(data["members"]),
                (time.perf_counter() - started) * 1000)
    return {"success": True, "data": data}
