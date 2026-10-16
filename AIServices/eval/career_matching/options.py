#!/usr/bin/env python
"""
Module 5: measures the three options discussed for the ESCO bias WITHOUT adopting any of them
(read-only, nothing written). Each option is applied by temporarily patching the production
scorer inside this process only:

  baseline  the adopted design (app.services.matching)
  (a)       ESCO roles scored only on named tool / knowledge skills: ESCO skills whose ESCO
            skill type is "knowledge" (essential first, topped up to 10 with optional knowledge
            skills); ability phrases ("skill/competence") are dropped from ESCO roles.
  (b)       ability phrases mapped to tool names: every undescribed ESCO "skill/competence" role
            skill is replaced by its nearest curated (described) skill when their cosine is
            >= MAP_THRESHOLD, so holding that tool counts as an exact match.
  (c)       full credit for a mixed pair at a stricter similarity: a mixed pair (user skill
            described, role skill an ESCO label) with similarity >= C_THRESHOLD earns 1.0 instead
            of 0.5 (0.73 <= sim < C_THRESHOLD still earns 0.5).

For each: the sanity profiles' top-3 / top-5 hit rates, the chef control's best score, and the
background credit measure computed the way eval/background_credit_rate.py defines it (share of a
profile's non-held role skills, over all role skills of every active profession, that get related
credit; chef <= 5 % and <= 0.5 x web), plus a credit-weighted variant (relevant for (c)).

Usage (repo root): AIServices/backend/venv/Scripts/python AIServices/eval/career_matching/options.py
"""

import asyncio
import json
import sys
from contextlib import contextmanager
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import run_eval  # noqa: E402 — sets up sys.path and the working directory like the evaluation

import numpy as np  # noqa: E402
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

from app.config import database as database_module  # noqa: E402
from app.config.settings import settings  # noqa: E402
from app.services.embeddings import descriptions as descriptions_module  # noqa: E402
from app.services.embeddings.descriptions import build_embed_text, get_description_provider  # noqa: E402
from app.services.embeddings.model import get_embedder, get_manager  # noqa: E402
from app.services.embeddings.normalise import normalise_skill  # noqa: E402
from app.services.matching import scoring, service  # noqa: E402
from app.services.professions.role_index import RoleSkillIndex, use_role_index  # noqa: E402
from app.services.professions.role_skills import current_skill  # noqa: E402

BACKGROUND = {"web": ["React", "Python", "Docker", "Figma"], "chef": ["Cooking", "Customer Service", "Inventory Management"]}
MAP_THRESHOLD = 0.80
C_THRESHOLDS = (0.80, 0.85)


@contextmanager
def patched(obj, name, value):
    old = getattr(obj, name)
    setattr(obj, name, value)
    try:
        yield
    finally:
        setattr(obj, name, old)


# ── option (a): ESCO knowledge skills only ────────────────────────────────────
def option_a_split(skill_types):
    original = scoring.split_required

    def split(profession, minimum=scoring.MIN_REQUIRED):
        if profession.get("source") != "esco":
            return original(profession, minimum)
        knowledge = [s for s in profession.get("skills") or []
                     if skill_types.get(s.get("original_label") or s["name"]) == "knowledge"]
        return original({**profession, "skills": knowledge}, minimum)
    return split


# ── option (b): ability phrases → nearest curated tool ────────────────────────
def option_b_mapping(snapshot, embedder, provider, skill_types):
    curated = json.loads(Path(descriptions_module.CURATED_FILE).read_text(encoding="utf8"))
    names = sorted(curated)
    vectors = embedder.embed_texts([build_embed_text(n).text for n in names])
    mapping = {}
    for i, key in enumerate(snapshot.keys):
        name = snapshot.names[key]
        if provider.lookup(name) is not None:
            continue  # already a described (tool-like) skill
        if skill_types.get(name) not in ("skill/competence", None):
            continue  # only ability phrases
        sims = vectors @ snapshot.matrix[i]
        best = int(np.argmax(sims))
        if sims[best] >= MAP_THRESHOLD:
            mapping[key] = (normalise_skill(names[best])[0], names[best], float(sims[best]))
    return mapping


def option_b_current_skill(mapping):
    def mapped(skill):
        key, name = current_skill(skill)
        return mapping[key][:2] if key in mapping else (key, name)
    return mapped


# ── option (c): full credit for a strict mixed pair ───────────────────────────
def option_c_assess(threshold):
    original = scoring.assess

    def assess(key, name, owned, related):
        row = original(key, name, owned, related)
        if row["status"] == scoring.RELATED and row["via"].get("kind") == "mixed" and row["via"]["similarity"] >= threshold:
            row = {**row, "credit": 1.0}
        return row
    return assess


# ── measures ──────────────────────────────────────────────────────────────────
async def sanity(profiles, db):
    out = []
    for profile in profiles["profiles"]:
        results = await service.compute(run_eval.owned_for(profile["skills"]), db)
        acceptable = set(profile["acceptable"])
        rank = next((i for i, r in enumerate(results, 1) if run_eval.titles_of(r) & acceptable), None)
        accepted = {t: next((i for i, r in enumerate(results, 1) if t in run_eval.titles_of(r)), None) for t in profile["acceptable"]}
        out.append({"id": profile["id"], "control": bool(profile.get("control")), "first_rank": rank,
                    "best": {"title": results[0]["title"], "score": results[0]["score"]},
                    "top5": [(r["title"], r["score"]) for r in results[:5]], "acceptable_ranks": accepted,
                    "esco_only_top10": sum(run_eval.esco_only(r) for r in results[:10])})
    it = [p for p in out if not p["control"]]
    chef = next(p for p in out if p["control"])
    return {"top3": sum(bool(p["first_rank"] and p["first_rank"] <= 3) for p in it),
            "top5": sum(bool(p["first_rank"] and p["first_rank"] <= 5) for p in it), "it": len(it),
            "chef_best": chef["best"], "profiles": out}


async def background(db):
    """The background-check measure, over every role skill of every active profession."""
    rates = {}
    for name, skills in BACKGROUND.items():
        results = await service.compute(run_eval.owned_for(skills), db)
        credited = weighted = total = 0
        for result in results:
            for member in result["members"]:
                for row in member["required"] + member["optional"]:
                    if row["status"] == scoring.MATCHED:
                        continue
                    total += 1
                    if row["status"] == scoring.RELATED:
                        credited += 1
                        weighted += row["credit"]
        rates[name] = {"pooled_pct": round(100 * credited / total, 1) if total else 0.0,
                       "credit_weighted_pct": round(100 * weighted / total, 1) if total else 0.0}
    chef, web = rates["chef"]["pooled_pct"], rates["web"]["pooled_pct"]
    rates["passed"] = chef <= 5.0 and web > 0 and chef <= 0.5 * web
    return rates


async def main():
    profiles = json.loads((HERE / "profiles.json").read_text(encoding="utf8"))
    client = AsyncIOMotorClient(settings.MONGODB_URL)
    db = client[settings.AI_DB_NAME]
    database_module.database = db
    index = RoleSkillIndex(Path(settings.ROLE_INDEX_DIR))
    assert index.load_files({}), "index files"
    use_role_index(index)
    manager = get_manager()
    await asyncio.to_thread(manager.load_sync)
    manager.ready_event.set()
    embedder = get_embedder()
    service.user_vectors = run_eval.in_memory_vectors(embedder)  # no vector-cache writes
    provider = get_description_provider()
    skill_types = {d["label"]: d.get("skill_type") async for d in db["esco_skills"].find({}, {"label": 1, "skill_type": 1})}

    esco_knowledge = []
    async for p in db["professions"].find({"active": True, "source": "esco"}, {"skills": 1}):
        esco_knowledge.append(sum(skill_types.get(s.get("original_label") or s["name"]) == "knowledge" for s in p["skills"]))
    mapping = option_b_mapping(index.snapshot, embedder, provider, skill_types)

    options = {}

    async def measure(label, patches):
        stack = [patched(*p) for p in patches]
        for ctx in stack:
            ctx.__enter__()
        try:
            options[label] = {"sanity": await sanity(profiles, db), "background": await background(db)}
        finally:
            for ctx in reversed(stack):
                ctx.__exit__(None, None, None)

    await measure("baseline", [])
    await measure("a_esco_knowledge_only", [(scoring, "split_required", option_a_split(skill_types))])
    await measure("b_phrase_to_tool", [(service, "current_skill", option_b_current_skill(mapping))])
    for t in C_THRESHOLDS:
        await measure(f"c_full_mixed_credit_{t:.2f}", [(scoring, "assess", option_c_assess(t))])
    client.close()

    out = {
        "notes": {"a_esco_roles_knowledge_skill_counts": {"min": min(esco_knowledge), "median": float(np.median(esco_knowledge)),
                                                           "max": max(esco_knowledge),
                                                           "roles_below_5": sum(k < 5 for k in esco_knowledge)},
                  "b_map_threshold": MAP_THRESHOLD, "b_phrases_mapped": len(mapping),
                  "b_examples": sorted([(snap_name, tool, round(sim, 3)) for snap_name, (_, tool, sim)
                                        in ((index.snapshot.names[k], v) for k, v in mapping.items())], key=lambda x: -x[2])[:25],
                  "c_thresholds": list(C_THRESHOLDS)},
        "options": options,
    }
    (HERE / "results" / "options.json").write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf8")
    for label, o in options.items():
        s, b = o["sanity"], o["background"]
        print(f"{label:30} top-3 {s['top3']}/{s['it']} top-5 {s['top5']}/{s['it']} chef {s['chef_best']['score']}% "
              f"({s['chef_best']['title']}) | background chef {b['chef']['pooled_pct']}% web {b['web']['pooled_pct']}% "
              f"(weighted {b['chef']['credit_weighted_pct']} / {b['web']['credit_weighted_pct']}) {'PASS' if b['passed'] else 'FAIL'}")


if __name__ == "__main__":
    asyncio.run(main())
