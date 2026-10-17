#!/usr/bin/env python
"""
Module 5.2 — variant B2 (no related credit) vs B, sandbox only (expectations_b2.md, committed first).

Same data as B (compare_setups.build_sandbox: O*NET + curated roles in a separate, dropped sandbox database).
- B:  production scoring (exact / alias / any-of 1.0, related 0.5).
- B2: score_profession is called with an EMPTY related map (so only exact / alias / any-of credit 1.0 counts); the
      related pairs that production would have credited (same model, same FAISS index, same 0.73 / mutual-NN rule) are
      attached to each role as `related_hints` (missing rows only) and never counted.

Background (expectations_b2.md): B = the existing related-credit rate (diagnose_background.pairs_for, checked equal to
background_credit_rate.profile_rates); B2 = non-exact rows credited through an any-of alternative ÷ non-exact rows,
plus the related-hint rate and the all-credited share for information. Labels: background_labels.json.

Writes results/b2_compare.{json,md}. Usage (repo root):
  AIServices/backend/venv/Scripts/python AIServices/eval/curated_roles/compare_b2.py
"""

import asyncio
import json
import statistics
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import compare_setups as cs  # noqa: E402
import diagnose_background as diag  # noqa: E402
from motor.motor_asyncio import AsyncIOMotorClient  # noqa: E402

import background_credit_rate as bcr  # noqa: E402
from app.config import database as database_module  # noqa: E402
from app.config.settings import settings  # noqa: E402
from app.services.embeddings.matching_config import get_related_threshold  # noqa: E402
from app.services.embeddings.model import get_embedder, get_manager  # noqa: E402
from app.services.embeddings.normalise import normalise_skill  # noqa: E402
from app.services.matching import scoring, service  # noqa: E402
from app.services.professions import store  # noqa: E402
from app.services.professions.esco_role_map import alternative_keys, is_group, vocabulary  # noqa: E402
from app.services.professions.role_index import RoleSkillIndex, use_role_index  # noqa: E402
from app.services.professions.role_skills import current_skill  # noqa: E402

ORIGINAL = scoring.score_profession
CAPTURE = {}  # profile id → full B2 results (for hints and the Java spread)


def b2_score(profession, owned, related, current):
    """No related credit; related pairs kept as display-only hints on missing rows."""
    result = ORIGINAL(profession, owned, {}, current)
    hints = []
    for row in result["required"] + result["optional"]:
        pair = related.get(row["key"])
        if row["status"] == scoring.MISSING and pair:
            via = owned.get(pair["user_key"], {"name": pair["user_key"]})["name"]
            hints.append({"role_skill": row["name"], "via": via, "similarity": round(float(pair["similarity"]), 3),
                          "kind": pair["kind"], "required": row in result["required"]})
    result["related_hints"] = hints
    return result


async def score(db, groups, keep_full=False, related_credit=True):
    # Since Module 5.2 production compute() has the mode built in (related_credit; hints when off).
    out = {}
    for group, items in groups.items():
        out[group] = []
        for p in items:
            results = await service.compute(cs.run_eval.owned_for(p["skills"]), db, related_credit)
            if keep_full:
                CAPTURE[p["id"]] = results
            rank = cs.first_rank(results, p["acceptable"])
            expected = cs.first_rank(results, p["expected"]) if p.get("expected") is not None else None
            out[group].append({"id": p["id"], "label": p["label"], "control": p["control"], "first_acceptable_rank": rank,
                               "expected_rank": expected,
                               "top3": bool(rank and rank <= 3), "top5": bool(rank and rank <= 5),
                               "best": {"title": results[0]["title"], "score": results[0]["score"]},
                               "top5_list": [{"rank": i, "title": r["title"], "score": r["score"],
                                              "sources": [cs.label(s["source"]) for s in r["sources"]],
                                              "acceptable": bool({m["title"] for m in r["members"]} & set(p["acceptable"]))}
                                             for i, r in enumerate(results[:5], 1)],
                               "scores": [(r["title"], r["source"], r["score"]) for r in results]})
    return out


async def background_b2(db, snapshot, labels_real):
    """any-of credit beyond an exact key (rows as in background_credit_rate), labelled; plus all-credited share."""
    professions = [p async for p in db["professions"].find(store.active_filter(), {"title": 1, "skills": 1, "source": 1})]
    position = set(snapshot.keys)
    out = {}
    for name in ("chef", "web"):
        owned = {normalise_skill(n)[0]: n for n in bcr.PROFILES[name]}
        rows = credited = exact = 0
        pairs = []
        for prof in professions:
            seen = {}
            for skill in prof.get("skills") or []:
                key = current_skill(skill)[0]
                if key in position:
                    seen.setdefault(key, skill)
            for key, skill in seen.items():
                if key in owned:
                    exact += 1
                    continue
                rows += 1
                held = [k for k in alternative_keys(skill) if k in owned] if is_group(skill) else []
                if held:
                    credited += 1
                    pairs.append({"role": prof["title"], "role_skill": skill.get("label") or skill["name"],
                                  "via": owned[held[0]], "label": "real overlap (holds the alternative)"})
        out[name] = {"credited_rows": credited, "total_rows": rows, "exact_rows": exact,
                     "rate_pct": round(100 * credited / rows, 1) if rows else 0.0,
                     "all_credited_share_pct": round(100 * (credited + exact) / (rows + exact), 1) if rows + exact else 0.0,
                     "pairs": pairs}
    return out


def split(diagnosis, labels_real):
    out = {}
    for name in ("chef", "web"):
        d = diagnosis[name]
        real = sum(1 for role in d["roles"] for c in role["related"]
                   if any((p["user_skill"], c["role_skill"]) in labels_real for p in c["pairs"]))
        out[name] = {"rate_pct": d["pooled_related_pct"], "credited_rows": d["credited_rows"], "total_rows": d["total_rows"],
                     "real": real, "false": d["credited_rows"] - real}
    return out


def marks(summary, bg, vague, variant):
    chef, web = bg["chef"]["rate_pct"], bg["web"]["rate_pct"]
    ratio_ok = (chef <= 0.5 * web) if web > 0 else None
    background = chef <= 5 and (ratio_ok if ratio_ok is not None else True)
    return {"old8 top-3 7/7": summary["old8"]["top3"] == 7, "old8 top-5 7/7": summary["old8"]["top5"] == 7,
            "chef best < 20 %": summary["old8"]["chef_best"]["score"] < 20, "new6 top-5 >= 5/6": summary["new6"]["top5"] >= 5,
            "testcvs top-3 >= 8/10 (not blind)": summary["testcvs"]["top3"] >= 8,
            "testcvs top-5 >= 9/10 (not blind)": summary["testcvs"]["top5"] >= 9,
            "background chef <= 5 % and <= 0.5 x web" + (" (ratio n/a: web 0)" if ratio_ok is None else ""): background,
            "0 vague required skills": vague == 0}


async def main_async():
    client = AsyncIOMotorClient(settings.MONGODB_URL)
    live = client[settings.AI_DB_NAME]
    cs.ONET_TITLES = {d["title"] async for d in live["professions"].find({"source": "onet", "active": True}, {"title": 1})}
    manager = get_manager()
    await asyncio.to_thread(manager.load_sync)
    manager.ready_event.set()
    service.user_vectors = cs.run_eval.in_memory_vectors(get_embedder())
    labels = json.loads((HERE / "background_labels.json").read_text(encoding="utf8"))
    labels_real = {(u, r) for u, roles in labels["real_overlap"].items() for r in roles}
    vocab = vocabulary()
    report = {}
    sources, store_sources = settings.PROFESSION_SOURCES, store.SOURCES
    store.SOURCES = tuple(store_sources) + ("curated",)
    settings.PROFESSION_SOURCES = "onet,curated"
    try:
        sandbox, built = await cs.build_sandbox(live, client)
        database_module.database = sandbox
        index = RoleSkillIndex(directory=None, collection="professions")
        await index.rebuild(sandbox, persist=False)
        use_role_index(index)
        groups = cs.load_groups("B")
        counts = await cs.role_counts(sandbox, vocab)
        vague = sum(n for k, n in counts["required"].items() if k.split(" | ")[1].startswith("vague"))
        diagnosis = await diag.diagnose(sandbox, index.snapshot)

        b = await score(sandbox, groups, related_credit=True)
        b2 = await score(sandbox, groups, keep_full=True, related_credit=False)

        bg_b = split(diagnosis, labels_real)
        bg_b2 = await background_b2(sandbox, index.snapshot, labels_real)
        for name in ("chef", "web"):
            bg_b2[name]["related_hint_rate_pct"] = diagnosis[name]["pooled_related_pct"]
        report["B"] = {"scored": b, "summary": cs.summary(b), "background": bg_b}
        report["B2"] = {"scored": b2, "summary": cs.summary(b2), "background": bg_b2}
        report["B"]["marks"] = marks(report["B"]["summary"], bg_b, vague, "B")
        report["B2"]["marks"] = marks(report["B2"]["summary"], bg_b2, vague, "B2")
        report["vague_required"] = vague
        report["roles"] = counts["roles_by_source"]

        def hints(pid, n=3, required_first=True):
            out = []
            for r in CAPTURE[pid][:10]:
                for m in r["members"]:
                    for h in m.get("related_hints", []):
                        out.append({"role": m["title"], **h})
            out.sort(key=lambda h: (not h["required"], -h["similarity"]))
            return out[:n], len(out)

        report["hints"] = {"web": hints("web"), "cv05_android": hints("cv05_android")}
    finally:
        scoring.score_profession = ORIGINAL
        settings.PROFESSION_SOURCES, store.SOURCES = sources, store_sources
        database_module.database = live
        await client.drop_database(cs.SANDBOX_DB)
        client.close()
    return report


def rank_changes(report):
    first = top5_pos = 0
    rows = []
    for group in ("old8", "new6", "testcvs"):
        for pb, pb2 in zip(report["B"]["scored"][group], report["B2"]["scored"][group]):
            changed = sum(a["title"] != c["title"] for a, c in zip(pb["top5_list"], pb2["top5_list"]))
            top5_pos += changed
            if pb["first_acceptable_rank"] != pb2["first_acceptable_rank"]:
                first += 1
                rows.append(f"{pb['label']}: {pb['first_acceptable_rank']} → {pb2['first_acceptable_rank']}")
    return first, top5_pos, rows


def java_spread(report):
    out = {}
    for v in ("B", "B2"):
        p = next(x for x in report[v]["scored"]["testcvs"] if x["id"] == "cv02_backend_java")
        scores = [s for _, _, s in p["scores"]]
        curated = sorted(((t, s) for t, src, s in p["scores"] if src == "curated"), key=lambda x: -x[1])
        out[v] = {"top": p["scores"][:8], "ge50": sum(s >= 50 for s in scores), "ge40": sum(s >= 40 for s in scores),
                  "median": statistics.median(scores), "curated": curated}
    return out


def markdown(report) -> str:
    first, top5_pos, changed = rank_changes(report)
    spread = java_spread(report)
    L = ["# Module 5.2 — variant B2 (no related credit) vs B", "",
         "Sandbox only (`compare_b2.py`; marks fixed beforehand in `expectations_b2.md`). Same data as B: O\\*NET + 19 curated "
         f"roles, ESCO off ({report['roles']}). B2 counts only exact / alias / any-of credit; related pairs are display-only "
         "`related_hints`. **The 10 test CVs are not blind.**", "", "## Pass marks", "", "| Mark | B | B2 |", "|---|---|---|"]
    for mb, mb2 in zip(report["B"]["marks"].items(), report["B2"]["marks"].items()):
        L.append(f"| {mb2[0]} | {'PASS' if mb[1] else 'FAIL'} | {'PASS' if mb2[1] else 'FAIL'} |")
    L += ["", "| | B | B2 |", "|---|---|---|"]
    for group, name in (("old8", "Old 8"), ("new6", "New 6 (not blind)"), ("testcvs", "10 test CVs (not blind)")):
        a, b = report["B"]["summary"][group], report["B2"]["summary"][group]
        L.append(f"| {name}: top-3 · top-5 | {a['top3']}/{a['n']} · {a['top5']}/{a['n']} | {b['top3']}/{b['n']} · {b['top5']}/{b['n']} |")
    L.append(f"| Chef best | {report['B']['summary']['old8']['chef_best']['score']} % ({report['B']['summary']['old8']['chef_best']['title']}) | "
             f"{report['B2']['summary']['old8']['chef_best']['score']} % ({report['B2']['summary']['old8']['chef_best']['title']}) |")
    L.append(f"| Test CVs: expected family #1 · top 3 | {report['B']['summary']['testcvs']['expected_top1']} · "
             f"{report['B']['summary']['testcvs']['expected_top3']} | {report['B2']['summary']['testcvs']['expected_top1']} · "
             f"{report['B2']['summary']['testcvs']['expected_top3']} |")
    L += ["", f"**Rank changes B → B2:** first acceptable rank changed for **{first}** of 24 profiles"
          + (f" ({'; '.join(changed)})" if changed else "") + f"; **{top5_pos}** of 120 top-5 positions hold a different role.", "",
          "## Background", "", "| Variant | Profile | Rate | Real / false | Other figures |", "|---|---|---|---|---|"]
    for name in ("chef", "web"):
        b = report["B"]["background"][name]
        L.append(f"| B (related credit) | {name} | {b['rate_pct']} % ({b['credited_rows']}/{b['total_rows']}) | {b['real']} real / {b['false']} false | |")
    for name in ("chef", "web"):
        b = report["B2"]["background"][name]
        L.append(f"| B2 (any-of beyond exact) | {name} | {b['rate_pct']} % ({b['credited_rows']}/{b['total_rows']}) | "
                 f"{b['credited_rows']} real / 0 false | related-hint rate {b['related_hint_rate_pct']} % (not counted); "
                 f"all credited incl. exact {b['all_credited_share_pct']} % ({b['exact_rows']} exact rows) |")
    web_pairs = report["B2"]["background"]["web"]["pairs"]
    if web_pairs:
        L += ["", "B2 web any-of credits: " + "; ".join(f"{p['role']}: {p['via']} → {p['role_skill']}" for p in web_pairs[:8])]
    L += ["", "## The Java backend CV (test CV 02) spread", "", "| | B | B2 |", "|---|---|---|",
          f"| Roles ≥ 50 % / ≥ 40 % | {spread['B']['ge50']} / {spread['B']['ge40']} | {spread['B2']['ge50']} / {spread['B2']['ge40']} |",
          f"| Median over all 49 roles | {spread['B']['median']} % | {spread['B2']['median']} % |",
          "| Top 8 | " + "; ".join(f"{t} {s} %" for t, _, s in spread["B"]["top"]) + " | "
          + "; ".join(f"{t} {s} %" for t, _, s in spread["B2"]["top"]) + " |",
          "| Curated roles | " + "; ".join(f"{t} {s}" for t, s in spread["B"]["curated"]) + " | "
          + "; ".join(f"{t} {s}" for t, s in spread["B2"]["curated"]) + " |", "",
          "## related_hints examples (B2, display only)", ""]
    for key, name in (("web", "Web profile (old 8)"), ("cv05_android", "Android CV (test CV 05)")):
        shown, total = report["hints"][key]
        L.append(f"**{name}** ({total} hints in its top 10):")
        L += [f"- {h['role']}: *{h['role_skill']}* — close to your {h.get('via') or h.get('skill')} (similarity {h['similarity']}, {h['kind']}"
              f"{', required' if h['required'] else ', optional'})" for h in shown]
        L.append("")
    L += ["## Top 5 per profile", "", "| Profile | Variant | First acceptable | Top 5 (✓ acceptable) |", "|---|---|---|---|"]
    for group in ("old8", "new6", "testcvs"):
        for pb, pb2 in zip(report["B"]["scored"][group], report["B2"]["scored"][group]):
            for v, p in (("B", pb), ("B2", pb2)):
                top = "; ".join(f"{r['rank']}. {r['title']} [{'+'.join(r['sources'])}] {r['score']} %{' ✓' if r['acceptable'] else ''}"
                                for r in p["top5_list"])
                L.append(f"| {p['label']}{' (not blind)' if group == 'testcvs' else ''} | {v} | "
                         f"{p['first_acceptable_rank'] if not p['control'] else '—'} | {top} |")
    return "\n".join(L) + "\n"


def main():
    report = asyncio.run(main_async())
    (HERE / "results" / "b2_compare.md").write_text(markdown(report), encoding="utf8")
    slim = {k: v for k, v in report.items()}
    for v in ("B", "B2"):
        for group in slim[v]["scored"].values():
            for p in group:
                p["scores"] = p["scores"][:15]
    (HERE / "results" / "b2_compare.json").write_text(json.dumps(slim, indent=1, ensure_ascii=False, default=str), encoding="utf8")
    sys.stdout.reconfigure(encoding="utf-8")
    for v in ("B", "B2"):
        print(v, json.dumps(report[v]["summary"]), report[v]["marks"])


if __name__ == "__main__":
    main()
