"""
Internal LLM routes (12), called by CoreServices only (X-Internal-Key; never proxied by the gateway).

  GET    /internal/llm/status        enabled / provider / model, the limits (provider and effective),
                                     today's request count, the per-user quota — never the key
  GET    /internal/llm/usage?days=7  per-feature calls, cache hits, errors, tokens, mean latency
  DELETE /internal/llm/user-data     X-User-Id: delete that user's cached LLM outputs
                                     (consent withdrawn or account deleted)
  POST   /internal/llm/cv-assist     X-User-Id: CV assist (Module 4) — suggestion + truthfulness flags.
                                     Core checks consent and builds the facts; contact fields are refused.
"""

import re
from typing import Optional

from fastapi import APIRouter, Depends, Header, Query
from fastapi.responses import JSONResponse

from app.config.database import get_database
from app.config.settings import settings
from app.middleware.internal_auth import require_internal_key
from app.services.llm import client as llm_client
from app.services.llm import limits, usage
from app.services.llm.errors import LLMError
from app.services.cv_assist import service as cv_assist

router = APIRouter(prefix="/internal/llm", tags=["Internal"], dependencies=[Depends(require_internal_key)])
USER_ID = re.compile(r"^[A-Za-z0-9_-]{1,64}$")


def _error(status: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"success": False, "code": code, "message": message})


@router.get("/status")
async def status():
    db = get_database()
    data = {
        **llm_client.get_llm_client().status(),
        "limits": {
            "provider": {"rpm": settings.LLM_RPM, "tpm": settings.LLM_TPM, "rpd": settings.LLM_RPD},
            "fraction": settings.LLM_LIMIT_FRACTION,
            "effective": {"rpm": limits.effective(settings.LLM_RPM), "tpm": limits.effective(settings.LLM_TPM),
                          "rpd": limits.effective(settings.LLM_RPD)},
            "user_daily_quota": settings.LLM_USER_DAILY_QUOTA,
            "cache_ttl_days": settings.LLM_CACHE_TTL_DAYS,
            "timeout_s": settings.LLM_TIMEOUT_S,
        },
    }
    if db is not None:
        data["today"] = await limits.today(db)
    return {"success": True, "data": data}


@router.get("/usage")
async def usage_summary(days: int = Query(7, ge=1, le=365)):
    db = get_database()
    if db is None:
        return _error(503, "DATABASE_UNAVAILABLE", "Database not available")
    return {"success": True, "data": await usage.summary(db, days)}


@router.delete("/user-data")
async def delete_user_data(user_id: Optional[str] = Header(default=None, alias="X-User-Id")):
    if not user_id or not USER_ID.match(user_id):
        return _error(400, "INVALID_USER_ID", "X-User-Id (set by CoreServices) is required")
    db = get_database()
    if db is None:
        return _error(503, "DATABASE_UNAVAILABLE", "Database not available")
    return {"success": True, "data": await llm_client.delete_user_data(user_id, db)}


def llm_error(exc: LLMError) -> JSONResponse:
    body = {"success": False, "code": exc.code, "message": exc.safe_message}
    headers = None
    if exc.retry_after:
        body["retry_after_seconds"] = int(exc.retry_after)
        headers = {"Retry-After": str(int(exc.retry_after))}
    return JSONResponse(status_code=exc.status, content=body, headers=headers)


@router.post("/cv-assist")
async def cv_assist_route(body: cv_assist.AssistRequest, user_id: Optional[str] = Header(default=None, alias="X-User-Id")):
    if not user_id or not USER_ID.match(user_id):
        return _error(400, "INVALID_USER_ID", "X-User-Id (set by CoreServices) is required")
    if get_database() is None:
        return _error(503, "DATABASE_UNAVAILABLE", "Database not available")
    if body.target != "summary" and body.entry is None:
        return _error(422, "VALIDATION_ERROR", "An entry is required for experience and project assistance")
    try:
        return {"success": True, "data": await cv_assist.assist(body, user_id)}
    except LLMError as exc:
        return llm_error(exc)
