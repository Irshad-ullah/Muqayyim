"""
Service-to-service authentication for /internal routes (X-Internal-Key).
The key is never logged.
"""

import logging
import secrets

from fastapi import Header, HTTPException, status

from app.config.settings import settings

logger = logging.getLogger(__name__)


async def require_internal_key(x_internal_key: str | None = Header(default=None)) -> None:
    expected = settings.INTERNAL_API_KEY
    if not expected:
        logger.error("INTERNAL_API_KEY is not configured; rejecting internal request")
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Internal API not configured")
    if not x_internal_key:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing internal API key")
    if not secrets.compare_digest(x_internal_key.encode(), expected.encode()):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid internal API key")
