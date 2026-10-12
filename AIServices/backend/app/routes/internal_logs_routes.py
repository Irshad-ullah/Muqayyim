"""
Internal error-log endpoints for the admin log view (called by CoreServices).
Mounted at /internal (never proxied by the gateway); X-Internal-Key required.
Stacks are only returned by the detail endpoint.
"""

import re
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Body, Depends, HTTPException, Query, status

from app.config.database import get_database
from app.middleware.internal_auth import require_internal_key
from app.services.error_logger import COLLECTION, LEVELS

router = APIRouter(prefix="/internal/logs", tags=["Internal"], dependencies=[Depends(require_internal_key)])

MAX_LIMIT = 1000  # CoreServices merges the newest N entries of each service


def _db():
    db = get_database()
    if db is None:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Database not available")
    return db[COLLECTION]


def _parse_date(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def _row(doc: dict, with_stack: bool = False) -> dict:
    doc = dict(doc)
    doc["id"] = str(doc.pop("_id"))
    if not with_stack:
        doc.pop("stack", None)
    for key in ("timestamp", "acknowledgedAt"):
        if isinstance(doc.get(key), datetime):
            value = doc[key]
            doc[key] = (value if value.tzinfo else value.replace(tzinfo=timezone.utc)).isoformat()
    return doc


@router.get("/errors")
async def list_errors(
    level: str | None = None,
    module: str | None = None,
    search: str | None = None,
    acknowledged: str | None = None,
    from_: str | None = Query(default=None, alias="from"),
    to: str | None = None,
    page: int = Query(default=1, ge=1),
    limit: int = Query(default=20, ge=1, le=MAX_LIMIT),
):
    query: dict = {}
    if level in LEVELS:
        query["level"] = level
    if module:
        query["module"] = module[:60]
    if acknowledged == "true":
        query["acknowledged"] = True
    elif acknowledged == "false":
        query["acknowledged"] = {"$ne": True}
    start, end = _parse_date(from_), _parse_date(to)
    if start or end:
        query["timestamp"] = {}
        if start:
            query["timestamp"]["$gte"] = start
        if end:
            query["timestamp"]["$lte"] = end
    if search:
        pattern = re.compile(re.escape(search[:200]), re.I)
        query["$or"] = [{"message": pattern}, {"errorType": pattern}, {"requestId": pattern}]

    coll = _db()
    cursor = coll.find(query, {"stack": 0}).sort("timestamp", -1).skip((page - 1) * limit).limit(limit)
    rows = [_row(doc) async for doc in cursor]
    total = await coll.count_documents(query)
    return {"data": rows, "total": total, "page": page, "limit": limit}


@router.get("/errors/{log_id}")
async def get_error(log_id: str):
    if not ObjectId.is_valid(log_id):
        raise HTTPException(status_code=404, detail="Log entry not found")
    doc = await _db().find_one({"_id": ObjectId(log_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Log entry not found")
    return {"data": _row(doc, with_stack=True)}


@router.patch("/errors/{log_id}/acknowledge")
async def acknowledge_error(log_id: str, body: dict = Body(default={})):
    if not ObjectId.is_valid(log_id):
        raise HTTPException(status_code=404, detail="Log entry not found")
    coll = _db()
    update = {
        "acknowledged": True,
        "acknowledgedBy": str(body.get("acknowledgedBy") or "")[:64] or None,
        "acknowledgedAt": datetime.now(timezone.utc),
    }
    result = await coll.update_one({"_id": ObjectId(log_id)}, {"$set": update})
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Log entry not found")
    doc = await coll.find_one({"_id": ObjectId(log_id)}, {"stack": 0})
    return {"data": _row(doc)}


@router.get("/summary")
async def summary(since: str | None = None):
    start = _parse_date(since)
    match = {"timestamp": {"$gte": start}} if start else {}
    counts = {level: 0 for level in LEVELS}
    async for row in _db().aggregate([{"$match": match}, {"$group": {"_id": "$level", "count": {"$sum": 1}}}]):
        if row["_id"] in counts:
            counts[row["_id"]] = row["count"]
    return {"counts": counts}
