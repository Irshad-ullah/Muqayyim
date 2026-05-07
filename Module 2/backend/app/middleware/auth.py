"""
JWT Authentication Middleware
Module 2: CV Parsing Service

Decodes the JWT issued by Module 1 (User Management Service) and extracts
user_id. Never accepts user_id from the request body.
"""

import logging
from fastapi import HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi import Depends
from jose import JWTError, jwt

from app.config.settings import settings

logger = logging.getLogger(__name__)

_bearer_scheme = HTTPBearer()


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(_bearer_scheme),
) -> dict:
    """
    FastAPI dependency that validates the JWT from the Authorization header
    and returns the decoded payload containing user_id.

    The JWT is issued by Module 1 (User Management Service) and carries:
      - userId  (primary key used by this service)
      - id      (alias, same value)
      - role

    Raises HTTP 401 for missing, expired, or invalid tokens.
    """
    token = credentials.credentials

    try:
        payload = jwt.decode(
            token,
            settings.JWT_SECRET,
            algorithms=[settings.ALGORITHM],
        )
    except JWTError as exc:
        logger.warning("JWT validation failed: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token. Please login again.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user_id: str | None = payload.get("userId") or payload.get("id")
    if not user_id:
        logger.warning("JWT missing userId/id claim: %s", payload)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token does not contain a valid user identity.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return {
        "user_id": str(user_id),
        "role": payload.get("role", "JobSeeker"),
    }
