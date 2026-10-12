"""
JWT Authentication Middleware
Module 2: CV Parsing Service

Decodes the JWT issued by Module 1 (CoreServices), then checks the user's
current state with CoreServices (cached for AUTH_CACHE_TTL_SECONDS): the user
must exist, be active, and the token must be newer than the last password
change. Authorization uses the role from the database, never the token claim.
Never accepts user_id from the request body. Tokens are never logged.
"""

import logging
from datetime import datetime

from fastapi import Depends, FastAPI, HTTPException, Request, status
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import ExpiredSignatureError, JWTError, jwt

from app.config.settings import settings
from app.services.auth_state_cache import get_auth_state_cached
from app.services.core_client import CoreUnavailable
from app.services.error_logger import set_request_context

logger = logging.getLogger(__name__)

_bearer_scheme = HTTPBearer(auto_error=False)


class AuthError(HTTPException):
    """Auth failure carrying a machine-readable code (same codes as CoreServices)."""

    def __init__(self, status_code: int, code: str, message: str):
        super().__init__(status_code=status_code, detail=message)
        self.code = code
        self.message = message


async def _auth_error_handler(_request: Request, exc: AuthError) -> JSONResponse:
    # `detail` kept for clients that read FastAPI's default shape.
    return JSONResponse(
        status_code=exc.status_code,
        content={"success": False, "code": exc.code, "message": exc.message, "detail": exc.message},
    )


def register_auth_error_handler(app: FastAPI) -> None:
    app.add_exception_handler(AuthError, _auth_error_handler)


def _token_revoked(iat, password_changed_at) -> bool:
    if not password_changed_at:
        return False
    if not isinstance(iat, (int, float)):
        return True
    changed = datetime.fromisoformat(str(password_changed_at).replace("Z", "+00:00"))
    return int(iat) < int(changed.timestamp())


async def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer_scheme),
) -> dict:
    """
    FastAPI dependency: validates the JWT and the user's live state, and
    returns {"user_id", "role"} with the role taken from CoreServices.
    """
    if credentials is None or not credentials.credentials:
        raise AuthError(status.HTTP_401_UNAUTHORIZED, "NO_TOKEN", "No token provided. Please login.")

    try:
        payload = jwt.decode(credentials.credentials, settings.JWT_SECRET, algorithms=[settings.ALGORITHM])
    except ExpiredSignatureError:
        raise AuthError(status.HTTP_401_UNAUTHORIZED, "TOKEN_EXPIRED", "Token expired. Please login again.")
    except JWTError as exc:
        logger.warning("JWT validation failed: %s", type(exc).__name__)
        raise AuthError(status.HTTP_401_UNAUTHORIZED, "TOKEN_INVALID", "Invalid token. Please login again.")

    user_id = payload.get("userId") or payload.get("id")
    if not user_id:
        raise AuthError(status.HTTP_401_UNAUTHORIZED, "TOKEN_INVALID", "Invalid token. Please login again.")
    user_id = str(user_id)
    set_request_context(user_id=user_id)

    try:
        state = await get_auth_state_cached(user_id)
    except CoreUnavailable:
        logger.error("Auth state unavailable for user %s (CoreServices unreachable, no cache)", user_id)
        raise AuthError(
            status.HTTP_503_SERVICE_UNAVAILABLE, "AUTH_UNAVAILABLE", "Service temporarily unavailable, try again."
        )

    if not state.get("exists"):
        raise AuthError(
            status.HTTP_401_UNAUTHORIZED, "USER_NOT_FOUND", "Your account no longer exists. Please login again."
        )
    if state.get("isActive") is False:
        raise AuthError(
            status.HTTP_403_FORBIDDEN, "ACCOUNT_DEACTIVATED", "Your account has been suspended. Contact support."
        )
    if _token_revoked(payload.get("iat"), state.get("passwordChangedAt")):
        raise AuthError(
            status.HTTP_401_UNAUTHORIZED, "TOKEN_REVOKED", "Your session has ended. Please log in again."
        )

    return {"user_id": user_id, "role": state.get("role", "JobSeeker")}
