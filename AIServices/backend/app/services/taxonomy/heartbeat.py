"""
Service heartbeat (09c): the running AI service records that it is up, so offline
tools (the CLI importers) can warn that it needs a rebuild or restart after they
change the profession data.

ai_db.service_heartbeats: { _id: "aiservices", at, pid, host }
"""

import asyncio
import os
import socket
from datetime import datetime, timedelta, timezone
from typing import Optional

from app.config.database import get_database
from app.config.settings import settings

HEARTBEATS = "service_heartbeats"
SERVICE_ID = "aiservices"


async def beat(db=None) -> None:
    db = db if db is not None else get_database()
    await db[HEARTBEATS].update_one(
        {"_id": SERVICE_ID},
        {"$set": {"at": datetime.now(timezone.utc), "pid": os.getpid(), "host": socket.gethostname()}},
        upsert=True,
    )


async def run_heartbeat(db=None, interval: Optional[float] = None) -> None:
    interval = interval or settings.SERVICE_HEARTBEAT_SECONDS
    while True:
        try:
            await beat(db)
        except Exception:  # noqa: BLE001 — a missed beat only weakens the CLI warning
            pass
        await asyncio.sleep(interval)


async def service_seems_running(db=None, within_seconds: Optional[float] = None) -> bool:
    """True when the service beat recently (within 3 intervals by default)."""
    db = db if db is not None else get_database()
    doc = await db[HEARTBEATS].find_one({"_id": SERVICE_ID})
    if not doc:
        return False
    at = doc["at"] if doc["at"].tzinfo else doc["at"].replace(tzinfo=timezone.utc)
    window = within_seconds or 3 * settings.SERVICE_HEARTBEAT_SECONDS
    return datetime.now(timezone.utc) - at <= timedelta(seconds=window)
