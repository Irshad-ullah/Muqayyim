#!/usr/bin/env python
"""
Module 5.1 — sandbox evaluation of the role-aware phrase → skill mapping (role_phrase_skill_map.json).

Rule under test: a required ESCO phrase counts as held (credit 1.0, shown as matched "via mapping") when the user has
any skill mapped to that (role, phrase); otherwise the production rule applies unchanged (same key 1.0, related 0.5,
missing 0). Implemented by wrapping app.services.matching.scoring.score_profession IN THIS PROCESS ONLY; production code,
data, the vector cache and the career_matches cache are not touched (user skills are embedded in memory exactly as in
career_matching/run_eval.py).

Profile sets, reported separately, each as production baseline vs mapping:
  old    career_matching/profiles.json (the 8 Module 5 profiles incl. the chef control) — clean test, not seen while mapping
  new    career_matching/profiles_new.json (6 profiles written by the same assistant just before the mapping) — NOT blind
Reported: top-3 / top-5 hit rates, the first acceptable rank per profile (DevOps and mobile highlighted), the chef's best
%, the production background credit check plus a mapping analogue (mapped-credit rate for its chef and web profiles),
the ESCO-only share in each top 10, the most-changed roles, the most influential mappings, the spot-check precision.

Output: results/role_map_eval.json and results/role_map_eval.md.
Usage (repo root): AIServices/backend/venv/Scripts/python AIServices/eval/esco_phrase_mapping/evaluate_role_map.py
"""

import asyncio
import csv
import json
import math
import statistics
import sys
from collections import defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
EVAL = HERE.parent
sys.path.insert(0, str(EVAL / "career_matching"))

import run_eval  # noqa: E402  (sets the backend path, cwd)
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

from app.config import database as database_module  # noqa: E402
from app.config.settings import settings  # noqa: E402
from app.services.embeddings.model import get_embedder, get_manager  # noqa: E402
from app.services.embeddings.normalise import normalise_skill  # noqa: E402
from app.services.matching import scoring, service  # noqa: E402
from app.services.professions.role_index import RoleSkillIndex, use_role_index  # noqa: E402

ORIGINAL_SCORE = scoring.score_profession
BACKGROUND_PROFILES = {"web": ["React", "Python", "Docker", "Figma"],
                       "chef": ["Cooking", "Customer Service", "Inventory Management"]}


def load_map():
    """{(role title, phrase): {skill key: skill name}}"""
    doc = json.loads((HERE / "role_phrase_skill_map.json").read_text(encoding="utf8"))
    return {(e["role"], e["phrase"]): {normalise_skill(s)[0]: s for s in e["skills"]} for e in doc["entries"] if e["skills"]}


def mapped_scorer(mapping):
    """score_profession with the mapping rule applied to required ESCO rows (in this process only)."""
    def score_profession(profession, owned, related, current_skill):
        result = ORIGINAL_SCORE(profession, owned, related, current_skill)
        if profession.get("source") != "esco":
            return result
        changed = False
        for row in result["required"]:
            if row["status"] == scoring.MATCHED:
                continue
            skills = mapping.get((result["title"], row["name"]))
            held = [k for k in (skills or {}) if k in owned]
            if held:
                row.update(status=scoring.MATCHED, credit=scoring.MATCHED_CREDIT, previous_credit=row["credit"],
                           via={"name": owned[held[0]]["name"], "source": owned[held[0]].get("source"), "mapping": True,
                                "all": [owned[k]["name"] for k in held]})
                changed = True
        if changed:
            rows = result["required"]
            total = len(rows)
            result.update(score=round(100.0 * sum(r["credit"] for r in rows) / total, 1) if total else 0.0,
                          matched=sum(r["status"] == scoring.MATCHED for r in rows),
                          related=sum(r["status"] == scoring.RELATED for r in rows),
                          missing=sum(r["status"] == scoring.MISSING for r in rows),
                          gaps=[r["name"] for r in rows if r["status"] == scoring.MISSING])
        return result
    return score_profession


def esco_only(result):
    return {m["source"] for m in result["members"]} == {"esco"}


def summarise(profile, results):
    acceptable = set(profile.get("acceptable", []))
    titles = lambda r: {m["title"] for m in r["members"]}  # noqa: E731
    first = next((i for i, r in enumerate(results, 1) if titles(r) & acceptable), None)
    top10 = results[:10]
    return {
        "first_acceptable_rank": first,
        "first_acceptable": ({"title": results[first - 1]["title"], "score": results[first - 1]["score"]} if first else None),
        "top3_hit": bool(first and first <= 3), "top5_hit": bool(first and first <= 5),
        "top5": [{"rank": i, "title": r["title"], "score": r["score"], "esco_only": esco_only(r),
                  "acceptable": bool(titles(r) & acceptable)} for i, r in enumerate(results[:5], 1)],
        "best": {"title": results[0]["title"], "score": results[0]["score"]},
        "esco_only_share_top10": round(sum(esco_only(r) for r in top10) / max(len(top10), 1), 2),
        "scores": {r["title"]: r["score"] for r in results},
    }


def mapped_credits(results, top=10):
    """[(role, phrase, via skills, points added to that role's score)] for the mapped credits in the top results."""
    out = []
    for r in results[:top]:
        for m in r["members"]:
            if m["title"] != r["title"]:
                continue  # only the record that sets the shown score
            for row in m["required"]:
                via = row.get("via") or {}
                if via.get("mapping"):
                    out.append({"role": m["title"], "phrase": row["name"], "via": via["all"],
                                "points": round(100.0 * (1.0 - row["previous_credit"]) / m["required_count"], 2)})
    return out


async def score_all(profiles, mapping):
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
    service.user_vectors = run_eval.in_memory_vectors(get_embedder())  # read-only: no vector-cache writes
    out = {}
    for group, items in profiles.items():
        out[group] = []
        for profile in items:
            owned = run_eval.owned_for(profile["skills"])
            scoring.score_profession = ORIGINAL_SCORE
            base = await service.compute(owned, db)
            scoring.score_profession = mapped_scorer(mapping)
            mapped = await service.compute(owned, db)
            scoring.score_profession = ORIGINAL_SCORE
            out[group].append({"id": profile["id"], "label": profile["label"], "control": bool(profile.get("control")),
                               "skills": profile["skills"], "acceptable": profile.get("acceptable", []),
                               "baseline": summarise(profile, base), "mapping": summarise(profile, mapped),
                               "mapped_credits_top10": mapped_credits(mapped)})
    # Mapping analogue of the background check: share of required ESCO rows (not already matched) credited by the map.
    background = {}
    for name, skills in BACKGROUND_PROFILES.items():
        owned = run_eval.owned_for(skills)
        keys = set(owned)
        eligible = credited = 0
        async for prof in db["professions"].find({"active": True, "source": "esco"}, {"title": 1, "skills": 1, "source": 1}):
            required, _ = scoring.split_required(prof)
            for skill in required:
                from app.services.professions.role_skills import current_skill
                key, phrase = current_skill(skill)
                if key in keys:
                    continue
                eligible += 1
                if keys & set(mapping.get((prof["title"], phrase), {})):
                    credited += 1
        background[name] = {"eligible_rows": eligible, "credited_by_mapping": credited,
                            "rate_pct": round(100.0 * credited / eligible, 2) if eligible else 0.0}
    client.close()
    return out, background


def spot_check():
    rows = list(csv.DictReader((HERE / "spot_check.csv").open(encoding="utf8")))
    labelled = [r for r in rows if r["correct"].strip() in ("0", "1")]
    right = sum(r["correct"].strip() == "1" for r in labelled)
    n = len(labelled)
    p = right / n if n else 0.0
    z = 1.96  # Wilson 95 % interval
    centre = (p + z * z / (2 * n)) / (1 + z * z / n)
    half = z * math.sqrt(p * (1 - p) / n + z * z / (4 * n * n)) / (1 + z * z / n)
    return {"labelled": n, "correct": right, "precision": round(p, 3), "wilson95": [round(centre - half, 3), round(centre + half, 3)],
            "zero_rows": [r["id"] for r in labelled if r["correct"].strip() == "0"]}


def group_summary(items):
    it = [p for p in items if not p["control"]]
    out = {}
    for mode in ("baseline", "mapping"):
        out[mode] = {"top3": sum(p[mode]["top3_hit"] for p in it), "top5": sum(p[mode]["top5_hit"] for p in it), "profiles": len(it),
                     "median_esco_only_share_top10": statistics.median(p[mode]["esco_only_share_top10"] for p in it)}
    return out


def most_changed(items, n=5):
    deltas = defaultdict(list)
    for p in items:
        if p["control"]:
            continue
        for title, after in p["mapping"]["scores"].items():
            before = p["baseline"]["scores"].get(title, 0.0)
            deltas[title].append((before, after))
    rows = [{"role": t, "mean_before": round(statistics.mean(b for b, _ in v), 1), "mean_after": round(statistics.mean(a for _, a in v), 1),
             "max_gain": round(max(a - b for b, a in v), 1)} for t, v in deltas.items()]
    for r in rows:
        r["mean_gain"] = round(r["mean_after"] - r["mean_before"], 1)
    return sorted(rows, key=lambda r: -r["mean_gain"])[:n]


def influential(items, n=15):
    agg = {}
    for p in items:
        if p["control"]:
            continue
        for c in p["mapped_credits_top10"]:
            entry = agg.setdefault((c["role"], c["phrase"]), {"role": c["role"], "phrase": c["phrase"], "points": 0.0,
                                                             "profiles": set(), "via": set()})
            entry["points"] += c["points"]
            entry["profiles"].add(p["id"])
            entry["via"].update(c["via"])
    rows = sorted(agg.values(), key=lambda e: (-e["points"], e["role"]))[:n]
    return [{**r, "points": round(r["points"], 1), "profiles": sorted(r["profiles"]), "via": sorted(r["via"])} for r in rows]


def report(out, background, prod_background, check):
    L = ["# Module 5.1 — role-aware phrase mapping: sandbox evaluation", "",
         "Rule: a required ESCO phrase counts as held (1.0) if the user has any skill mapped to that (role, phrase); otherwise "
         "the production rule. Baseline = production scoring, same run, same index. Sandbox only — nothing adopted.", "",
         f"**Spot-check precision:** {check['correct']} / {check['labelled']} = **{check['precision']:.0%}** "
         f"(Wilson 95 % interval {check['wilson95'][0]:.0%}–{check['wilson95'][1]:.0%}); 0-rows: {', '.join(check['zero_rows']) or 'none'}"
         + (" — below 90 %: see the variant without them." if check["precision"] < 0.9 else " — at or above 90 %, so no 'without 0-rows' variant."), "",
         "**Background credit check** (production, related credit; the mapping does not change related credit): "
         f"chef {prod_background.get('chef')} % vs web {prod_background.get('web')} % — {'PASS' if prod_background.get('passed') else 'FAIL'}. "
         f"Mapping analogue (required ESCO rows credited by the map, all active ESCO roles): chef "
         f"{background['chef']['credited_by_mapping']} / {background['chef']['eligible_rows']} = {background['chef']['rate_pct']} %, "
         f"web {background['web']['credited_by_mapping']} / {background['web']['eligible_rows']} = {background['web']['rate_pct']} %.", ""]
    names = {"old": "Old 8 — clean test (not seen while mapping)", "new": "New 6 — NOT blind (written by the mapper)"}
    for group, items in out.items():
        s = group_summary(items)
        L += [f"## {names[group]}", "",
              "| | Production baseline | With mapping |", "|---|---|---|",
              f"| Top-3 hit rate | {s['baseline']['top3']} / {s['baseline']['profiles']} | {s['mapping']['top3']} / {s['mapping']['profiles']} |",
              f"| Top-5 hit rate | {s['baseline']['top5']} / {s['baseline']['profiles']} | {s['mapping']['top5']} / {s['mapping']['profiles']} |",
              f"| Median ESCO-only share in the top 10 | {s['baseline']['median_esco_only_share_top10']:.0%} | {s['mapping']['median_esco_only_share_top10']:.0%} |"]
        chef = next((p for p in items if p["control"]), None)
        if chef:
            L.append(f"| Chef control: best | {chef['baseline']['best']['score']} % ({chef['baseline']['best']['title']}) | "
                     f"{chef['mapping']['best']['score']} % ({chef['mapping']['best']['title']}) |")
        L += ["", "| Profile | First acceptable rank: baseline → mapping | Score of that role | Best result (mapping) | ESCO-only in top 10 |",
              "|---|---|---|---|---|"]
        for p in items:
            b, m = p["baseline"], p["mapping"]
            star = " **(DevOps)**" if "devops" in p["label"].lower() else (" **(mobile)**" if any(w in p["label"].lower() for w in ("mobile", "android")) else "")
            if p["control"]:
                L.append(f"| {p['label']} (control) | — | — | {m['best']['score']} % {m['best']['title']} | "
                         f"{b['esco_only_share_top10']:.0%} → {m['esco_only_share_top10']:.0%} |")
                continue
            fa = lambda x: f"{x['first_acceptable']['score']} % {x['first_acceptable']['title']}" if x["first_acceptable"] else "—"  # noqa: E731
            L.append(f"| {p['label']}{star} | {b['first_acceptable_rank']} → **{m['first_acceptable_rank']}** | {fa(b)} → {fa(m)} | "
                     f"{m['best']['score']} % {m['best']['title']} | {b['esco_only_share_top10']:.0%} → {m['esco_only_share_top10']:.0%} |")
        L += ["", "**Top 5 with the mapping** (ESCO-only roles marked E, acceptable roles ✓):", ""]
        for p in items:
            L.append(f"- {p['label']}: " + "; ".join(f"{r['rank']}. {r['title']} {r['score']} %{' E' if r['esco_only'] else ''}{' ✓' if r['acceptable'] else ''}"
                                                       for r in p["mapping"]["top5"]))
        L += ["", "**Most-changed roles** (mean score over the group's IT profiles):", "",
              "| Role | Before → after | Mean gain | Largest gain for one profile |", "|---|---|---|---|"]
        L += [f"| {r['role']} | {r['mean_before']} → {r['mean_after']} % | +{r['mean_gain']} | +{r['max_gain']} |" for r in most_changed(items)]
        L += ["", "**Most influential mappings** (score points added in the profiles' top 10, summed):", "",
              "| Role | Phrase | Via user skill(s) | Points | Profiles |", "|---|---|---|---|---|"]
        L += [f"| {r['role']} | {r['phrase']} | {', '.join(r['via'])} | {r['points']} | {', '.join(r['profiles'])} |" for r in influential(items)]
        L.append("")
    return "\n".join(L) + "\n"


def main():
    mapping = load_map()
    profiles = {"old": json.loads((EVAL / "career_matching/profiles.json").read_text(encoding="utf8"))["profiles"],
                "new": json.loads((EVAL / "career_matching/profiles_new.json").read_text(encoding="utf8"))["profiles"]}
    out, background = asyncio.run(score_all(profiles, mapping))
    prod_background = run_eval.run_background_check()
    check = spot_check()
    doc = {"rule": "required ESCO phrase held (1.0) if the user has any mapped skill; otherwise production",
           "map_entries": len(mapping), "spot_check": check, "background_production": prod_background,
           "background_mapping": background, "groups": out,
           "summary": {g: group_summary(items) for g, items in out.items()},
           "most_changed": {g: most_changed(items) for g, items in out.items()},
           "influential": {g: influential(items) for g, items in out.items()}}
    (HERE / "results").mkdir(exist_ok=True)
    (HERE / "results/role_map_eval.json").write_text(json.dumps(doc, indent=1, ensure_ascii=False, default=list), encoding="utf8")
    (HERE / "results/role_map_eval.md").write_text(report(out, background, prod_background, check), encoding="utf8")
    sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(doc["summary"], indent=1))


if __name__ == "__main__":
    main()
