#!/usr/bin/env python
"""
Module 5.2 sandbox — compare setup A (production: O*NET + ESCO with the 5.1 role map) with setup B (O*NET + the 19
curated roles, ESCO off) on the old 8, the new 6 and the 10 test-CV profiles, against expectations.md.

A: the live ai_db and the persisted role-skill index, read only (as eval/career_matching/run_eval.py).
B: a SEPARATE sandbox database (SANDBOX_DB, dropped and rebuilt here; ai_db is only read) holding a copy of the live
   active O*NET professions plus the curated roles, the vector cache copied from ai_db, and a role-skill index built
   into a temporary folder. In this process only, "curated" is added to the profession sources and ESCO is left out.

Curated role → profession document: one stored skill per requirement. Its alternatives (any_of) are mapped to our skill
names with the alias table — as written, else the part before / inside a parenthesis ("Amazon Web Services (AWS)" →
AWS) — and a skill not in our list is kept as written. The first alternative is the requirement's name / key (embedded
for the related-credit fallback); a requirement with 2+ alternatives is an any-of group (the Module 5.1 mechanism:
any alternative = 1.0). importance → type essential / optional, so the required set is essential, topped up to 10 in
stored order. Everything else is the production scoring code unchanged.

Writes results/compare_setups.{json,md}. Usage (repo root):
  AIServices/backend/venv/Scripts/python AIServices/eval/curated_roles/compare_setups.py
"""

import asyncio
import json
import re
import shutil
import sys
from collections import Counter
from pathlib import Path

HERE = Path(__file__).resolve().parent
EVAL = HERE.parent
sys.path.insert(0, str(EVAL / "career_matching"))
sys.path.insert(0, str(EVAL))

import run_eval  # noqa: E402  (backend path, cwd)
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

from app.config import database as database_module  # noqa: E402
from app.config.settings import settings  # noqa: E402
from app.services.embeddings.model import get_embedder, get_manager  # noqa: E402
from app.services.embeddings.normalise import normalise_skill  # noqa: E402
from app.services.matching import scoring, service  # noqa: E402
from app.services.professions import esco_role_map, store  # noqa: E402
from app.services.professions.esco_role_map import is_group, vocabulary  # noqa: E402
from app.services.professions.role_index import RoleSkillIndex, use_role_index  # noqa: E402
from app.services.professions.role_skills import current_skill  # noqa: E402

SANDBOX_DB = "muqayyim_sandbox_m52"
DATASET = EVAL.parent / "data" / "curated" / "modern_roles_v1.json"
INDEX_DIR = HERE / "results" / "_index_b"
PAREN = re.compile(r"^(?P<base>.+?)\s*\((?P<inner>[^()]+)\)\s*$")
VAGUE = re.compile(r"^(use|apply|manage|think|communicate|work|ensure|perform|develop|create|maintain|demonstrate|show|"
                   r"adapt|cooperate|assist|support)\b", re.I)  # the dataset validator's pattern
FAMILY_CATEGORY = {"Web": "Development", "Mobile": "Development", "Cloud and Infrastructure": "Infrastructure & Cloud",
                   "Data and AI": "Data & AI", "Design and Product": "Design", "Games": "Development"}
# expectations.md: curated titles added to the O*NET part of each acceptable list in setup B
B_ADD = {"web": ["Frontend Developer", "Full-Stack Developer"], "backend": ["Backend Developer"],
         "data": ["Data Analyst", "Machine Learning Engineer", "AI Engineer (LLM Applications)"],
         "devops": ["DevOps Engineer", "Cloud Engineer", "Site Reliability Engineer"],
         "mobile": ["Android Developer", "iOS Developer", "Cross-Platform Mobile Developer"], "uiux": ["UI/UX Designer"],
         "qa": [], "cloud": ["Cloud Engineer", "DevOps Engineer", "Site Reliability Engineer"],
         "android": ["Android Developer", "Cross-Platform Mobile Developer"], "data_eng": ["Data Engineer"],
         "security": [], "gamedev": ["Game Developer"], "it_support": []}


# ── setup B data ──────────────────────────────────────────────────────────────
def resolve(skill: str, vocab: dict) -> str:
    forms = [skill]
    m = PAREN.match(skill)
    if m:
        forms += [m.group("base"), m.group("inner")]
    for form in forms:
        key = normalise_skill(form)[0]
        if key in vocab:
            return vocab[key]
    return skill


def curated_docs(vocab: dict) -> tuple:
    data = json.loads(DATASET.read_text(encoding="utf8"))
    docs, collapsed = [], []
    for role in data["roles"]:
        skills = []
        for req in role["required_skills"]:
            names = list(dict.fromkeys(resolve(s, vocab) for s in req["any_of"]))
            skill = store.make_skill(names[0], req["importance"], req["skill"])
            if len(names) > 1:
                alternatives = [{"name": n, "key": normalise_skill(n)[0]} for n in names]
                skill.update(source=esco_role_map.SOURCE, phrase=req["skill"], label=req["skill"], alternatives=alternatives)
            skills.append(skill)
        doc = store.profession_doc(profession_id=f"curated:{role['id']}", title=role["title"], alt_titles=[],
                                   description=role["description"], category=FAMILY_CATEGORY.get(role["family"], "Other"),
                                   source="curated", source_code=role["related_onet_code"],
                                   source_version=f"curated {data['version']}", skills=skills)
        if len(doc["skills"]) != len(skills):
            collapsed.append(f"{role['title']}: {len(skills)} requirements -> {len(doc['skills'])} after key de-duplication")
        docs.append(doc)
    return docs, collapsed


async def build_sandbox(live, client) -> tuple:
    sandbox = client[SANDBOX_DB]
    await client.drop_database(SANDBOX_DB)
    onet = [d async for d in live["professions"].find({"source": "onet", "active": True}, {"_id": 0})]
    vocab = vocabulary()
    curated, collapsed = curated_docs(vocab)
    await sandbox["professions"].insert_many(onet + curated)
    await store.ensure_profession_indexes(sandbox)
    batch = []
    async for vec in live["skill_vectors"].find({}, {"_id": 0}):
        batch.append(vec)
        if len(batch) >= 1000:
            await sandbox["skill_vectors"].insert_many(batch)
            batch = []
    if batch:
        await sandbox["skill_vectors"].insert_many(batch)
    from app.services.embeddings.vector_store import ensure_embedding_indexes
    await ensure_embedding_indexes(sandbox)
    return sandbox, {"onet": len(onet), "curated": len(curated), "collapsed": collapsed}


# ── scoring and measures ──────────────────────────────────────────────────────
def first_rank(results, titles):
    wanted = set(titles)
    return next((i for i, r in enumerate(results, 1) if {m["title"] for m in r["members"]} & wanted), None)


def label(source):
    return {"onet": "O*NET", "esco": "ESCO", "curated": "Curated", "manual": "Manual"}.get(source, source)


async def score_profiles(db, groups) -> dict:
    out = {}
    for group, items in groups.items():
        out[group] = []
        for p in items:
            results = await service.compute(run_eval.owned_for(p["skills"]), db)
            rank = first_rank(results, p["acceptable"])
            exp_rank = first_rank(results, p["expected"]) if p.get("expected") is not None else None
            out[group].append({
                "id": p["id"], "label": p["label"], "control": p["control"], "first_acceptable_rank": rank,
                "top3": bool(rank and rank <= 3), "top5": bool(rank and rank <= 5), "expected_rank": exp_rank,
                "best": {"title": results[0]["title"], "score": results[0]["score"]},
                "top5_list": [{"rank": i, "title": r["title"], "score": r["score"],
                               "sources": [label(s["source"]) for s in r["sources"]],
                               "acceptable": bool({m["title"] for m in r["members"]} & set(p["acceptable"]))}
                              for i, r in enumerate(results[:5], 1)],
                "results": len(results)})
    return out


async def role_counts(db, vocab) -> dict:
    by_source, counts, regex = Counter(), Counter(), Counter()
    async for prof in db["professions"].find(store.active_filter(), {"source": 1, "skills": 1, "title": 1}):
        by_source[prof["source"]] += 1
        required, _ = scoring.split_required(prof)
        seen = set()
        for skill in required:
            key, name = current_skill(skill)
            if key in seen:
                continue
            seen.add(key)
            if is_group(skill) and any(normalise_skill(a["name"])[0] in vocab for a in skill["alternatives"]):
                kind = "named (group / any-of)"
            elif key in vocab:
                kind = "named (in skill list)"
            elif prof["source"] == "esco":
                kind = "vague (ESCO phrase, no named alternative)"
            else:
                kind = "named tool, not in skill list"
            counts[(prof["source"], kind)] += 1
            if VAGUE.match(skill.get("phrase") if is_group(skill) else name):
                regex[prof["source"]] += 1
    return {"roles_by_source": dict(by_source), "roles_total": sum(by_source.values()),
            "required": {f"{s} | {k}": n for (s, k), n in sorted(counts.items())},
            "required_vague_prefix_pattern": dict(regex)}


def load_groups(setup: str) -> dict:
    cm = EVAL / "career_matching"
    old = json.loads((cm / "profiles.json").read_text(encoding="utf8"))["profiles"]
    new = json.loads((cm / "profiles_new.json").read_text(encoding="utf8"))["profiles"]
    cvs = json.loads((cm / "profiles_testcvs.json").read_text(encoding="utf8"))["profiles"]
    onet_titles = ONET_TITLES

    def legacy(p):
        acc = p.get("acceptable", [])
        if setup == "B":
            acc = [t for t in acc if t in onet_titles] + B_ADD.get(p["id"], [])
        return {"id": p["id"], "label": p["label"], "control": bool(p.get("control")), "skills": p["skills"], "acceptable": acc}

    def cv(p):
        s = setup.lower()
        return {"id": p["id"], "label": p["label"], "control": False, "skills": p["skills"],
                "acceptable": p[f"acceptable_{s}"], "expected": p[f"expected_{s}"]}

    return {"old8": [legacy(p) for p in old], "new6": [legacy(p) for p in new], "testcvs": [cv(p) for p in cvs]}


def summary(scored) -> dict:
    out = {}
    for group, items in scored.items():
        it = [p for p in items if not p["control"]]
        out[group] = {"top3": sum(p["top3"] for p in it), "top5": sum(p["top5"] for p in it), "n": len(it)}
        chef = next((p for p in items if p["control"]), None)
        if chef:
            out[group]["chef_best"] = chef["best"]
        if group == "testcvs":
            out[group]["expected_top1"] = sum(p["expected_rank"] == 1 for p in it)
            out[group]["expected_top3"] = sum(bool(p["expected_rank"] and p["expected_rank"] <= 3) for p in it)
    return out


def marks(s, bg, counts) -> dict:
    vague = sum(n for k, n in counts["required"].items() if k.split(" | ")[1].startswith("vague"))
    return {
        "old8 top-3 7/7": s["old8"]["top3"] == 7, "old8 top-5 7/7": s["old8"]["top5"] == 7,
        "chef best < 20 %": s["old8"]["chef_best"]["score"] < 20,
        "new6 top-5 >= 5/6": s["new6"]["top5"] >= 5,
        "testcvs top-3 >= 8/10": s["testcvs"]["top3"] >= 8, "testcvs top-5 >= 9/10": s["testcvs"]["top5"] >= 9,
        "background check": bool(bg["check"]["passed"]), "0 vague required skills": vague == 0,
    }


ONET_TITLES: set = set()


async def main_async():
    global ONET_TITLES
    client = AsyncIOMotorClient(settings.MONGODB_URL)
    live = client[settings.AI_DB_NAME]
    ONET_TITLES = {d["title"] async for d in live["professions"].find({"source": "onet", "active": True}, {"title": 1})}
    manager = get_manager()
    await asyncio.to_thread(manager.load_sync)
    manager.ready_event.set()
    service.user_vectors = run_eval.in_memory_vectors(get_embedder())  # read-only: no vector-cache writes
    vocab = vocabulary()
    import background_credit_rate as credit
    report = {}

    # ── A: production ──
    database_module.database = live
    index_a = RoleSkillIndex(Path(settings.ROLE_INDEX_DIR))
    if not index_a.load_files({}):
        raise SystemExit("The persisted role-skill index could not be loaded")
    use_role_index(index_a)
    scored_a = await score_profiles(live, load_groups("A"))
    counts_a = await role_counts(live, vocab)
    bg_a = await credit.run()
    report["A"] = {"scored": scored_a, "summary": summary(scored_a), "counts": counts_a, "background": bg_a["check"]}
    report["A"]["marks"] = marks(report["A"]["summary"], bg_a, counts_a)

    # ── B: O*NET + curated, ESCO off (sandbox database) ──
    sources, store_sources = settings.PROFESSION_SOURCES, store.SOURCES
    store.SOURCES = tuple(store_sources) + ("curated",)
    settings.PROFESSION_SOURCES = "onet,curated"
    try:
        sandbox, built = await build_sandbox(live, client)
        database_module.database = sandbox
        shutil.rmtree(INDEX_DIR, ignore_errors=True)
        index_b = RoleSkillIndex(INDEX_DIR)
        await index_b.rebuild(sandbox)
        use_role_index(index_b)
        scored_b = await score_profiles(sandbox, load_groups("B"))
        counts_b = await role_counts(sandbox, vocab)
        bg_b = await credit.run(db=sandbox, collection="professions", index_dir=None)
        report["B"] = {"scored": scored_b, "summary": summary(scored_b), "counts": counts_b, "background": bg_b["check"],
                       "built": built, "role_skills": index_b.snapshot.meta["count"]}
        report["B"]["marks"] = marks(report["B"]["summary"], bg_b, counts_b)
    finally:
        settings.PROFESSION_SOURCES, store.SOURCES = sources, store_sources
        database_module.database = live
        await client.drop_database(SANDBOX_DB)
        shutil.rmtree(INDEX_DIR, ignore_errors=True)
        client.close()
    return report


def markdown(report) -> str:
    L = ["# Module 5.2 — setup A (O*NET + ESCO with the map) vs B (O*NET + curated roles, ESCO off)", "",
         "Sandbox run (`compare_setups.py`); pass marks fixed beforehand in `expectations.md`. Production data unchanged; "
         "setup B ran in a separate, dropped sandbox database.", "", "## Pass marks", "", "| Mark | A | B |", "|---|---|---|"]
    for mark in report["A"]["marks"]:
        L.append(f"| {mark} | {'PASS' if report['A']['marks'][mark] else 'FAIL'} | {'PASS' if report['B']['marks'][mark] else 'FAIL'} |")
    L += ["", "| | A | B |", "|---|---|---|"]
    for group, name in (("old8", "Old 8"), ("new6", "New 6"), ("testcvs", "10 test CVs")):
        a, b = report["A"]["summary"][group], report["B"]["summary"][group]
        L.append(f"| {name}: top-3 / top-5 | {a['top3']}/{a['n']} · {a['top5']}/{a['n']} | {b['top3']}/{b['n']} · {b['top5']}/{b['n']} |")
    L.append(f"| Chef best | {report['A']['summary']['old8']['chef_best']['score']} % ({report['A']['summary']['old8']['chef_best']['title']}) | "
             f"{report['B']['summary']['old8']['chef_best']['score']} % ({report['B']['summary']['old8']['chef_best']['title']}) |")
    L.append(f"| Test CVs: expected family at #1 / in top 3 | {report['A']['summary']['testcvs']['expected_top1']} · "
             f"{report['A']['summary']['testcvs']['expected_top3']} | {report['B']['summary']['testcvs']['expected_top1']} · "
             f"{report['B']['summary']['testcvs']['expected_top3']} |")
    for s in ("A", "B"):
        bg = report[s]["background"]
        L.append(f"| Background ({s}) | chef {bg['chef_pooled_pct']} % vs web {bg['web_pooled_pct']} % | {'PASS' if bg['passed'] else 'FAIL'} |")
    L += ["", "## Roles and required skills", ""]
    for s in ("A", "B"):
        c = report[s]["counts"]
        L.append(f"**{s}:** {c['roles_total']} active roles {c['roles_by_source']}; required skills by kind:")
        L += [f"- {k}: {n}" for k, n in c["required"].items()]
        L.append(f"- required items matching the validator's vague-prefix pattern: {c['required_vague_prefix_pattern']}")
        L.append("")
    if report["B"]["built"]["collapsed"]:
        L += ["Curated requirements merged by key de-duplication in B: " + "; ".join(report["B"]["built"]["collapsed"]), ""]
    L += ["## Top 5 per profile (✓ = acceptable)", ""]
    for group, name in (("old8", "Old 8"), ("new6", "New 6 (not blind)"), ("testcvs", "10 test CVs")):
        L += [f"### {name}", "", "| Profile | Setup | First acceptable | Top 5 |", "|---|---|---|---|"]
        for pa, pb in zip(report["A"]["scored"][group], report["B"]["scored"][group]):
            for s, p in (("A", pa), ("B", pb)):
                top = "; ".join(f"{r['rank']}. {r['title']} [{'+'.join(r['sources'])}] {r['score']} %{' ✓' if r['acceptable'] else ''}"
                                for r in p["top5_list"])
                L.append(f"| {p['label']} | {s} | {p['first_acceptable_rank'] if not p['control'] else '—'} | {top} |")
        L.append("")
    return "\n".join(L) + "\n"


def main():
    report = asyncio.run(main_async())
    (HERE / "results").mkdir(exist_ok=True)
    (HERE / "results" / "compare_setups.json").write_text(json.dumps(report, indent=1, ensure_ascii=False, default=str), encoding="utf8")
    (HERE / "results" / "compare_setups.md").write_text(markdown(report), encoding="utf8")
    sys.stdout.reconfigure(encoding="utf-8")
    for s in ("A", "B"):
        print(s, json.dumps(report[s]["summary"]), report[s]["marks"])


if __name__ == "__main__":
    main()
