"""
Per-call LLM usage records (12): ai_db.llm_usage, for the admin dashboard and cost visibility.
One document per feature call: feature, user reference (hash), provider, model, prompt version,
status (ok / cached / disabled / rate_limited / quota_exceeded / timeout / unavailable /
invalid_output), provider attempts, input / output tokens and latency. Prompts and responses are
NEVER stored here (they can contain personal data). Kept for 365 days.
"""

from datetime import datetime, timedelta, timezone
from typing import Optional

USAGE = "llm_usage"
RETENTION_DAYS = 365


async def ensure_usage_indexes(db) -> None:
    await db[USAGE].create_index("at", expireAfterSeconds=RETENTION_DAYS * 86400)
    await db[USAGE].create_index([("feature", 1), ("at", -1)])


async def record(db, *, feature: str, user: str, provider: str, model: str, prompt_ref: str, status: str,
                 attempts: int = 0, input_tokens: int = 0, output_tokens: int = 0, latency_ms: int = 0) -> None:
    await db[USAGE].insert_one({
        "feature": feature, "user_ref": user, "provider": provider, "model": model, "prompt": prompt_ref,
        "status": status, "attempts": attempts, "input_tokens": input_tokens, "output_tokens": output_tokens,
        "latency_ms": latency_ms, "at": datetime.now(timezone.utc),
    })


async def summary(db, days: int = 7, now: Optional[datetime] = None) -> list:
    """Per feature over the last `days`: calls, provider calls, cache hits, errors, tokens, mean latency."""
    since = (now or datetime.now(timezone.utc)) - timedelta(days=days)
    pipeline = [
        {"$match": {"at": {"$gte": since}}},
        {"$group": {
            "_id": "$feature",
            "calls": {"$sum": 1},
            "provider_attempts": {"$sum": "$attempts"},
            "cached": {"$sum": {"$cond": [{"$eq": ["$status", "cached"]}, 1, 0]}},
            "errors": {"$sum": {"$cond": [{"$in": ["$status", ["ok", "cached"]]}, 0, 1]}},
            "input_tokens": {"$sum": "$input_tokens"},
            "output_tokens": {"$sum": "$output_tokens"},
            "mean_latency_ms": {"$avg": {"$cond": [{"$eq": ["$status", "ok"]}, "$latency_ms", None]}},
        }},
        {"$sort": {"_id": 1}},
    ]
    return [{"feature": r.pop("_id"), **r, "mean_latency_ms": round(r["mean_latency_ms"] or 0)}
            async for r in db[USAGE].aggregate(pipeline)]
