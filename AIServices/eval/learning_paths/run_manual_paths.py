#!/usr/bin/env python
"""
Module 6 Part 7 — 5 learning paths with the real Gemini client, for the manual review (expectations.md, rule 9).

Each path is built with production code for one test-CV profile and a named role: the structure
(app.services.learning.structure.build, default any-of alternatives) and the enrichment (app.services.learning.enrich).
User skills are embedded in memory as run_structure_eval.py does (no profile is stored). All paths: English (the only
language), "include paid". A path already enriched in results/manual_paths.json is kept as it is (it may have used an
earlier prompt version, recorded per path); only missing paths are generated. Rejection reasons (llm_usage
reject_reason, names only) of this run are recorded.

Writes, against the live ai_db (LLM usage records, cache and limit counters only, so back up ai_db first):
  manual_review.csv          one row per recommendation; the review columns are left empty for the team. An existing
                             file is merged, never overwritten: its rows and review marks are kept, rows of new paths
                             are appended (if the file is open elsewhere, the result goes to manual_review.pending.csv)
  results/manual_paths.json  the five paths as built (structure + enrichment), and the Gemini call count
Usage (from AIServices/backend):
  venv/Scripts/python ../eval/learning_paths/run_manual_paths.py
"""

import asyncio
import csv
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "career_matching"))

import run_eval  # noqa: E402  (backend path, cwd)
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

from app.config import database as database_module  # noqa: E402
from app.config.settings import settings  # noqa: E402
from app.services.embeddings.model import get_embedder, get_manager  # noqa: E402
from app.services.learning import enrich, structure  # noqa: E402
from app.services.llm.client import get_llm_client  # noqa: E402
from app.services.llm.errors import LLMError  # noqa: E402
from app.services.matching import service  # noqa: E402
from app.services.professions.role_index import RoleSkillIndex, use_role_index  # noqa: E402

USER_ID = "eval-m6-manual"  # a synthetic id for the LLM usage records and the cache
PATHS = [  # (test-CV profile, role)
    ("cv04_devops", "curated:devops-engineer"),
    ("cv05_android", "curated:android-developer"),
    ("cv03_data_scientist", "curated:data-analyst"),
    ("cv09_uiux", "curated:ui-ux-designer"),
    ("cv02_backend_java", "curated:backend-developer"),
]
RESULTS = HERE / "results" / "manual_paths.json"
COLUMNS = ["path", "module", "platform", "title", "channel_or_instructor", "free_paid", "language",
           "module_hours_estimated", "search_url", "exists_y_n", "relevant_y_n", "hours_plausible_y_n", "reviewer"]


def previous():
    """Enriched English paths from an earlier run, by profession id (rejected or other-language paths are dropped)."""
    if not RESULTS.exists():
        return {}, 0
    old = json.loads(RESULTS.read_text(encoding="utf8"))
    keep = {p["profession_id"]: p for p in old["paths"]
            if p.get("enrichment") and p["preferences"].get("language", "English") == "English"}
    for p in keep.values():
        p["preferences"].pop("language", None)
    return keep, old.get("gemini_calls_total", old.get("gemini_calls", 0))


async def main_async():
    from datetime import datetime, timezone
    from app.services.llm import cache

    started = datetime.now(timezone.utc)
    kept, earlier_calls = previous()
    client = AsyncIOMotorClient(settings.MONGODB_URL)
    db = client[settings.AI_DB_NAME]
    database_module.database = db
    index = RoleSkillIndex(Path(settings.ROLE_INDEX_DIR))
    if not index.load_files({}):
        raise SystemExit("The persisted role-skill index could not be loaded")
    use_role_index(index)
    manager = get_manager()
    await asyncio.to_thread(manager.load_sync)
    manager.ready_event.set()
    service.user_vectors = run_eval.in_memory_vectors(get_embedder())

    llm = get_llm_client()
    if not llm.enabled or getattr(llm.provider, "name", "") != "gemini":
        raise SystemExit("The Gemini client is not configured (LLM_ENABLED / LLM_PROVIDER / LLM_API_KEY)")
    calls = {"provider": 0}
    generate = llm.provider.generate

    async def counted(request, timeout):
        calls["provider"] += 1
        return await generate(request, timeout)

    llm.provider.generate = counted

    profiles = {p["id"]: p for p in json.loads((HERE.parent / "career_matching" / "profiles_testcvs.json")
                                               .read_text(encoding="utf8"))["profiles"]}
    out = []
    for profile_id, pid in PATHS:
        if pid in kept:
            out.append(kept[pid])
            continue
        owned = run_eval.owned_for(profiles[profile_id]["skills"])
        path = await structure.build(owned, pid, db)
        prefs = enrich.Preferences(cost="include_paid", hours_per_week=6)
        entry = {"profile": profile_id, "profession_id": pid, "title": path["title"], "match": path["match_score"],
                 "preferences": prefs.model_dump(), "structure": path, "enrichment": None, "error": None}
        if path["modules"]:
            request = enrich.EnrichRequest(role_title=path["title"],
                                           modules=[{"key": m["key"], "skill": m["skill"]} for m in path["modules"]],
                                           user_skills=[v["name"] for v in owned.values()][:300], preferences=prefs)
            try:
                entry["enrichment"] = await enrich.enrich(request, USER_ID)
            except LLMError as exc:
                entry["error"] = type(exc).__name__
        out.append(entry)
    reasons = [d async for d in db["llm_usage"].find(
        {"user_ref": cache.user_ref(USER_ID), "at": {"$gte": started}, "feature": enrich.FEATURE},
        {"_id": 0, "status": 1, "attempts": 1, "reject_reason": 1, "prompt": 1})]
    total = 0  # every provider call ever made for this synthetic user (all runs), from llm_usage
    async for d in db["llm_usage"].find({"user_ref": cache.user_ref(USER_ID)}, {"attempts": 1}):
        total += d.get("attempts") or 0
    earlier_calls = total - calls["provider"]
    client.close()
    return out, calls["provider"], earlier_calls, reasons


def main():
    out, provider_calls, earlier_calls, reasons = asyncio.run(main_async())
    def hours_text(h):
        return f"{h['min']} to {h['max']} h"  # not "10-25": Excel reads that as a date

    hours_of = {(p["title"], m["skill"]): hours_text(m["hours"]) for p in out for m in (p["enrichment"] or {}).get("modules", [])}
    csv_path = HERE / "manual_review.csv"
    existing = []
    if csv_path.exists():
        with csv_path.open(encoding="utf-8-sig", newline="") as f:
            existing = list(csv.DictReader(f))
    for row in existing:  # older rows: "Title (English)" path names, and repair hours Excel turned into dates
        row["path"] = row["path"].replace(" (English)", "")
        row["module_hours_estimated"] = hours_of.get((row["path"], row["module"]), row.get("module_hours_estimated", ""))
    titles = {p["title"] for p in out}
    existing = [r for r in existing if r["path"] in titles]
    have = {r["path"] for r in existing}
    rows = list(existing)
    for p in out:
        if p["title"] in have:
            continue
        for m in (p["enrichment"] or {}).get("modules", []):
            for r in m["recommendations"]:  # noqa: B007
                rows.append({"path": p["title"], "module": m["skill"],
                             "platform": r["platform"], "title": r["title"], "channel_or_instructor": r.get("instructor") or "",
                             "free_paid": "free" if r["free"] else "paid", "language": "English",
                             "module_hours_estimated": hours_text(m["hours"]),
                             "search_url": r["search_url"], "exists_y_n": "", "relevant_y_n": "", "hours_plausible_y_n": "",
                             "reviewer": ""})
    target = csv_path
    try:
        handle = target.open("w", encoding="utf-8-sig", newline="")
    except PermissionError:
        target = HERE / "manual_review.pending.csv"
        handle = target.open("w", encoding="utf-8-sig", newline="")
    with handle as f:
        writer = csv.DictWriter(f, fieldnames=COLUMNS, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    cached = sum(1 for p in out if p["enrichment"] and p["enrichment"]["usage"].get("cached"))
    (HERE / "results").mkdir(exist_ok=True)
    (HERE / "results" / "manual_paths.json").write_text(json.dumps(
        {"paths": out, "rows": len(rows), "gemini_calls_this_run": provider_calls,
         "gemini_calls_total": earlier_calls + provider_calls, "this_run_usage": reasons, "cached_enrichments": cached,
         "model": settings.LLM_MODEL}, indent=1, ensure_ascii=False, default=str), encoding="utf8")
    sys.stdout.reconfigure(encoding="utf-8")
    for p in out:
        print(f"{p['title']} ({p['enrichment']['usage']['prompt'] if p['enrichment'] else '-'}): {len(p['structure']['modules'])} modules, "
              f"{'enriched' if p['enrichment'] else 'NOT enriched: ' + str(p['error'])}")
    print(f"written to {target.name}")
    print(f"rows={len(rows)} gemini_calls_this_run={provider_calls} total={earlier_calls + provider_calls}")
    print("this run usage:", [(r["status"], r["attempts"], r.get("reject_reason")) for r in reasons])


if __name__ == "__main__":
    main()
