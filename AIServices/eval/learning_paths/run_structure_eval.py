#!/usr/bin/env python
"""
Module 6 Part 2 — learning-path structure evaluation (expectations.md, rules 1–5; pass mark 24 / 24).

For each of the 24 profiles (old 8, new 6, 10 test CVs) the path is built with production code
(app.services.learning.structure.build) for the profile's best career match, default any-of alternatives. User skills
are embedded in memory exactly as career_matching/run_eval.py does (no profile is stored). Read only, except the
shared vector cache.

Writes results/structure_eval.{json,md}. Usage (repo root):
  AIServices/backend/venv/Scripts/python AIServices/eval/learning_paths/run_structure_eval.py
"""

import asyncio
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
from app.services.learning import structure  # noqa: E402
from app.services.matching import service  # noqa: E402
from app.services.professions.role_index import RoleSkillIndex, use_role_index  # noqa: E402

FILES = {"old8": "profiles.json", "new6": "profiles_new.json", "testcvs": "profiles_testcvs.json"}


def expected_modules(member, profession):
    """Rule 1 from first principles: missing required rows, default alternative, essential first, cut to 8."""
    items = structure.candidates(member, profession)
    ordered = [i for i in items if i["tier"] == "essential"] + [i for i in items if i["tier"] == "optional"]
    return [i["key"] for i in ordered[:structure.MAX_MODULES]], len(ordered)


def check(path, member, profession, again, with_prereq, pairs) -> dict:
    keys = [m["key"] for m in path["modules"]]
    expected, missing_total = expected_modules(member, profession)
    tiers = [m["tier"] for m in path["modules"]]
    rules = {
        "1_module_set_equals_missing_set": sorted(keys) == sorted(expected)
                                            and path["more"]["count"] == missing_total - len(keys),
        "2_tiers_in_order": tiers == sorted(tiers, key=lambda t: 0 if t == "essential" else 1),
        "3_quick_wins_first": all(
            [m["quick_win"] for m in path["modules"] if m["tier"] == tier]
            == sorted([m["quick_win"] for m in path["modules"] if m["tier"] == tier], reverse=True)
            for tier in ("essential", "optional")),
        "4_deterministic": again["modules"] == path["modules"],
    }
    if len(keys) >= 2:
        first, last = keys[0], keys[-1]
        accepted = with_prereq["prerequisites"]["accepted"]
        reasons = [r["reason"] for r in with_prereq["prerequisites"]["rejected"]]
        new_keys = [m["key"] for m in with_prereq["modules"]]
        rules["5_prerequisites_validated"] = (
            accepted == [[last, first]]
            and reasons == ["would create a cycle", "a skill cannot be its own prerequisite", "skill not in the path"]
            and new_keys.index(last) < new_keys.index(first) and sorted(new_keys) == sorted(keys))
    else:
        rules["5_prerequisites_validated"] = True  # nothing to order
    return rules


async def main_async():
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
    out = []
    for group, name in FILES.items():
        for profile in json.loads((HERE.parent / "career_matching" / name).read_text(encoding="utf8"))["profiles"]:
            owned = run_eval.owned_for(profile["skills"])
            results = await service.compute(owned, db, related_credit=False)
            best = results[0]
            pid = best["profession_id"]
            member = next(m for m in best["members"] if m["profession_id"] == pid)
            profession = await db["professions"].find_one({"profession_id": pid}, {"skills": 1})
            path = await structure.build(owned, pid, db)
            again = await structure.build(owned, pid, db)
            keys = [m["key"] for m in path["modules"]]
            pairs = [[keys[-1], keys[0]], [keys[0], keys[-1]], [keys[0], keys[0]], ["Nonexistent Skill X", keys[0]]] if len(keys) >= 2 else []
            with_prereq = await structure.build(owned, pid, db, prerequisites=pairs)
            rules = check(path, member, profession, again, with_prereq, pairs)
            out.append({"group": group, "id": profile["id"], "label": profile["label"], "role": path["title"],
                        "source": path["source"], "match": path["match_score"],
                        "modules": [{"skill": m["skill"], "tier": m["tier"], "quick_win": m["quick_win"]} for m in path["modules"]],
                        "more": path["more"]["count"], "rules": rules, "passed": all(rules.values())})
    client.close()
    return out


def main():
    out = asyncio.run(main_async())
    passed = sum(p["passed"] for p in out)
    rule_names = list(out[0]["rules"])
    per_rule = {r: sum(p["rules"][r] for p in out) for r in rule_names}
    (HERE / "results").mkdir(exist_ok=True)
    (HERE / "results" / "structure_eval.json").write_text(json.dumps({"profiles": out, "passed": passed, "total": len(out),
                                                                     "per_rule": per_rule}, indent=1, ensure_ascii=False), encoding="utf8")
    lines = ["# Module 6 Part 2 — learning-path structure evaluation", "",
             f"Pass mark (expectations.md): every rule holds for 24 / 24. **Result: {passed} / {len(out)} profiles pass.**", "",
             "| Rule | Profiles passing |", "|---|---|"] + [f"| {r} | {n} / {len(out)} |" for r, n in per_rule.items()] + \
            ["", "| Profile | Best match (source, %) | Modules (E/O tier, ★ quick win) | More | All rules |", "|---|---|---|---|---|"]
    for p in out:
        mods = "; ".join(f"{m['skill']} ({m['tier'][0].upper()}{', ★' if m['quick_win'] else ''})" for m in p["modules"])
        lines.append(f"| {p['label']} | {p['role']} ({p['source']}, {p['match']} %) | {mods} | {p['more']} | {'PASS' if p['passed'] else 'FAIL'} |")
    (HERE / "results" / "structure_eval.md").write_text("\n".join(lines) + "\n", encoding="utf8")
    sys.stdout.reconfigure(encoding="utf-8")
    print(f"{passed}/{len(out)} pass; per rule: {per_rule}")


if __name__ == "__main__":
    main()
