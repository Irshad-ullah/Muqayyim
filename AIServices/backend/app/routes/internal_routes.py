"""
Internal (service-to-service) routes. Mounted at /internal and never proxied
by the API Gateway. Protected by X-Internal-Key.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, status

from app.config.database import get_database
from app.middleware.internal_auth import require_internal_key

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
