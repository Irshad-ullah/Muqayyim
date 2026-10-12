"""
Central error logger for AIServices (collection `error_logs` in ai_db).

Fire-and-forget: log_error() schedules the write and returns immediately; it
never raises. If MongoDB is unavailable the entry goes to the console. A
'critical' entry also asks CoreServices to email the admins (POST /internal/alerts).

Request context (request id, method, path, user) comes from context variables
set by the request middleware and the auth dependency, so route code does not
have to pass it around.
"""

import asyncio
import json
import logging
import time
import traceback
from contextvars import ContextVar
from datetime import datetime, timezone

from app.utils.mask import mask_message, mask_stack, truncate

logger = logging.getLogger(__name__)

LEVELS = ("warning", "error", "critical")
COLLECTION = "error_logs"

request_context: ContextVar[dict | None] = ContextVar("request_context", default=None)

# Keep references to in-flight writes so they are not garbage-collected.
_pending: set[asyncio.Task] = set()
# Optional de-duplication for noisy warnings (e.g. Core down → every request).
_last_by_key: dict[str, float] = {}

_DB_ERROR_NAMES = {
    "ServerSelectionTimeoutError",
    "ConnectionFailure",
    "AutoReconnect",
    "NetworkTimeout",
    "NotPrimaryError",
}


def is_db_connection_error(exc: BaseException | None) -> bool:
    return exc is not None and any(cls.__name__ in _DB_ERROR_NAMES for cls in type(exc).__mro__)


def set_request_context(**values) -> None:
    ctx = dict(request_context.get() or {})
    ctx.update({k: v for k, v in values.items() if v is not None})
    request_context.set(ctx)


def build_entry(
    level: str = "error",
    module: str = "unknown",
    exc: BaseException | None = None,
    error_type: str | None = None,
    message: str | None = None,
    stack: str | None = None,
    status_code: int | None = None,
    request_id: str | None = None,
    user_id: str | None = None,
    method: str | None = None,
    path: str | None = None,
) -> dict:
    ctx = request_context.get() or {}
    if stack is None and exc is not None:
        stack = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    entry = {
        "timestamp": datetime.now(timezone.utc),
        "level": level if level in LEVELS else "error",
        "service": "ai",
        "module": truncate(str(module or "unknown"), 60),
        "errorType": truncate(str(error_type or (type(exc).__name__ if exc else "Error")), 120),
        "message": mask_message(message if message is not None else (str(exc) if exc else "")),
        "stack": mask_stack(stack),
        "requestId": (request_id or ctx.get("request_id") or None),
        "userId": (user_id or ctx.get("user_id") or None),
        "method": (method or ctx.get("method") or None),
        "path": ((path or ctx.get("path") or "").split("?")[0][:300] or None),
        "statusCode": status_code,
        "acknowledged": False,
    }
    return {k: v for k, v in entry.items() if v is not None}


def _to_console(entry: dict, reason: str) -> None:
    printable = {k: (v.isoformat() if isinstance(v, datetime) else v) for k, v in entry.items() if k != "stack"}
    logger.error("[ErrorLog:%s] %s", reason, json.dumps(printable, default=str))


async def write_entry(entry: dict) -> dict:
    """Persist an entry (awaitable; used by tests). Never raises."""
    from app.config.database import get_database  # local import avoids a cycle

    try:
        db = get_database()
        if db is None:
            _to_console(entry, "db-unavailable")
        else:
            await db[COLLECTION].insert_one(dict(entry))
    except Exception as write_exc:  # noqa: BLE001 — logging must never fail the caller
        _to_console(entry, f"write-failed {type(write_exc).__name__}")

    if entry.get("level") == "critical":
        try:
            from app.services.core_client import send_alert

            await send_alert(entry)
        except Exception:  # noqa: BLE001
            logger.error("Could not request a critical alert from CoreServices")
    return entry


def log_error(dedupe_key: str | None = None, dedupe_seconds: float = 60.0, **kwargs) -> asyncio.Task | None:
    """Schedule an error-log write and return immediately (never raises)."""
    try:
        if dedupe_key:
            now = time.monotonic()
            if now - _last_by_key.get(dedupe_key, 0.0) < dedupe_seconds:
                return None
            _last_by_key[dedupe_key] = now
        entry = build_entry(**kwargs)
        task = asyncio.get_running_loop().create_task(write_entry(entry))
        _pending.add(task)
        task.add_done_callback(_pending.discard)
        return task
    except RuntimeError:
        # No running event loop (e.g. during import/shutdown): console only.
        logger.error("[ErrorLog:no-loop] %s", kwargs.get("message") or kwargs.get("exc"))
        return None
    except Exception as exc:  # noqa: BLE001
        logger.error("[ErrorLog] could not build entry: %s", exc)
        return None


def reset_dedupe() -> None:
    _last_by_key.clear()
