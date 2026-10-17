"""
LLM rate limits and the per-user quota (12), shared by every process through ai_db.llm_limits
(Google applies its limits per project, so the service, CLI scripts and evaluations share them).

  rpm:<minute>        requests in this UTC minute   ≤ floor(LLM_RPM × LLM_LIMIT_FRACTION)
  tpm:<minute>        tokens in this UTC minute      ≤ floor(LLM_TPM × LLM_LIMIT_FRACTION)
  rpd:<pacific day>   requests today                 ≤ floor(LLM_RPD × LLM_LIMIT_FRACTION)
  user:<ref>:<day>    one user's calls today         ≤ LLM_USER_DAILY_QUOTA

Each check is ONE conditional upsert (the document is incremented only while under the limit; a
full counter makes the upsert collide on _id → refused), so concurrent requests cannot overshoot.
A later refusal rolls back the counters already taken. The day is the US Pacific calendar day,
because Google resets daily quotas at midnight Pacific. Counters expire on their own (TTL).
"""

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from math import ceil, floor
from typing import List, Optional, Tuple

from pymongo.errors import DuplicateKeyError

from app.config.settings import settings
from app.services.llm.errors import LLMQuotaExceeded, LLMRateLimited

LIMITS = "llm_limits"


# ── the Pacific calendar day without a time-zone database (Windows has none) ──
def _nth_sunday(year: int, month: int, n: int) -> date:
    first = date(year, month, 1)
    return first + timedelta(days=(6 - first.weekday()) % 7 + 7 * (n - 1))


def pacific_offset(now: datetime) -> timedelta:
    """UTC offset of US Pacific time at `now` (UTC): −7 h from the 2nd Sunday of March 02:00 PST
    (10:00 UTC) to the 1st Sunday of November 02:00 PDT (09:00 UTC), else −8 h."""
    now = now.astimezone(timezone.utc)
    start = datetime.combine(_nth_sunday(now.year, 3, 2), datetime.min.time(), timezone.utc) + timedelta(hours=10)
    end = datetime.combine(_nth_sunday(now.year, 11, 1), datetime.min.time(), timezone.utc) + timedelta(hours=9)
    return timedelta(hours=-7) if start <= now < end else timedelta(hours=-8)


def pacific_day(now: datetime) -> str:
    return (now.astimezone(timezone.utc) + pacific_offset(now)).date().isoformat()


def seconds_to_pacific_midnight(now: datetime) -> int:
    local = now.astimezone(timezone.utc) + pacific_offset(now)
    midnight = datetime.combine(local.date() + timedelta(days=1), datetime.min.time(), timezone.utc)
    return max(1, ceil((midnight - local.replace(tzinfo=timezone.utc)).total_seconds()))


def effective(limit: int) -> int:
    return max(1, floor(limit * settings.LLM_LIMIT_FRACTION))


@dataclass
class Taken:
    """Counters taken for one call; `release` gives them back (used when a later check refuses)."""
    entries: List[Tuple[str, str, int]]

    async def release(self, db) -> None:
        for _id, field, amount in self.entries:
            await db[LIMITS].update_one({"_id": _id}, {"$inc": {field: -amount}})


async def ensure_limit_indexes(db) -> None:
    await db[LIMITS].create_index("expires_at", expireAfterSeconds=0)


async def _take(db, _id: str, field: str, amount: int, limit: int, expires_at: datetime) -> bool:
    if amount > limit:
        return False  # can never fit (e.g. one request larger than the whole token budget)
    under_limit = {"_id": _id, field: {"$lte": limit - amount}}
    try:
        await db[LIMITS].update_one(under_limit, {"$inc": {field: amount}, "$setOnInsert": {"expires_at": expires_at}},
                                    upsert=True)
        return True
    except DuplicateKeyError:
        # Either the counter exists and is full, or a concurrent request created it a moment ago
        # (two first inserts race). Now that it exists, a plain conditional update decides.
        result = await db[LIMITS].update_one(under_limit, {"$inc": {field: amount}})
        return result.modified_count == 1


async def acquire(db, user_ref: Optional[str], estimated_tokens: int, now: Optional[datetime] = None) -> Taken:
    """Take one request (and the estimated tokens) from every limit, or raise LLMQuotaExceeded /
    LLMRateLimited with a retry delay. `user_ref` None = a retry of a call already counted for the user."""
    now = now or datetime.now(timezone.utc)
    day = pacific_day(now)
    minute = now.strftime("%Y%m%dT%H%M")
    to_next_minute = 60 - now.second
    to_midnight = seconds_to_pacific_midnight(now)
    day_expiry, minute_expiry = now + timedelta(days=2), now + timedelta(minutes=2)
    checks = []
    if user_ref:
        checks.append((f"user:{user_ref}:{day}", "count", 1, settings.LLM_USER_DAILY_QUOTA, day_expiry,
                       LLMQuotaExceeded(retry_after=to_midnight)))
    checks += [
        (f"rpd:{day}", "count", 1, effective(settings.LLM_RPD), day_expiry, LLMRateLimited(
            "AI assistance has reached today's limit for the whole service. It resets at midnight (US Pacific time).",
            retry_after=to_midnight)),
        (f"rpm:{minute}", "count", 1, effective(settings.LLM_RPM), minute_expiry, LLMRateLimited(retry_after=to_next_minute)),
        (f"tpm:{minute}", "tokens", max(1, estimated_tokens), effective(settings.LLM_TPM), minute_expiry,
         LLMRateLimited(retry_after=to_next_minute)),
    ]
    taken = Taken([])
    for _id, field, amount, limit, expires_at, refusal in checks:
        if not await _take(db, _id, field, amount, limit, expires_at):
            await taken.release(db)
            raise refusal
        taken.entries.append((_id, field, amount))
    return taken


async def adjust_tokens(db, taken: Taken, actual_tokens: int) -> None:
    """Replace the token estimate with the provider's actual count (may go slightly over: the next
    request then waits for the next minute)."""
    for _id, field, amount in taken.entries:
        if field == "tokens":
            await db[LIMITS].update_one({"_id": _id}, {"$inc": {"tokens": actual_tokens - amount}})


async def today(db, now: Optional[datetime] = None) -> dict:
    now = now or datetime.now(timezone.utc)
    doc = await db[LIMITS].find_one({"_id": f"rpd:{pacific_day(now)}"}) or {}
    return {"pacific_day": pacific_day(now), "requests": int(doc.get("count", 0))}

