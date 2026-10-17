#!/usr/bin/env python
"""
Module 5.2 — background-check diagnosis (report only; nothing is tuned or changed).

Re-computes eval/background_credit_rate.py's pooled related-credit rate for its chef and web profiles, pair by pair,
for setup A (live ai_db and index, read only) and setup B (O*NET + curated, built exactly as compare_setups.py does in
a separate sandbox database that is dropped afterwards). The rate is computed exactly as profile_rates does:
- rows: every role skill of every active role (all stored skills, not only the required set);
- an exact key match (credit 1.0) is excluded from the rate and listed separately;
- a related credit (0.5) needs similarity >= 0.73, plus mutual nearest neighbours when the role skill is described
  ("described"); an undescribed role skill only needs the threshold ("mixed").

For every credited row it keeps the qualifying user skill(s) with similarity and kind. The rate is reproduced and
checked against profile_rates. Output: results/background_pairs.json (the labels are applied by background_report.py).

Usage (repo root): AIServices/backend/venv/Scripts/python AIServices/eval/curated_roles/diagnose_background.py
"""

import asyncio
import json
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import compare_setups as cs  # noqa: E402  (paths, run_eval, sandbox builder)
import numpy as np  # noqa: E402
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

import background_credit_rate as bcr  # noqa: E402
from app.config import database as database_module  # noqa: E402
from app.config.settings import settings  # noqa: E402
from app.services.embeddings.descriptions import build_embed_text, get_description_provider  # noqa: E402
from app.services.embeddings.matching_config import get_related_threshold  # noqa: E402
from app.services.embeddings.model import get_embedder, get_manager  # noqa: E402
from app.services.embeddings.normalise import normalise_skill  # noqa: E402
from app.services.professions import store  # noqa: E402
from app.services.professions.role_index import RoleSkillIndex  # noqa: E402
from app.services.professions.role_skills import current_skill  # noqa: E402

LABEL = {"onet": "O*NET", "esco": "ESCO", "curated": "Curated", "manual": "Manual"}


def pairs_for(names, snapshot, professions, threshold, mutual_k):
    embedder, provider = get_embedder(), get_description_provider()
    keys = [normalise_skill(n)[0] for n in names]
    users = embedder.embed_texts([build_embed_text(n, "description").text for n in names])
    user_described = [provider.lookup(n) is not None for n in names]
    sims = users @ snapshot.matrix.T
    owned = set(keys)
    role_keys = snapshot.keys
    role_described = np.array([provider.lookup(snapshot.names[k]) is not None for k in role_keys])
    order = np.argsort(-sims, axis=1)
    user_top = [set([j for j in row if role_keys[j] not in owned][:mutual_k]) for row in order]
    role_top_users = np.argsort(-sims, axis=0)[:mutual_k]
    position = {k: i for i, k in enumerate(role_keys)}

    def qualifying(j):
        out = []
        for u in range(len(names)):
            if sims[u, j] < threshold:
                continue
            if user_described[u] and not role_described[j]:
                out.append({"user_skill": names[u], "similarity": round(float(sims[u, j]), 3), "kind": "mixed"})
            elif j in user_top[u] and u in role_top_users[:, j]:
                out.append({"user_skill": names[u], "similarity": round(float(sims[u, j]), 3), "kind": "described"})
        return sorted(out, key=lambda p: -p["similarity"])

    roles, credited_rows, total_rows = [], 0, 0
    for prof in professions:
        required = {current_skill(s)[0] for s in prof.get("skills") or []}
        required = [k for k in required if k in position]
        exact = [k for k in required if k in owned]
        rest = [k for k in required if k not in owned]
        credits = []
        for k in rest:
            q = qualifying(position[k])
            if q:
                credits.append({"role_skill": snapshot.names[k], "role_skill_described": bool(role_described[position[k]]),
                                "pairs": q})
        credited_rows += len(credits)
        total_rows += len(rest)
        if credits or exact:
            roles.append({"role": prof["title"], "source": LABEL.get(prof.get("source"), prof.get("source")),
                          "rows": len(rest), "related": credits,
                          "exact": [snapshot.names[k] for k in exact],
                          "role_rate_pct": round(100 * len(credits) / len(rest), 1) if rest else 0.0})
    return {"credited_rows": credited_rows, "total_rows": total_rows,
            "pooled_related_pct": round(100 * credited_rows / total_rows, 1) if total_rows else 0.0, "roles": roles}


async def diagnose(db, snapshot, collection="professions"):
    professions = [p async for p in db[collection].find(store.active_filter(), {"title": 1, "skills": 1, "source": 1})]
    threshold = get_related_threshold(kind="described")
    out = {}
    for name in ("chef", "web"):
        mine = pairs_for(bcr.PROFILES[name], snapshot, professions, threshold, settings.MUTUAL_NN_K)
        check = bcr.profile_rates(bcr.PROFILES[name], get_embedder(), snapshot, professions, get_description_provider(),
                                  threshold, settings.MUTUAL_NN_K)
        assert mine["pooled_related_pct"] == check["pooled_related_pct"], (name, mine["pooled_related_pct"], check["pooled_related_pct"])
        out[name] = mine
    return out


async def main_async():
    client = AsyncIOMotorClient(settings.MONGODB_URL)
    live = client[settings.AI_DB_NAME]
    manager = get_manager()
    await asyncio.to_thread(manager.load_sync)
    manager.ready_event.set()
    result = {}
    database_module.database = live
    index_a = RoleSkillIndex(Path(settings.ROLE_INDEX_DIR))
    if not index_a.load_files({}):
        raise SystemExit("The persisted role-skill index could not be loaded")
    result["A"] = await diagnose(live, index_a.snapshot)

    sources, store_sources = settings.PROFESSION_SOURCES, store.SOURCES
    store.SOURCES = tuple(store_sources) + ("curated",)
    settings.PROFESSION_SOURCES = "onet,curated"
    try:
        sandbox, _ = await cs.build_sandbox(live, client)
        database_module.database = sandbox
        index_b = RoleSkillIndex(directory=None, collection="professions")
        await index_b.rebuild(sandbox, persist=False)
        result["B"] = await diagnose(sandbox, index_b.snapshot)
    finally:
        settings.PROFESSION_SOURCES, store.SOURCES = sources, store_sources
        database_module.database = live
        await client.drop_database(cs.SANDBOX_DB)
        shutil.rmtree(cs.INDEX_DIR, ignore_errors=True)
        client.close()
    return result


def main():
    result = asyncio.run(main_async())
    (HERE / "results" / "background_pairs.json").write_text(json.dumps(result, indent=1, ensure_ascii=False), encoding="utf8")
    sys.stdout.reconfigure(encoding="utf-8")
    for setup in ("A", "B"):
        for name in ("chef", "web"):
            r = result[setup][name]
            print(f"{setup} {name}: {r['credited_rows']}/{r['total_rows']} = {r['pooled_related_pct']} %")
    seen = set()
    for setup in ("A", "B"):
        for role in result[setup]["chef"]["roles"]:
            for c in role["related"]:
                for p in c["pairs"]:
                    seen.add((p["user_skill"], c["role_skill"], p["kind"], p["similarity"]))
    print("chef pairs (user skill -> role skill):")
    for row in sorted(seen):
        print("  ", row)


if __name__ == "__main__":
    main()
