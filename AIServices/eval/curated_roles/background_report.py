#!/usr/bin/env python
"""
Module 5.2 — background diagnosis report: applies background_labels.json to results/background_pairs.json
(from diagnose_background.py) and writes results/background_diagnosis.md. A credited row (one role skill of one role)
is "real overlap" when any of its qualifying pairs is labelled real overlap, otherwise "false match". Shares are of the
credited rows, i.e. of the pooled related-credit rate (rate = credited rows ÷ non-exact rows).

Usage (repo root): AIServices/backend/venv/Scripts/python AIServices/eval/curated_roles/background_report.py
"""

import json
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
PROFILE_SKILLS = {"chef": "Cooking, Customer Service, Inventory Management", "web": "React, Python, Docker, Figma"}


def main():
    data = json.loads((HERE / "results" / "background_pairs.json").read_text(encoding="utf8"))
    labels = json.loads((HERE / "background_labels.json").read_text(encoding="utf8"))
    real = {(u, r) for u, roles in labels["real_overlap"].items() for r in roles}

    def row_label(credit):
        return "real overlap" if any((p["user_skill"], credit["role_skill"]) in real for p in credit["pairs"]) else "false match"

    L = ["# Module 5.2 — background-check diagnosis (report only)", "",
         "Where the background check's related credit comes from, pair by pair (`diagnose_background.py`, reproducing "
         "`eval/background_credit_rate.py` exactly: same embeddings, threshold 0.73, mutual-NN for described role skills). "
         "Nothing was tuned or changed. Labels: `background_labels.json` (assistant's judgement; real overlap = the profile "
         "genuinely has the role skill; anything else = false match).", "",
         "**How the rate is counted:**", "",
         "- rows = every stored skill of every active role, not only the required set;",
         "- a row whose key equals a profile skill is an exact match (1.0) and is left out of the rate (the chef has none in "
         "either setup);",
         "- a row is credited (related, 0.5) when a profile skill reaches similarity ≥ 0.73 (described role skill: also "
         "mutual top-10 neighbours; undescribed ESCO phrase: threshold only, \"mixed\").", "",
         "**Rate = credited rows ÷ non-exact rows.** It is not the match % of any role.", ""]
    summary_rows = []
    for setup, name in (("B", "O*NET + curated (ESCO off)"), ("A", "production: O*NET + ESCO with the map")):
        for profile in ("chef", "web"):
            d = data[setup][profile]
            counts, by_skill, by_source = Counter(), defaultdict(Counter), defaultdict(Counter)
            for role in d["roles"]:
                for c in role["related"]:
                    lab = row_label(c)
                    counts[lab] += 1
                    by_skill[c["pairs"][0]["user_skill"]][lab] += 1
                    by_source[role["source"]][lab] += 1
            total = d["credited_rows"]
            real_n, false_n = counts["real overlap"], counts["false match"]
            share = lambda n: f"{100 * n / total:.0f} %" if total else "—"  # noqa: E731
            pts = lambda n: f"{100 * n / d['total_rows']:.1f}" if d["total_rows"] else "0"  # noqa: E731
            summary_rows.append(f"| {setup} | {profile} | {d['pooled_related_pct']} % ({total}/{d['total_rows']}) | "
                                f"{real_n} rows = {share(real_n)} ({pts(real_n)} pts) | {false_n} rows = {share(false_n)} ({pts(false_n)} pts) |")
            if profile == "web":
                L += [f"### {setup} — web profile ({PROFILE_SKILLS['web']}): {d['pooled_related_pct']} %", "",
                      f"{total} credited rows of {d['total_rows']}: real overlap {real_n} ({share(real_n)}), false match "
                      f"{false_n} ({share(false_n)}). By web skill: "
                      + "; ".join(f"{k} {v['real overlap']} real / {v['false match']} false" for k, v in sorted(by_skill.items()))
                      + ". The false matches are mostly neighbouring tools of the same family (React → TypeScript / "
                        "Angular / ASP.NET Core / Tomcat, Python → Java / R / Ruby / Go, Docker → Linux / Ansible / "
                        "Kubernetes, Figma → Adobe InDesign / Illustrator / AutoCAD) and ESCO phrases (A).", ""]
                continue
            L += [f"## {setup} — {name}: chef ({PROFILE_SKILLS['chef']}) {d['pooled_related_pct']} %", "",
                  f"{total} credited rows of {d['total_rows']} non-exact rows; exact matches: "
                  f"{sum(len(r['exact']) for r in d['roles'])}.", "",
                  f"- **Real overlap:** {real_n} rows = **{share(real_n)}** of the credit ({pts(real_n)} of the "
                  f"{d['pooled_related_pct']} points)",
                  f"- **False match:** {false_n} rows = **{share(false_n)}** ({pts(false_n)} points)",
                  "- By chef skill: " + "; ".join(f"{k}: {v['real overlap']} real / {v['false match']} false"
                                                   for k, v in sorted(by_skill.items())),
                  "- By role source: " + "; ".join(f"{k}: {sum(v.values())} rows ({v['real overlap']} real / {v['false match']} false)"
                                                    for k, v in sorted(by_source.items())), ""]
            if setup == "B":
                L += ["| Role | Source | Credit type | Role rate (credited / rows) | Pairs (chef skill → role skill, similarity, kind) | Label |",
                      "|---|---|---|---|---|---|"]
                for role in sorted(d["roles"], key=lambda r: (-r["role_rate_pct"], r["role"])):
                    for i, c in enumerate(role["related"]):
                        pairs = "; ".join(f"{p['user_skill']} → {c['role_skill']} {p['similarity']} ({p['kind']})" for p in c["pairs"])
                        head = (f"| {role['role']} | {role['source']} | related 0.5 | {role['role_rate_pct']} % "
                                f"({len(role['related'])}/{role['rows']})") if i == 0 else "| | | related 0.5 | "
                        L.append(f"{head} | {pairs} | {row_label(c)} |")
                L.append("")
            else:
                pair_counts = Counter()
                for role in d["roles"]:
                    for c in role["related"]:
                        p = c["pairs"][0]
                        pair_counts[(p["user_skill"], c["role_skill"], p["similarity"], p["kind"], row_label(c), role["source"])] += 1
                L += ["Production is summarised per pair (rows = roles where it credits):", "",
                      "| Chef skill → role skill | Similarity | Kind | Source | Rows | Label |", "|---|---|---|---|---|---|"]
                for (u, r, s, k, lab, src), n in sorted(pair_counts.items(), key=lambda kv: (-kv[1], kv[0])):
                    L.append(f"| {u} → {r} | {s} | {k} | {src} | {n} | {lab} |")
                L.append("")
    L[L.index("**How the rate is counted:**"):L.index("**How the rate is counted:**")] = [
        "## Summary", "", "| Setup | Profile | Rate | Real overlap | False match |", "|---|---|---|---|---|", *summary_rows, ""]
    (HERE / "results" / "background_diagnosis.md").write_text("\n".join(L) + "\n", encoding="utf8")
    print("\n".join(summary_rows))


if __name__ == "__main__":
    main()
