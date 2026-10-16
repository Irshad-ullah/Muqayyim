#!/usr/bin/env python
"""
Module 5.1 — A. Diagnose option (b) from the Module 5 evaluation (phrases mapped to tool names at
bi-encoder cosine >= 0.80). Sandbox: read-only, nothing adopted.

Reports: how many ESCO essential phrases have at least one described skill at cosine >= 0.80
(split by ESCO skill type, with role counts), examples; and for the DevOps and mobile profiles,
which required skills changed status under (b) versus the adopted design and why the ranks did
not move. Output: results/diagnosis.json and results/diagnosis.md.

Usage (repo root): AIServices/backend/venv/Scripts/python AIServices/eval/esco_phrase_mapping/diagnose_option_b.py
"""

import asyncio
import json
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent / "career_matching"))

import common  # noqa: E402  (sets the backend path and working directory)
import numpy as np  # noqa: E402

THRESHOLD = 0.80


async def profile_changes(embedder):
    """Baseline vs option (b) for the DevOps and mobile profiles (the Module 5 options code, reused)."""
    import options  # career_matching/options.py
    import run_eval
    from motor.motor_asyncio import AsyncIOMotorClient

    from app.config import database as database_module
    from app.config.settings import settings
    from app.services.embeddings.descriptions import get_description_provider
    from app.services.matching import service
    from app.services.professions.role_index import RoleSkillIndex, use_role_index

    client = AsyncIOMotorClient(settings.MONGODB_URL)
    database = client[settings.AI_DB_NAME]
    database_module.database = database
    index = RoleSkillIndex(Path(settings.ROLE_INDEX_DIR))
    assert index.load_files({})
    use_role_index(index)
    service.user_vectors = run_eval.in_memory_vectors(embedder)
    skill_types = {d["label"]: d.get("skill_type") async for d in database["esco_skills"].find({}, {"label": 1, "skill_type": 1})}
    mapping = options.option_b_mapping(index.snapshot, embedder, get_description_provider(), skill_types)
    profiles = {p["id"]: p for p in json.loads((HERE.parent / "career_matching" / "profiles.json").read_text(encoding="utf8"))["profiles"]}

    out = {}
    for pid in ("devops", "mobile"):
        profile = profiles[pid]
        owned = run_eval.owned_for(profile["skills"])
        base = await service.compute(owned, database)
        with options.patched(service, "current_skill", options.option_b_current_skill(mapping)):
            mapped = await service.compute(owned, database)

        def by_member(results):
            return {m["profession_id"]: (rank, m) for rank, r in enumerate(results, 1) for m in r["members"]}

        b0, b1 = by_member(base), by_member(mapped)
        watch = set(profile["acceptable"]) | {r["title"] for r in base[:5]}
        rows = []
        for pid_, (rank0, m0) in b0.items():
            if m0["title"] not in watch:
                continue
            rank1, m1 = b1[pid_]
            before = {r["key"]: r for r in m0["required"]}
            after = {r["key"]: r for r in m1["required"]}
            changed = []
            mapped_phrases = [k for k in before if k in mapping]
            for key in mapped_phrases:
                tool_key, tool, sim = mapping[key]
                new = after.get(tool_key)
                changed.append({"phrase": before[key]["name"], "status_before": before[key]["status"], "tool": tool,
                                "cosine": round(sim, 3), "tool_held": tool_key in owned,
                                "status_after": new["status"] if new else "merged"})
            rows.append({"title": m0["title"], "source": m0["source"], "rank_before": rank0, "rank_after": rank1,
                         "score_before": m0["score"], "score_after": m1["score"], "required": m0["required_count"],
                         "phrases_mapped": len(mapped_phrases), "mapped_tools_held": sum(c["tool_held"] for c in changed),
                         "changes": changed})
        out[pid] = {"label": profile["label"], "skills": profile["skills"],
                    "roles": sorted(rows, key=lambda r: r["rank_before"])}
    client.close()
    return out, mapping


def main():
    database = common.db()
    phrases = common.essential_phrases(database)
    skills = common.described_skills()
    embedder = common.bi_encoder()
    names, pm, skill_names, sm = common.embed_phrases_and_skills(embedder, phrases, skills)
    sims = pm @ sm.T
    best = sims.argmax(axis=1)
    best_sim = sims.max(axis=1)
    hit = best_sim >= THRESHOLD

    by_type = Counter(phrases[n]["skill_type"] for n in names)
    hit_by_type = Counter(phrases[n]["skill_type"] for n, h in zip(names, hit) if h)
    occurrences = sum(len(phrases[n]["roles"]) for n in names)
    hit_occurrences = sum(len(phrases[n]["roles"]) for n, h in zip(names, hit) if h)
    examples = sorted(((names[i], skill_names[best[i]], round(float(best_sim[i]), 3), len(phrases[names[i]]["roles"]))
                       for i in np.where(hit)[0]), key=lambda x: (-x[3], -x[2]))
    near = sorted(((names[i], skill_names[best[i]], round(float(best_sim[i]), 3), len(phrases[names[i]]["roles"]))
                   for i in np.where((best_sim >= 0.75) & (best_sim < THRESHOLD))[0]), key=lambda x: -x[3])

    changes, mapping = asyncio.run(profile_changes(embedder))
    summary = {
        "essential_phrases": len(names), "essential_occurrences": occurrences,
        "by_skill_type": dict(by_type),
        "with_tool_at_0_80": int(hit.sum()), "with_tool_at_0_80_pct": round(100 * hit.mean(), 1),
        "with_tool_by_skill_type": dict(hit_by_type),
        "occurrences_covered": hit_occurrences, "occurrences_covered_pct": round(100 * hit_occurrences / occurrences, 1),
        "option_b_mapping_size_all_role_skills": len(mapping),
    }
    result = {"threshold": THRESHOLD, "summary": summary, "examples_most_used": examples[:30],
              "near_misses_0_75_to_0_80": near[:20], "profiles": changes}
    common.RESULTS.mkdir(exist_ok=True)
    (common.RESULTS / "diagnosis.json").write_text(json.dumps(result, indent=2, ensure_ascii=False), encoding="utf8")

    s = summary
    lines = ["# Module 5.1 — A. Diagnosis of option (b) (phrases → tools at bi-encoder cosine ≥ 0.80)", "",
             f"- ESCO essential phrases (distinct, undescribed, in the {130} active roles' ESCO part): **{s['essential_phrases']}** "
             f"({s['essential_occurrences']} role occurrences); by ESCO type: {s['by_skill_type']}",
             f"- With at least one described skill at cosine ≥ 0.80: **{s['with_tool_at_0_80']} ({s['with_tool_at_0_80_pct']} %)**, "
             f"covering {s['occurrences_covered']} occurrences ({s['occurrences_covered_pct']} %); by type: {s['with_tool_by_skill_type']}",
             f"- (Option (b) in Module 5 mapped {s['option_b_mapping_size_all_role_skills']} role skills — all role skills, not only essential.)",
             "", "## Most-used mapped phrases", "", "| Phrase | Nearest described skill | Cosine | Roles |", "|---|---|---|---|"]
    lines += [f"| {p} | {t} | {c} | {n} |" for p, t, c, n in examples[:20]]
    lines += ["", "## Near misses (0.75 – 0.80)", "", "| Phrase | Nearest described skill | Cosine | Roles |", "|---|---|---|---|"]
    lines += [f"| {p} | {t} | {c} | {n} |" for p, t, c, n in near[:12]]
    for pid, data in changes.items():
        lines += ["", f"## {data['label']}: what changed under (b)", "", f"Skills: {', '.join(data['skills'])}", "",
                  "| Role | Rank before → after | Score before → after | Required | Phrases mapped | Mapped tools the profile holds |",
                  "|---|---|---|---|---|---|"]
        for r in data["roles"]:
            lines.append(f"| {r['title']} ({r['source']}) | {r['rank_before']} → {r['rank_after']} | {r['score_before']} → "
                         f"{r['score_after']} % | {r['required']} | {r['phrases_mapped']} | {r['mapped_tools_held']} |")
        for r in data["roles"]:
            if r["changes"]:
                lines += ["", f"**{r['title']}** — mapped required phrases:", ""]
                lines += [f"- {c['phrase']} → {c['tool']} ({c['cosine']}): {c['status_before']} → {c['status_after']}"
                          f"{' (tool held)' if c['tool_held'] else ''}" for c in r["changes"]]
    (common.RESULTS / "diagnosis.md").write_text("\n".join(lines) + "\n", encoding="utf8")
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
