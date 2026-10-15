#!/usr/bin/env python
"""
Benchmark v3 (09b2, Part 3): labelled pairs of a curated user-style skill vs an
ESCO phrase or knowledge skill, used to choose how ESCO skills are embedded.

Labels (as in benchmarks v1/v2):
  2 strongly related — essentially the same competence (Figma ↔ "design user interface")
  1 related          — connected; one supports or overlaps the other
  0 unrelated        — `hard`: technical skills from different areas (React ↔ "implement a
                       virtual private network"); `easy`: technical vs non-technical

Each pair is checked: the user skill must be a curated canonical skill, and the ESCO
label must exist in ai_db.esco_skills with a description. The ESCO description,
skill type (phrase = skill/competence, knowledge) and URI are attached.

Split: stratified by (label, negative type), 70% dev / 30% held-out, seed 42.
Review relabels (REVIEW_RELABELS) are applied after the split.
The dev set chooses the option and threshold; the held-out set only confirms.

Usage (AIServices venv, repo root):
  AIServices/backend/venv/Scripts/python AIServices/eval/embeddings_v3/build_pairs.py
Writes AIServices/eval/embeddings_v3/pairs.json. Read-only on the database.
"""

import json
import os
import random
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parents[1] / "backend"
sys.path.insert(0, str(BACKEND))
os.chdir(BACKEND)

from pymongo import MongoClient  # noqa: E402

from app.config.settings import settings  # noqa: E402

SEED = 42
DEV_SHARE = 0.7

# Label changes from the review of the sample pairs (2026-10-15). Applied AFTER the
# split so the approved dev / held-out assignment does not change.
REVIEW_RELABELS = {
    "p035": 1,  # Technical Writing vs "provide technical documentation": ESCO text is about distributing production documents
    "p057": 2,  # React vs "implement front-end website design"
}

# (user skill, ESCO label, label, negative type or None)
PAIRS = [
    # ── 2: strongly related ──────────────────────────────────────────────────
    ("Figma", "design user interface", 2, None),
    ("SQL", "use query languages", 2, None),
    ("SQL", "manage database", 2, None),
    ("PostgreSQL", "database management systems", 2, None),
    ("Selenium", "tools for ICT test automation", 2, None),
    ("Git", "tools for software configuration management", 2, None),
    ("Wireshark", "implement ICT network diagnostic tools", 2, None),
    ("Metasploit", "perform ICT security testing", 2, None),
    ("Kali Linux", "ethical hacking principles", 2, None),
    ("Penetration Testing", "identify ICT system weaknesses", 2, None),
    ("Pandas", "perform data cleansing", 2, None),
    ("Tableau", "data visualisation software", 2, None),
    ("Power BI", "deliver visual presentation of data", 2, None),
    ("Jira", "use ICT ticketing system", 2, None),
    ("Agile", "Agile project management", 2, None),
    ("AWS", "develop with cloud services", 2, None),
    ("Microsoft Azure", "deploy cloud resource", 2, None),
    ("Terraform", "automate cloud tasks", 2, None),
    ("HTML", "use markup languages", 2, None),
    ("CSS", "style sheet languages", 2, None),
    ("JavaScript", "web programming", 2, None),
    ("Python", "use scripting programming", 2, None),
    ("Bash", "use scripting programming", 2, None),
    ("Functional Programming", "use functional programming", 2, None),
    ("Object-Oriented Programming", "use object-oriented programming", 2, None),
    ("Prolog", "use logic programming", 2, None),
    ("Firewalls", "implement a firewall", 2, None),
    ("VPN", "implement a virtual private network", 2, None),
    ("Machine Learning", "utilise machine learning", 2, None),
    ("Data Mining", "perform data mining", 2, None),
    ("Statistics", "apply statistical analysis techniques", 2, None),
    ("Integration Testing", "execute integration testing", 2, None),
    ("Code Review", "conduct ICT code review", 2, None),
    ("Debugging", "debug software", 2, None),
    ("Technical Writing", "provide technical documentation", 2, None),
    ("Database Design", "design database scheme", 2, None),
    ("Data Modeling", "create data models", 2, None),
    ("Excel", "use spreadsheets software", 2, None),
    ("Microsoft PowerPoint", "use presentation software", 2, None),
    ("Disaster Recovery", "manage disaster recovery plans", 2, None),
    ("Encryption", "ICT encryption", 2, None),
    ("Blender", "operate 3D computer graphics software", 2, None),
    ("Adobe Illustrator", "design graphics", 2, None),
    ("Wireframing", "create website wireframe", 2, None),
    ("Usability Testing", "measure software usability", 2, None),
    ("Project Management", "manage ICT project", 2, None),
    ("Requirements Gathering", "analyse business requirements", 2, None),
    ("Cisco Networking", "ICT network routing", 2, None),
    ("Adobe Photoshop", "graphics editor software", 2, None),
    ("Blockchain", "blockchain platforms", 2, None),
    ("GDPR", "protect personal data and privacy", 2, None),
    # ── 1: related ───────────────────────────────────────────────────────────
    ("Figma", "create website wireframe", 1, None),
    ("Figma", "translate requirements into visual design", 1, None),
    ("SQL", "design database scheme", 1, None),
    ("Docker", "automate cloud tasks", 1, None),
    ("Kubernetes", "design cloud architecture", 1, None),
    ("React", "implement front-end website design", 1, None),
    ("React", "software frameworks", 1, None),
    ("Node.js", "web programming", 1, None),
    ("Java", "use object-oriented programming", 1, None),
    ("Python", "perform data analysis", 1, None),
    ("TensorFlow", "principles of artificial intelligence", 1, None),
    ("Computer Vision", "image recognition", 1, None),
    ("Jenkins", "tools for software configuration management", 1, None),
    ("Git", "manage changes in ICT system", 1, None),
    ("Selenium", "execute software tests", 1, None),
    ("Postman", "execute integration testing", 1, None),
    ("Jira", "ICT project management", 1, None),
    ("Scrum", "iterative development", 1, None),
    ("Agile", "incremental development", 1, None),
    ("AWS", "cloud security and compliance", 1, None),
    ("AWS", "design cloud architecture", 1, None),
    ("Terraform", "design cloud networks", 1, None),
    ("Linux", "administer ICT system", 1, None),
    ("Bash", "administer ICT system", 1, None),
    ("Wireshark", "analyse network bandwidth requirements", 1, None),
    ("Cisco Networking", "design computer network", 1, None),
    ("Firewalls", "cyber attack counter-measures", 1, None),
    ("Metasploit", "attack vectors", 1, None),
    ("Nmap", "identify ICT system weaknesses", 1, None),
    ("Tableau", "perform data analysis", 1, None),
    ("Power BI", "track key performance indicators", 1, None),
    ("Excel", "perform data analysis", 1, None),
    ("Machine Learning", "perform dimensionality reduction", 1, None),
    ("Data Mining", "information extraction", 1, None),
    ("Adobe Photoshop", "design graphics", 1, None),
    ("Unity", "create 3D environments", 1, None),
    ("Blender", "create 3D characters", 1, None),
    ("Blender", "animate 3D organic forms", 1, None),
    ("UX Design", "assess users' interaction with ICT applications", 1, None),
    ("Technical Writing", "provide user documentation", 1, None),
    ("Spring Boot", "software frameworks", 1, None),
    ("Microservices", "software architecture models", 1, None),
    ("MongoDB", "unstructured data", 1, None),
    ("Kafka", "inter-organisational middleware system", 1, None),
    ("REST APIs", "use an application-specific interface", 1, None),
    ("REST APIs", "interfacing techniques", 1, None),
    ("Swift", "mobile operating systems", 1, None),
    ("Kotlin", "mobile device software frameworks", 1, None),
    ("Solidity", "blockchain platforms", 1, None),
    ("Grafana", "cloud monitoring and reporting", 1, None),
    ("Scrum", "perform project management", 1, None),
    ("Network Security", "manage system security", 1, None),
    # ── 0: unrelated, hard (technical, different areas) ─────────────────────
    ("React", "implement a virtual private network", 0, "hard"),
    ("React", "perform data mining", 0, "hard"),
    ("Pandas", "design user interface", 0, "hard"),
    ("Figma", "use query languages", 0, "hard"),
    ("Docker", "design graphics", 0, "hard"),
    ("SQL", "create 3D characters", 0, "hard"),
    ("Kubernetes", "create website wireframe", 0, "hard"),
    ("Python", "ICT network routing", 0, "hard"),
    ("Selenium", "design cloud networks", 0, "hard"),
    ("Wireshark", "design user interface", 0, "hard"),
    ("Metasploit", "create data models", 0, "hard"),
    ("Tableau", "implement a firewall", 0, "hard"),
    ("Jira", "render 3D images", 0, "hard"),
    ("Git", "perform data mining", 0, "hard"),
    ("HTML", "ICT encryption", 0, "hard"),
    ("CSS", "perform data cleansing", 0, "hard"),
    ("Terraform", "measure software usability", 0, "hard"),
    ("Excel", "implement a virtual private network", 0, "hard"),
    ("Adobe Photoshop", "use query languages", 0, "hard"),
    ("Unity", "manage database", 0, "hard"),
    ("Swift", "ICT network routing", 0, "hard"),
    ("Kotlin", "perform data mining", 0, "hard"),
    ("Bash", "design graphics", 0, "hard"),
    ("Machine Learning", "implement a firewall", 0, "hard"),
    ("TensorFlow", "create website wireframe", 0, "hard"),
    ("Spring Boot", "operate 3D computer graphics software", 0, "hard"),
    ("MongoDB", "design user interface", 0, "hard"),
    ("AWS", "create 3D characters", 0, "hard"),
    ("Cisco Networking", "perform data analysis", 0, "hard"),
    ("Firewalls", "develop animations", 0, "hard"),
    ("Power BI", "implement a virtual private network", 0, "hard"),
    ("Node.js", "ethical hacking principles", 0, "hard"),
    ("Java", "design graphics", 0, "hard"),
    ("PostgreSQL", "create website wireframe", 0, "hard"),
    ("JavaScript", "manage disaster recovery plans", 0, "hard"),
    ("Blender", "use query languages", 0, "hard"),
    ("Scrum", "implement a firewall", 0, "hard"),
    # ── 0: unrelated, easy (technical vs non-technical) ─────────────────────
    ("React", "work safely with chemicals", 0, "easy"),
    ("Python", "follow safety procedures when working at heights", 0, "easy"),
    ("Docker", "operate an audio mixing console", 0, "easy"),
    ("SQL", "attend rehearsals", 0, "easy"),
    ("Figma", "labour legislation", 0, "easy"),
    ("Kubernetes", "edit recorded sound", 0, "easy"),
    ("Git", "set up cameras", 0, "easy"),
    ("Tableau", "prevent fire in a performance environment", 0, "easy"),
    ("Java", "use personal protection equipment", 0, "easy"),
    ("Jira", "coach staff for running the performance", 0, "easy"),
    ("AWS", "operate a camera", 0, "easy"),
    ("Selenium", "work safely with machines", 0, "easy"),
    ("Pandas", "perform soundchecks", 0, "easy"),
]


def main():
    curated = json.loads((BACKEND / "app" / "data" / "skill_descriptions.json").read_text(encoding="utf8"))
    categories = json.loads((BACKEND / "app" / "data" / "skill_categories.json").read_text(encoding="utf8"))
    client = MongoClient(settings.MONGODB_URL)
    esco = {d["label"]: d for d in client[settings.AI_DB_NAME]["esco_skills"].find(
        {"label": {"$in": [p[1] for p in PAIRS]}}, {"_id": 0, "uri": 1, "label": 1, "description": 1, "skill_type": 1})}
    client.close()

    errors, seen, rows = [], set(), []
    for i, (user, label, score, neg) in enumerate(PAIRS, 1):
        if (user, label) in seen:
            errors.append(f"duplicate pair {user!r} / {label!r}")
        seen.add((user, label))
        if user not in curated:
            errors.append(f"not a curated skill: {user!r}")
        doc = esco.get(label)
        if not doc or not (doc.get("description") or "").strip():
            errors.append(f"ESCO label missing or undescribed: {label!r}")
            continue
        if (score == 0) != (neg is not None):
            errors.append(f"negative type only for label 0: {user!r} / {label!r}")
        rows.append({
            "id": f"p{i:03d}",
            "user_skill": user,
            "user_description": curated.get(user),
            "user_category": categories.get(user),
            "esco_label": label,
            "esco_description": " ".join(doc["description"].split()),
            "esco_group": "phrase" if doc.get("skill_type") == "skill/competence" else "knowledge",
            "esco_uri": doc["uri"],
            "label": score,
            "negative": neg,
            # Sensitivity check: the ESCO DESCRIPTION names the user's skill ("such as Selenium").
            # Overlap with the label alone is not counted: it affects every option equally.
            "esco_names_user_skill": bool(re.search(r"(?<!\w)" + re.escape(user) + r"(?!\w)",
                                                    doc["description"], re.IGNORECASE)),
        })
    if errors:
        raise SystemExit("Invalid pairs:\n  " + "\n  ".join(errors))

    strata = defaultdict(list)
    for row in rows:
        strata[(row["label"], row["negative"])].append(row)
    rng = random.Random(SEED)
    for members in strata.values():
        rng.shuffle(members)
        cut = round(len(members) * DEV_SHARE)
        for j, row in enumerate(members):
            row["split"] = "dev" if j < cut else "heldout"

    for row in rows:
        if row["id"] in REVIEW_RELABELS:
            row["original_label"] = row["label"]
            row["label"] = REVIEW_RELABELS[row["id"]]

    counts = Counter((r["split"], r["label"], r["negative"]) for r in rows)
    out = {
        "version": "v3",
        "seed": SEED,
        "dev_share": DEV_SHARE,
        "review_relabels": REVIEW_RELABELS,
        "counts": {f"{s}/{l}/{n or '-'}": c for (s, l, n), c in sorted(counts.items(), key=str)},
        "esco_names_user_skill": sorted(r["id"] for r in rows if r["esco_names_user_skill"]),
        "pairs": rows,
    }
    (HERE / "pairs.json").write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n", encoding="utf8")
    print(json.dumps(out["counts"], indent=2))
    print(f"{len(rows)} pairs: " + ", ".join(f"label {k}: {v}" for k, v in sorted(Counter(r['label'] for r in rows).items())))


if __name__ == "__main__":
    main()
