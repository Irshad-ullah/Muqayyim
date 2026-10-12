"""
Internal client for CoreServices.

Pushes CV status changes to CoreServices over HTTP (X-Internal-Key). Status
sync must never break the user's request: failures are retried, then logged.
The internal key is never logged.

Routes call `push_cv_status`, which keeps each user's updates in order and
waits only briefly, so a CoreServices outage does not stall CV parsing.
"""

import asyncio
import logging

import httpx

from app.config.settings import settings
from app.constants.cv_status import CV_STATUS_VALUES

logger = logging.getLogger(__name__)

TIMEOUT_SECONDS = 5.0
AUTH_STATE_TIMEOUT_SECONDS = 2.0
# Fail fast when CoreServices is down (a refused connect can otherwise stall for
# seconds per attempt), so a Core outage adds only a few seconds to the request.
CONNECT_TIMEOUT_SECONDS = 1.0
BACKOFF_SECONDS = (0.5, 1.0, 2.0)  # wait after attempt 1, 2, 3
MAX_ATTEMPTS = 3
# How long a request waits for the status push before letting it finish in the background.
INLINE_WAIT_SECONDS = 1.5

# Latest pending push per user, so updates for one user are delivered in order.
_pending: dict[str, asyncio.Task] = {}


async def notify_cv_status(user_id: str, status: str) -> bool:
    """Set the user's CV status in CoreServices. Returns True on success."""
    if status not in CV_STATUS_VALUES:
        logger.error("Refusing to send unknown CV status %r for user %s", status, user_id)
        return False

    url = f"{settings.CORE_SERVICE_URL.rstrip('/')}/internal/users/{user_id}/cv-status"
    headers = {"X-Internal-Key": settings.INTERNAL_API_KEY}

    last_error = None
    async with httpx.AsyncClient(timeout=httpx.Timeout(TIMEOUT_SECONDS, connect=CONNECT_TIMEOUT_SECONDS)) as client:
        for attempt in range(1, MAX_ATTEMPTS + 1):
            try:
                response = await client.put(url, json={"status": status}, headers=headers)
                if response.status_code < 400:
                    return True
                last_error = f"HTTP {response.status_code}"
                # 4xx (except 429) will not succeed on retry.
                if 400 <= response.status_code < 500 and response.status_code != 429:
                    break
            except httpx.HTTPError as exc:
                last_error = f"{type(exc).__name__}: {exc}"

            if attempt < MAX_ATTEMPTS:
                await asyncio.sleep(BACKOFF_SECONDS[attempt - 1])

    logger.error(
        "Failed to sync CV status to CoreServices (user_id=%s, status=%s): %s",
        user_id,
        status,
        last_error,
    )
    return False


class CoreUnavailable(Exception):
    """CoreServices could not be reached or returned an unexpected error."""


async def get_auth_state(user_id: str) -> dict:
    """
    Current auth state of a user from CoreServices:
    {exists, isActive, role, passwordChangedAt} or {"exists": False}.
    Raises CoreUnavailable on network errors, timeouts or 5xx responses.
    """
    url = f"{settings.CORE_SERVICE_URL.rstrip('/')}/internal/users/{user_id}/auth-state"
    headers = {"X-Internal-Key": settings.INTERNAL_API_KEY}
    try:
        async with httpx.AsyncClient(timeout=AUTH_STATE_TIMEOUT_SECONDS) as client:
            response = await client.get(url, headers=headers)
    except httpx.HTTPError as exc:
        raise CoreUnavailable(f"{type(exc).__name__}") from exc

    if response.status_code == 404:
        return {"exists": False}
    if response.status_code != 200:
        raise CoreUnavailable(f"HTTP {response.status_code}")
    return response.json()


async def push_cv_status(user_id: str, status: str) -> None:
    """
    Send a status change in order for this user. Waits up to INLINE_WAIT_SECONDS;
    if CoreServices is slow or down, delivery (with retries) continues in the
    background and never fails or stalls the caller.
    """
    previous = _pending.get(user_id)

    async def deliver():
        if previous is not None:
            await asyncio.wait([previous])  # keep processing → parsed ordering
        return await notify_cv_status(user_id, status)

    task = asyncio.create_task(deliver())
    _pending[user_id] = task

    def _forget(done_task):
        if _pending.get(user_id) is done_task:
            _pending.pop(user_id, None)

    task.add_done_callback(_forget)

    try:
        await asyncio.wait_for(asyncio.shield(task), INLINE_WAIT_SECONDS)
    except asyncio.TimeoutError:
        logger.warning(
            "CoreServices slow or unreachable; CV status %s for user %s will keep retrying in the background",
            status,
            user_id,
        )
