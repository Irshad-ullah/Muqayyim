"""
Career matching for one user (Module 5, FR7.1–FR7.7): load the user's merged profile skills
(ai_db.user_skill_profiles, only when their embeddings are done), re-normalise them through
today's aliases, score EVERY active profession skill by skill, merge duplicate titles across
sources, rank, explain, and cache the ranked list per user in ai_db.career_matches.

Reuses the frozen embedding configuration unchanged: the vector cache (load_vectors /
get_skill_vectors), the role-skill index and its search_related (called with k = every role
skill, so no profession is missed), and get_related_threshold through search_related.

Cache key: algorithm version + the user's re-normalised skills + the index state hash + the
live professions fingerprint (any profession write, incl. admin overrides) + the alias and
description files' signatures + the ESCO role map's hash (Module 5.1) + the scoring mode and the
published curated dataset's hash (Module 5.2). A different key → recompute.

Scoring mode (Module 5.2): `related_credit` comes from Core's systemconfigs key matching.related_credit
(default false), sent as the X-Related-Credit header. Off: exact / alias / any-of credit only, related
pairs as display-only hints on each role's missing rows (scoring.attach_related_hints). On: the 0.5 rule.
"""

import hashlib
import json
from datetime import datetime, timezone
from typing import Dict, List

import numpy as np

from app.config.database import get_database
from app.services.embeddings import descriptions as descriptions_module
from app.services.embeddings import normalise as normalise_module
from app.services.embeddings.descriptions import get_description_provider, text_mode
from app.services.embeddings.model import ModelNotReady, get_embedder
from app.services.embeddings.normalise import normalise_skill
from app.services.embeddings.user_profiles import DONE, EmbeddingsPending, get_user_skill_record
from app.services.embeddings.vector_store import get_skill_vectors, load_vectors
from app.services.matching import scoring
from app.services.professions import esco_role_map
from app.services.professions.role_index import get_role_index
from app.services.professions.role_skills import current_skill
from app.services.professions.store import PROFESSIONS, active_filter

CAREER_MATCHES = "career_matches"
PROJECTION = {"_id": 0, "profession_id": 1, "title": 1, "description": 1, "category": 1, "source": 1,
              "source_code": 1, "source_version": 1, "skills": 1}


class NoSkills(Exception):
    """The user has no skills in their profile yet."""


class ProfessionNotFound(Exception):
    pass


async def ensure_matching_indexes(db) -> None:
    await db[CAREER_MATCHES].create_index("user_id", unique=True)


# ── the user's skills (FR7.1) ─────────────────────────────────────────────────
async def user_skills(user_id: str, db) -> Dict[str, dict]:
    """{key: {name, source}} under TODAY's aliases (09c: stored keys go stale after an alias
    edit, so the stored names are normalised again here). First occurrence of a key wins."""
    embedder = get_embedder()
    record = await get_user_skill_record(user_id, db)
    if not record or not record.get("skills"):
        raise NoSkills(user_id)
    if record.get("embedding_status") != DONE or record.get("model") != embedder.model_name \
            or record.get("text_mode") != text_mode():
        raise EmbeddingsPending(f"Skill vectors for user {user_id} are still being created")
    owned: Dict[str, dict] = {}
    for skill in record["skills"]:
        key, canonical = normalise_skill(skill.get("name"))
        if key and key not in owned:
            owned[key] = {"name": canonical, "source": skill.get("source")}
    if not owned:
        raise NoSkills(user_id)
    return owned


async def user_vectors(owned: Dict[str, dict], db):
    """(keys, names, matrix) from the vector cache. A skill renamed by an alias edit since the
    profile was saved may have no cached vector yet: it is embedded once through the cache
    (ModelNotReady → EmbeddingsPending)."""
    embedder = get_embedder()
    pairs = [(key, info["name"]) for key, info in owned.items()]
    vectors = await load_vectors(pairs, embedder.model_name, db)
    missing = [name for key, name in pairs if key not in vectors]
    if missing:
        try:
            vectors.update(await get_skill_vectors(missing, embedder, db))
        except ModelNotReady as exc:
            raise EmbeddingsPending("Skill vectors are being updated after a taxonomy change") from exc
    keys = [key for key, _ in pairs]
    return keys, [name for _, name in pairs], np.stack([vectors[k] for k in keys])


# ── scoring every profession ──────────────────────────────────────────────────
def _file_signature(path) -> str:
    try:
        stat = path.stat()
        return f"{stat.st_mtime_ns}:{stat.st_size}"
    except OSError:
        return "missing"


def scoring_mode(related_credit: bool) -> str:
    return "related" if related_credit else "exact"


async def cache_key(owned: Dict[str, dict], db, related_credit: bool = False) -> str:
    from app.services.taxonomy.pipeline import live_fingerprint
    from app.services.taxonomy.snapshots import curated_dataset_hash

    snapshot = get_role_index().snapshot
    parts = {
        "algorithm": scoring.ALGORITHM_VERSION,
        "skills": sorted((k, v["name"], v.get("source") or "") for k, v in owned.items()),
        "index": (snapshot.meta.get("state_hash") if snapshot else None),
        "live": await live_fingerprint(db),
        "aliases": _file_signature(normalise_module.ALIASES_FILE),
        "descriptions": _file_signature(descriptions_module.CURATED_FILE),
        "role_map": esco_role_map.map_hash(),
        "scoring_mode": scoring_mode(related_credit),
        "curated_dataset": curated_dataset_hash(),
    }
    return hashlib.sha256(json.dumps(parts, sort_keys=True).encode()).hexdigest()


async def compute(owned: Dict[str, dict], db, related_credit: bool = False) -> List[dict]:
    """Every active profession scored, duplicates merged, ranked (full breakdowns). related_credit False (default):
    no 0.5 credit; the related pairs become each role's display-only hints."""
    index = get_role_index()
    keys, names, matrix = await user_vectors(owned, db)
    snapshot = index.snapshot
    k = snapshot.index.ntotal if snapshot is not None else 0
    pairs = index.search_related(keys, matrix, k=max(k, 1), user_names=names)  # raises IndexUnavailable
    provider = get_description_provider()
    described = {key: provider.lookup(name) is not None for key, name in zip(keys, names)}
    role_cache: Dict[str, bool] = {}

    def role_described(name: str) -> bool:
        if name not in role_cache:
            role_cache[name] = provider.lookup(name) is not None
        return role_cache[name]

    related = scoring.related_credits(pairs, described, role_described)
    professions = [p async for p in db[PROFESSIONS].find(active_filter(), PROJECTION).sort("profession_id", 1)]
    if related_credit:
        scored = [scoring.score_profession(p, owned, related, current_skill) for p in professions]
    else:
        scored = [scoring.attach_related_hints(scoring.score_profession(p, owned, {}, current_skill), related, owned)
                  for p in professions]
    return scoring.rank(scoring.merge_duplicates(scored))


async def get_matches(user_id: str, db=None, related_credit: bool = False) -> dict:
    """The ranked list (FR7.3, all professions; the UI shows at least 3), from the cache when valid."""
    db = db if db is not None else get_database()
    owned = await user_skills(user_id, db)
    key = await cache_key(owned, db, related_credit)
    cached = await db[CAREER_MATCHES].find_one({"user_id": user_id, "cache_key": key}, {"_id": 0})
    if cached:
        return {**_public(cached), "cached": True}
    results = await compute(owned, db, related_credit)
    doc = {
        "scoring_mode": scoring_mode(related_credit),
        "user_id": user_id,
        "cache_key": key,
        "computed_at": datetime.now(timezone.utc),
        "skill_count": len(owned),
        "best_score": results[0]["score"] if results else 0.0,
        "low_match": (results[0]["score"] if results else 0.0) < scoring.LOW_MATCH_PERCENT,
        "results": [scoring.summary(r) for r in results],
        # FR7.7: the stored gap list per profession (missing required skills), for Module 6.
        "gaps": [{"profession_id": m["profession_id"], "gaps": m["gaps"]} for r in results for m in r["members"]],
    }
    await db[CAREER_MATCHES].replace_one({"user_id": user_id}, doc, upsert=True)
    return {**_public(doc), "cached": False}


async def get_match_detail(user_id: str, profession_id: str, db=None, related_credit: bool = False) -> dict:
    """One (merged) result with every source's breakdown, explanation and gaps (FR7.4–FR7.7). Hints (mode off)
    belong to each member's own missing rows only; there is no cross-role hint list."""
    db = db if db is not None else get_database()
    owned = await user_skills(user_id, db)
    results = await compute(owned, db, related_credit)
    for position, result in enumerate(results, start=1):
        if any(m["profession_id"] == profession_id for m in result["members"]):
            members = [{**m, "explanation": scoring.explain(m, related_credit)} for m in result["members"]]
            return {**scoring.summary(result), "rank": position, "of": len(results), "members": members,
                    "scoring_mode": scoring_mode(related_credit)}
    raise ProfessionNotFound(profession_id)


async def delete_matches(user_id: str, db=None) -> bool:
    db = db if db is not None else get_database()
    return (await db[CAREER_MATCHES].delete_one({"user_id": user_id})).deleted_count > 0


def _public(doc: dict) -> dict:
    computed = doc.get("computed_at")
    if isinstance(computed, datetime):
        computed = (computed if computed.tzinfo else computed.replace(tzinfo=timezone.utc)).isoformat()
    return {"computed_at": computed, "skill_count": doc["skill_count"], "best_score": doc["best_score"],
            "low_match": doc["low_match"], "results": doc["results"], "gaps": doc["gaps"],
            "low_match_percent": scoring.LOW_MATCH_PERCENT, "scoring_mode": doc.get("scoring_mode", "related")}
