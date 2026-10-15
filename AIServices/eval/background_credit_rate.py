#!/usr/bin/env python
"""
Background credit rate (09b2): a regression check for any future threshold or
matching change. Module 5's evaluation must run it.

Two profiles are scored against every active profession with the documented
Module 5 credit rule (app/services/embeddings/matching_config.py):
  same key → matched; described pair: sim ≥ threshold AND mutual_nn → related;
  mixed pair (user described, role skill not): sim ≥ threshold → related.

  web   React, Python, Docker, Figma               (a real ICT profile)
  chef  Cooking, Customer Service, Inventory Management   (no ICT skills)

The chef profile measures BACKGROUND credit: related credit an unrelated person
gets anyway. It must stay well below the web profile's rate.

Reported per profile: the related-credit rate over all non-matched required skills
(pooled and median per profession), split by pair kind, the professions with the
highest rate, and the mixed credits per user skill (to spot doubtful ones).
--sweep also reports the share of undescribed role skills credited by mixed pairs
at 0.61 / 0.65 / 0.70 / 0.73 (the evidence for rejecting 0.61).

PASS criteria (fixed in 09b2; the frozen configuration gives chef 3.0 % / web 12.2 %,
see the change doc):
  chef pooled rate ≤ 5 %   and   chef pooled rate ≤ 0.5 × web pooled rate
Exit code 0 on PASS, 1 on FAIL.

Usage (AIServices venv, repo root; needs the model and the imported professions):
  AIServices/backend/venv/Scripts/python AIServices/eval/background_credit_rate.py [--sweep] [--json out.json]
Read-only: users are not stored; the index is loaded from disk (or rebuilt from MongoDB).
"""

import argparse
import asyncio
import json
import os
import statistics
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1] / "backend"
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

import numpy as np  # noqa: E402

PROFILES = {
    "web": ["React", "Python", "Docker", "Figma"],
    "chef": ["Cooking", "Customer Service", "Inventory Management"],
}
MAX_CHEF_RATE = 5.0
MAX_CHEF_TO_WEB = 0.5
SWEEP = (0.61, 0.65, 0.70, 0.73)


def profile_rates(names, embedder, snapshot, professions, provider, threshold, mutual_k):
    """Related-credit rates for one profile under the credit rule."""
    from app.services.embeddings.descriptions import build_embed_text
    from app.services.embeddings.normalise import normalise_skill
    from app.services.professions.role_skills import current_skill

    keys = [normalise_skill(n)[0] for n in names]
    users = embedder.embed_texts([build_embed_text(n, "description").text for n in names])
    user_described = [provider.lookup(n) is not None for n in names]
    sims = users @ snapshot.matrix.T  # n_user × n_role
    owned = set(keys)
    role_keys = snapshot.keys
    role_described = np.array([provider.lookup(snapshot.names[k]) is not None for k in role_keys])

    # mutual_nn exactly as RoleSkillIndex.search_related defines it.
    order = np.argsort(-sims, axis=1)
    user_top = [set([j for j in row if role_keys[j] not in owned][:mutual_k]) for row in order]
    role_top_users = np.argsort(-sims, axis=0)[:mutual_k]  # mutual_k × n_role

    def related(j):
        """(credited, kind) for role skill index j, best over the user's skills."""
        kinds = set()
        for u in range(len(names)):
            if sims[u, j] < threshold:
                continue
            mixed = user_described[u] and not role_described[j]
            if mixed:
                kinds.add("mixed")
            elif j in user_top[u] and u in role_top_users[:, j]:
                kinds.add("described")
        if not kinds:
            return False, None
        return True, "described" if "described" in kinds else "mixed"

    position = {k: i for i, k in enumerate(role_keys)}
    pooled_related = pooled_total = matched = 0
    by_kind = {"described": 0, "mixed": 0}
    per_profession = []
    cache = {}
    for prof in professions:
        required = {current_skill(s)[0] for s in prof.get("skills") or []}
        required = [k for k in required if k in position]
        exact = [k for k in required if k in owned]
        rest = [k for k in required if k not in owned]
        hits = 0
        for k in rest:
            if k not in cache:
                cache[k] = related(position[k])
            credited, kind = cache[k]
            if credited:
                hits += 1
                by_kind[kind] += 1
        matched += len(exact)
        pooled_related += hits
        pooled_total += len(rest)
        if rest:
            per_profession.append((prof["title"], round(100 * hits / len(rest), 1)))
    per_profession.sort(key=lambda x: -x[1])

    mixed_credits = {}
    for u, name in enumerate(names):
        if not user_described[u]:
            continue
        cols = [j for j in np.argsort(-sims[u]) if not role_described[j] and role_keys[j] not in owned
                and sims[u, j] >= threshold]
        mixed_credits[name] = [f"{snapshot.names[role_keys[j]]} {sims[u, j]:.3f}" for j in cols[:12]]

    undescribed = np.where(~role_described)[0]
    best_undescribed = sims[:, undescribed].max(axis=0) if len(undescribed) else np.array([])
    return {
        "skills": names,
        "pooled_related_pct": round(100 * pooled_related / pooled_total, 1) if pooled_total else 0.0,
        "median_profession_related_pct": statistics.median(p for _, p in per_profession) if per_profession else 0.0,
        "related_by_kind": by_kind,
        "required_matched_exactly": matched,
        "required_not_matched": pooled_total,
        "highest": per_profession[:5],
        "mixed_credits": mixed_credits,
        "sweep_undescribed_share_pct": {str(t): round(100 * float((best_undescribed >= t).mean()), 1) for t in SWEEP},
    }


async def run(sweep: bool = False) -> dict:
    from motor.motor_asyncio import AsyncIOMotorClient

    from app.config import database as database_module
    from app.config.settings import settings
    from app.services.embeddings.descriptions import get_description_provider
    from app.services.embeddings.matching_config import get_related_threshold
    from app.services.embeddings.model import get_manager
    from app.services.professions.role_index import RoleSkillIndex
    from app.services.professions.store import PROFESSIONS, active_filter

    client = AsyncIOMotorClient(settings.MONGODB_URL)
    db = client[settings.AI_DB_NAME]
    previous = database_module.database
    database_module.database = db
    try:
        manager = get_manager()
        if not manager.ready:
            await asyncio.to_thread(manager.load_sync)
            manager.ready_event.set()
        index = RoleSkillIndex()
        await index.load_or_build(db)
        if index.snapshot is None:
            raise SystemExit("No role-skill index (no active professions?)")
        threshold = get_related_threshold(kind="described")
        if threshold is None or get_related_threshold(kind="mixed") != threshold:
            raise SystemExit("The related threshold is not valid for the active setup")
        professions = [p async for p in db[PROFESSIONS].find(active_filter(), {"title": 1, "skills": 1})]
        provider = get_description_provider()
        result = {"threshold": threshold, "mutual_k": settings.MUTUAL_NN_K, "professions": len(professions),
                  "role_skills": index.snapshot.meta["count"], "profiles": {}}
        for name, skills in PROFILES.items():
            rates = profile_rates(skills, manager, index.snapshot, professions, provider, threshold, settings.MUTUAL_NN_K)
            if not sweep:
                rates.pop("sweep_undescribed_share_pct")
            result["profiles"][name] = rates
    finally:
        database_module.database = previous
        client.close()

    chef, web = result["profiles"]["chef"]["pooled_related_pct"], result["profiles"]["web"]["pooled_related_pct"]
    result["check"] = {
        "chef_pooled_pct": chef, "web_pooled_pct": web,
        "chef_to_web": round(chef / web, 3) if web else None,
        "criteria": f"chef <= {MAX_CHEF_RATE}% and chef <= {MAX_CHEF_TO_WEB} x web",
        "passed": chef <= MAX_CHEF_RATE and web > 0 and chef <= MAX_CHEF_TO_WEB * web,
    }
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--sweep", action="store_true", help="also report mixed credit share at 0.61-0.73")
    parser.add_argument("--json", help="write the full result to this file")
    args = parser.parse_args()
    result = asyncio.run(run(args.sweep))
    if args.json:
        Path(args.json).write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf8")
    print(json.dumps(result, indent=2, ensure_ascii=False))
    print("PASS" if result["check"]["passed"] else "FAIL", file=sys.stderr)
    sys.exit(0 if result["check"]["passed"] else 1)


if __name__ == "__main__":
    main()
