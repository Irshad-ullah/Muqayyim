#!/usr/bin/env python
"""
Appends the post-run analysis to results/report.md: the options table (from results/options.json,
measured by options.py, none adopted), the failing-profile diagnosis, and the related credits the
reviewer JUDGED doubtful after reading the run's output (the known pairs are flagged by run_eval.py
itself). Run after run_eval.py and options.py.
"""

import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
RESULTS = HERE / "results"

# Judged after the run (reviewer: Claude, 2026-10-16), from every related credit behind a top-5
# result. "tool" = a different tool for a different job (clearly doubtful); "language" = another
# programming language (transferable, but not the skill itself; debatable).
JUDGED = {
    "tool": [("Git", "Jira"), ("Jira", "Git"), ("React", "Figma"), ("React", "Adobe XD"), ("Adobe XD", "React"),
             ("Webpack", "Docker"), ("Flask", "Selenium"), ("Selenium", "React"), ("Flask", "React"), ("Flask", "Angular"),
             ("Django", "Joomla"), ("Git", "Ansible"), ("Cooking", "Microsoft Word"), ("Inventory Management", "SAS"),
             ("Team Leadership", "SharePoint"), ("React", "web based collaborative platforms"),
             ("React Native", "web based collaborative platforms"), ("Flask", "web based collaborative platforms")],
    "language": [("JavaScript", "Python"), ("JavaScript", "Java"), ("JavaScript", "PHP"), ("TypeScript", "C#"),
                 ("Python", "Java"), ("Python", "Go"), ("Python", "JavaScript"), ("Flask", "JavaScript"), ("Bash", "C"),
                 ("Bash", "JavaScript"), ("Bash", "Python"), ("Linux", "Go"), ("Dart", "Angular"), ("Dart", "Go")],
}


def main():
    run = json.loads((RESULTS / "results.json").read_text(encoding="utf8"))
    options = json.loads((RESULTS / "options.json").read_text(encoding="utf8"))
    lines = ["", "## Judged doubtful credits (reviewed after the run)", "",
             "None of the known doubtful pairs (Docker → FPGA, Docker → resource-efficient technologies, React → Selenium, "
             "Docker → .NET) appears behind a top-5 result. Reading every related credit in the top 5, these were judged "
             "doubtful after the run (**tool** = a different tool for a different job; **language** = another programming "
             "language, transferable but not the skill itself):", "",
             "| Profile | Top-5 related credits | Judged doubtful: tool | Judged doubtful: language | Examples (similarity) |",
             "|---|---|---|---|---|"]
    tool, lang = set(JUDGED["tool"]), set(JUDGED["language"])
    for p in run["profiles"]:
        credits = p["related_credits_top5"]
        t = [c for c in credits if (c["via"], c["role_skill"]) in tool]
        g = [c for c in credits if (c["via"], c["role_skill"]) in lang]
        examples = sorted({f"{c['via']} → {c['role_skill']} ({c['similarity']:.2f})" for c in t + g})[:4]
        lines.append(f"| {p['id']} | {len(credits)} | {len(t)} | {len(g)} | {'; '.join(examples)} |")

    lines += ["", "## Pass mark not met — options measured, none adopted", "",
              "The pass mark fails on **top-5 = 6 / 7**: the DevOps profile's first acceptable role is at rank 6. "
              "Options (a)–(c) were measured with the production scorer patched in-process only (`options.py`); nothing was "
              "changed. The background measure is computed the way `background_credit_rate.py` defines it (its baseline "
              "reproduces the official 3.2 % / 12.9 %).", "",
              "| Option | Top-3 | Top-5 | Chef best | Background chef / web (pooled) | Credit-weighted chef / web | Background |",
              "|---|---|---|---|---|---|---|"]
    names = {"baseline": "Adopted design (baseline)", "a_esco_knowledge_only": "(a) ESCO roles on knowledge skills only",
             "b_phrase_to_tool": f"(b) ability phrases → tool names (cosine ≥ {options['notes']['b_map_threshold']})",
             "c_full_mixed_credit_0.80": "(c) full credit, mixed pair ≥ 0.80", "c_full_mixed_credit_0.85": "(c) full credit, mixed pair ≥ 0.85"}
    for key, o in options["options"].items():
        s, b = o["sanity"], o["background"]
        lines.append(f"| {names.get(key, key)} | {s['top3']} / {s['it']} | {s['top5']} / {s['it']} | {s['chef_best']['score']} % "
                     f"({s['chef_best']['title']}) | {b['chef']['pooled_pct']} % / {b['web']['pooled_pct']} % | "
                     f"{b['chef']['credit_weighted_pct']} % / {b['web']['credit_weighted_pct']} % | {'PASS' if b['passed'] else 'FAIL'} |")
    n = options["notes"]
    lines += ["", f"(a): ESCO roles have {n['a_esco_roles_knowledge_skill_counts']['min']}–{n['a_esco_roles_knowledge_skill_counts']['max']} "
              f"knowledge skills (median {n['a_esco_roles_knowledge_skill_counts']['median']}); {n['a_esco_roles_knowledge_skill_counts']['roles_below_5']} "
              f"roles have fewer than 5. (b): {n['b_phrases_mapped']} ability phrases mapped, e.g. "
              + "; ".join(f"{a} → {b} ({s})" for a, b, s in n["b_examples"][:5]) + ".", "",
              "### Why DevOps fails (all options)", "",
              "- The top-ranked role is O\\*NET **Computer Systems Engineers/Architects** (59.1 %; holds AWS, Ansible, Bash, Docker, "
              "Git, Terraform, Jenkins, Kubernetes, Linux — 9 of 22). Its O\\*NET alternative titles include Cloud Engineer, Cloud "
              "Architect and Cloud Platform Engineer, so it is a plausible match, but it was not in the expectations committed "
              "before the run (they were not changed afterwards).",
              "- O\\*NET has no DevOps occupation. ESCO **cloud DevOps engineer** ranks 7th (37.5 %): 1 held (Jenkins), **16 related** "
              "— almost all ESCO ability phrases (\"design cloud architecture\", \"deploy cloud resource\", …) credited 0.5 each "
              "from Terraform / AWS — and 7 missing. This is the **ESCO bias**: phrases can earn at most half credit.",
              "- (a) drops those phrases, (b) maps them to tools the profile does not list (e.g. Cloud Architecture), and (c) at "
              "0.80 upgrades few of them (most similarities are 0.73–0.80); none lifts an acceptable role into the top 5. "
              "(c) at 0.80 also raises the chef control to 20.0 % (ICT help desk agent), which fails the chef criterion.",
              "",
              "### Mobile (passes top-3 only through Software Developers, 23.3 %)", "",
              "- ESCO **mobile application developer** scores 5.6 % (rank 24–28 under every option): its required skills are "
              "generic programming phrases (\"computer programming\", \"debug software\", \"use software libraries\", …) with no "
              "mobile tools, and Kotlin / Swift / Flutter / Dart are not related to them above 0.73. O\\*NET has no mobile "
              "occupation. This is a **missing-skills** problem of the role list, not of the credit rule.", ""]
    with (RESULTS / "report.md").open("a", encoding="utf8") as handle:
        handle.write("\n".join(lines) + "\n")
    print("analysis appended")


if __name__ == "__main__":
    main()
