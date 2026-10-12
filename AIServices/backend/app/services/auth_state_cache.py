"""
Per-user cache of auth state fetched from CoreServices.

Fresh entries (younger than AUTH_CACHE_TTL_SECONDS) are used without calling
Core. When Core is unreachable, an expired entry may still be used for up to
STALE_GRACE_SECONDS longer (with a warning); with no usable entry the caller
must fail closed. In-memory and per process — enough for a single instance.
"""

import logging
import time

from app.config.settings import settings
from app.services import core_client
from app.services.core_client import CoreUnavailable

logger = logging.getLogger(__name__)

STALE_GRACE_SECONDS = 5 * 60

_cache: dict[str, tuple[dict, float]] = {}


def clear_auth_state_cache() -> None:
    _cache.clear()


async def get_auth_state_cached(user_id: str) -> dict:
    """Auth state for user_id; raises CoreUnavailable when nothing usable exists."""
    now = time.monotonic()
    ttl = settings.AUTH_CACHE_TTL_SECONDS
    entry = _cache.get(user_id)

    if entry is not None and now - entry[1] < ttl:
        return entry[0]

    try:
        state = await core_client.get_auth_state(user_id)
    except CoreUnavailable:
        if entry is not None and now - entry[1] < ttl + STALE_GRACE_SECONDS:
            logger.warning(
                "CoreServices unreachable; using expired auth state for user %s (age %ds)",
                user_id,
                int(now - entry[1]),
            )
            return entry[0]
        raise

    _cache[user_id] = (state, now)
    return state
