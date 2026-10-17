#!/usr/bin/env python
"""
Module 5 career-matching evaluation (read-only).

Scores the sanity profiles in profiles.json with the PRODUCTION scoring code
(app.services.matching.service.compute — required set, credit rule, merges, ranking) against the
real professions and the persisted role-skill index. Nothing is written: the profiles' skills are
embedded in memory with the real model using the same text rule as the vector cache (the cache
itself is not touched), and no career_matches entry is created.

Reports per profile the top 5 (%, sources, held / related / missing) and the rank of the first
acceptable role; top-3 / top-5 hit rates over the IT profiles; the chef control's best score; the
ESCO bias (share of ESCO-only roles in each top 10, best ESCO-only rank); every "related" credit in
the top 5 with its similarity, flagging known doubtful pairs; and the pass mark from profiles.json.

Usage (repo root):
  AIServices/backend/venv/Scripts/python AIServices/eval/career_matching/run_eval.py [--out DIR] [--profiles FILE]
--profiles: another profile file in the same format (e.g. profiles_new.json, Module 5.1); a file without a chef
control or pass mark reports the hit rates only.
--acceptable-key: the field holding each profile's acceptable titles (default "acceptable"; Module 5.2 uses
"acceptable_b" — O*NET + curated roles, ESCO retired). Scoring uses the production default mode (related credit off)
unless --related-credit is given.
"""

import argparse
import asyncio
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parents[1] / "backend"
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

import numpy as np  # noqa: E402
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

from app.config import database as database_module  # noqa: E402
from app.config.settings import settings  # noqa: E402
from app.services.embeddings.descriptions import build_embed_text, get_description_provider  # noqa: E402
from app.services.embeddings.model import get_embedder, get_manager  # noqa: E402
from app.services.embeddings.normalise import normalise_skill  # noqa: E402
from app.services.matching import service  # noqa: E402
from app.services.professions.role_index import RoleSkillIndex, use_role_index  # noqa: E402

# Known doubtful (user skill → role skill) pairs from earlier work; matched case-insensitively,
# a role name containing the fragment counts.
KNOWN_DOUBTFUL = [
    ("docker", "field-programmable gate array"),
    ("docker", "fpga"),
    ("docker", "resource-efficient technologies"),
    ("react", "selenium"),
    ("docker", ".net"),
]


def is_known_doubtful(user: str, role: str) -> bool:
    u, r = user.lower(), role.lower()
    return any(u == ku and kr in r for ku, kr in KNOWN_DOUBTFUL)


def owned_for(skills):
    owned = {}
    for name in skills:
        key, canonical = normalise_skill(name)
        if key and key not in owned:
            owned[key] = {"name": canonical, "source": "manual"}
    return owned


def in_memory_vectors(embedder):
    """service.user_vectors replacement: the same 'Name: description' text rule as the vector
    cache, embedded in memory (no database write)."""
    async def user_vectors(owned, db):
        keys = list(owned)
        names = [owned[k]["name"] for k in keys]
        matrix = embedder.embed_texts([build_embed_text(n).text for n in names])
        return keys, names, np.asarray(matrix, dtype=np.float32)
    return user_vectors


def titles_of(result):
    return {m["title"] for m in result["members"]}


def esco_only(result):
    return {m["source"] for m in result["members"]} == {"esco"}


ACCEPTABLE_KEY = "acceptable"
RELATED_CREDIT = False


async def evaluate(profiles: dict) -> dict:
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
    embedder = get_embedder()
    service.user_vectors = in_memory_vectors(embedder)  # read-only: no vector-cache writes
    provider = get_description_provider()

    out = {"generated_at": datetime.now(timezone.utc).isoformat(), "model": embedder.model_name,
           "index_state_hash": index.snapshot.meta.get("state_hash"), "role_skills": len(index.snapshot.keys),
           "profiles": []}
    for profile in profiles["profiles"]:
        owned = owned_for(profile["skills"])
        undescribed = [v["name"] for v in owned.values() if provider.lookup(v["name"]) is None]
        results = await service.compute(owned, db, RELATED_CREDIT)
        acceptable = set(profile.get(ACCEPTABLE_KEY) or [])
        first_rank = next((i for i, r in enumerate(results, 1) if titles_of(r) & acceptable), None)
        top10 = results[:10]
        esco_ranks = [i for i, r in enumerate(results, 1) if esco_only(r)]
        related = []
        for rank, r in enumerate(results[:5], 1):
            for m in r["members"]:
                for row in m["required"]:
                    if row["status"] == "related":
                        related.append({"rank": rank, "career": r["title"], "source": m["source"], "role_skill": row["name"],
                                        "via": row["via"]["name"], "similarity": row["via"]["similarity"],
                                        "kind": row["via"]["kind"],
                                        "known_doubtful": is_known_doubtful(row["via"]["name"], row["name"])})
        out["profiles"].append({
            "id": profile["id"], "label": profile["label"], "control": bool(profile.get("control")),
            "skills": profile["skills"], "normalised": [v["name"] for v in owned.values()], "undescribed_skills": undescribed,
            "acceptable": profile.get(ACCEPTABLE_KEY) or [],
            "top5": [{"rank": i, "title": r["title"], "score": r["score"], "sources": [s["source"] for s in r["sources"]],
                      "titles": sorted(titles_of(r)), "matched": r["matched"], "related": r["related"], "missing": r["missing"],
                      "required": r["required_count"], "acceptable": bool(titles_of(r) & acceptable)}
                     for i, r in enumerate(results[:5], 1)],
            "first_acceptable_rank": first_rank,
            "first_acceptable_score": results[first_rank - 1]["score"] if first_rank else None,
            "top3_hit": bool(first_rank and first_rank <= 3),
            "top5_hit": bool(first_rank and first_rank <= 5),
            "best": {"title": results[0]["title"], "score": results[0]["score"]},
            "esco_only_share_top10": round(sum(esco_only(r) for r in top10) / max(len(top10), 1), 2),
            "best_esco_only_rank": esco_ranks[0] if esco_ranks else None,
            "related_credits_top5": related,
            "results_count": len(results),
        })
    client.close()

    it = [p for p in out["profiles"] if not p["control"]]
    chef = next((p for p in out["profiles"] if p["control"]), None)
    mark = profiles.get("pass_mark")
    out["summary"] = {
        "top3_hits": sum(p["top3_hit"] for p in it), "top5_hits": sum(p["top5_hit"] for p in it), "it_profiles": len(it),
        "chef_best": chef["best"] if chef else None,
        "pass_mark": mark,
    }
    s = out["summary"]
    s["passed"] = (bool(mark and chef) and s["top3_hits"] >= mark["top3_hits_min"] and s["top5_hits"] >= mark["top5_hits_min"]
                   and chef["best"]["score"] < mark["chef_best_below"]) if mark and chef else None
    return out


def report(out: dict, background: dict) -> str:
    s = out["summary"]
    lines = ["# Module 5 career matching — evaluation", "",
             f"Generated {out['generated_at']} · model `{out['model']}` · {out['role_skills']} role skills · "
             f"index state `{(out['index_state_hash'] or '')[:12]}` · read-only run (no cache writes).", "",
             "Expectations (`profiles.json`) were committed before this run.", "",
             "## Result", "",
             f"- Top-3 hit rate: **{s['top3_hits']} / {s['it_profiles']}**" + (f" (pass mark ≥ {s['pass_mark']['top3_hits_min']})" if s["pass_mark"] else ""),
             f"- Top-5 hit rate: **{s['top5_hits']} / {s['it_profiles']}**" + (f" (pass mark ≥ {s['pass_mark']['top5_hits_min']})" if s["pass_mark"] else ""),
             (f"- Chef control: best **{s['chef_best']['score']} %** ({s['chef_best']['title']}) (pass mark < {s['pass_mark']['chef_best_below']} %)"
              if s["chef_best"] else "- Chef control: not in this profile file"),
             f"- Background credit check: chef {background.get('chef')} % vs web {background.get('web')} % — "
             f"{'PASS' if background.get('passed') else 'FAIL'}",
             f"- **Pass mark {'met' if s['passed'] else 'NOT met'}.**" if s["passed"] is not None else "- No pass mark for this profile file.", "",
             "## Per profile", ""]
    for p in out["profiles"]:
        lines += [f"### {p['label']}", "",
                  f"Skills: {', '.join(p['skills'])}" + (f" · undescribed: {', '.join(p['undescribed_skills'])}" if p["undescribed_skills"] else ""),
                  f"Acceptable: {', '.join(p['acceptable']) or '— (control: no IT role above 20 %)'}", "",
                  "| Rank | Career | Match | Sources | Held / related / missing (of required) | Acceptable |",
                  "|---|---|---|---|---|---|"]
        for r in p["top5"]:
            lines.append(f"| {r['rank']} | {r['title']} | {r['score']} % | {' + '.join(x.upper() if x == 'esco' else 'O*NET' for x in r['sources'])} | "
                         f"{r['matched']} / {r['related']} / {r['missing']} (of {r['required']}) | {'yes' if r['acceptable'] else ''} |")
        lines += ["", f"First acceptable role: rank **{p['first_acceptable_rank']}** ({p['first_acceptable_score']} %)" if not p["control"]
                  else f"Best: {p['best']['score']} % ({p['best']['title']})",
                  f"ESCO-only roles in the top 10: {int(p['esco_only_share_top10'] * 100)} % · best ESCO-only rank: {p['best_esco_only_rank']}", ""]
    lines += ["## Related credits in the top 5", "",
              "Every related credit behind a top-5 result. **Known** = a pair already known to be doubtful.", "",
              "| Profile | Rank | Career | Role skill | Via user skill | Similarity | Kind | Known doubtful |",
              "|---|---|---|---|---|---|---|---|"]
    for p in out["profiles"]:
        for c in p["related_credits_top5"]:
            lines.append(f"| {p['id']} | {c['rank']} | {c['career']} ({c['source']}) | {c['role_skill']} | {c['via']} | "
                         f"{c['similarity']:.3f} | {c['kind']} | {'**known**' if c['known_doubtful'] else ''} |")
    return "\n".join(lines) + "\n"


def run_background_check() -> dict:
    import subprocess

    script = HERE.parent / "background_credit_rate.py"
    proc = subprocess.run([sys.executable, str(script)], capture_output=True, text=True, encoding="utf8")
    try:
        data = json.loads(proc.stdout)
        check = data["check"]
        return {"chef": check["chef_pooled_pct"], "web": check["web_pooled_pct"], "ratio": check["chef_to_web"],
                "metric": check.get("metric"), "criteria": check.get("criteria"),
                "legacy_related": data.get("legacy_related_check"),
                "passed": check["passed"], "exit_code": proc.returncode}
    except (ValueError, KeyError):
        return {"passed": False, "error": "could not read the background check output", "exit_code": proc.returncode}


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--out", default=str(HERE / "results"), help="output folder (results.json, report.md)")
    parser.add_argument("--profiles", default=str(HERE / "profiles.json"), help="profile file (default profiles.json)")
    parser.add_argument("--acceptable-key", default="acceptable", help="field with the acceptable titles (Module 5.2: acceptable_b)")
    parser.add_argument("--related-credit", action="store_true", help="score with the 0.5 related-credit rule (mode on)")
    args = parser.parse_args()
    global ACCEPTABLE_KEY, RELATED_CREDIT
    ACCEPTABLE_KEY, RELATED_CREDIT = args.acceptable_key, args.related_credit
    profiles = json.loads(Path(args.profiles).read_text(encoding="utf8"))
    out = asyncio.run(evaluate(profiles))
    out["acceptable_key"], out["scoring_mode"] = ACCEPTABLE_KEY, ("related" if RELATED_CREDIT else "exact")
    background = run_background_check()
    out["background_check"] = background
    folder = Path(args.out)
    folder.mkdir(parents=True, exist_ok=True)
    (folder / "results.json").write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf8")
    (folder / "report.md").write_text(report(out, background), encoding="utf8")
    s = out["summary"]
    sys.stdout.reconfigure(encoding="utf-8")
    chef = f"{s['chef_best']['score']}%" if s["chef_best"] else "n/a"
    mark = "n/a" if s["passed"] is None else ("MET" if s["passed"] else "NOT MET")
    print(f"top-3 {s['top3_hits']}/{s['it_profiles']} · top-5 {s['top5_hits']}/{s['it_profiles']} · chef {chef} "
          f"· background {'PASS' if background.get('passed') else 'FAIL'} · pass mark {mark}")


if __name__ == "__main__":
    main()
