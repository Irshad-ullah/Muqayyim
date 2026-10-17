#!/usr/bin/env python
"""
Module 5.2 adoption, step 1: apply results/missing_skills_proposals.csv to the skill list, as decided by the team.

- "add alias" rows → aliases of the existing skill (16), with one exception: "Collision detection" becomes its own new
  skill ("Collision Detection"), as decided.
- "add to skill list" rows → new curated skills (26 + Collision Detection = 27; "Market Research" already existed, so
  "Market analysis" became its alias) with an 8–20-word description and a
  category (so they get vectors), plus the proposed aliases and the dataset's own spelling.
- "Container image scanning" is merged into "Container security": an alias of the new Container Security skill, and in
  the dataset the two DevSecOps requirements become one (evidence and roadmap topics combined, importance recomputed).
- "elk" moves from Elasticsearch to ELK Stack (proposal note).
- In the dataset, "Composer" → "PHP Composer" and "Combine" → "Combine Framework" (canonical names; the bare words are
  ambiguous as aliases).

Fails (and writes nothing) if an alias already resolves to a different skill. Edits app/data/skill_descriptions.json,
skill_categories.json, skill_aliases.json and data/curated/modern_roles_v1.json + review.csv.

Usage (repo root): AIServices/backend/venv/Scripts/python AIServices/eval/curated_roles/apply_skill_proposals.py
"""

import csv
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parents[1] / "backend"
sys.path.insert(0, str(BACKEND))

from app.services.embeddings import normalise as normalise_module  # noqa: E402

DATA = BACKEND / "app" / "data"
CURATED = HERE.parents[1] / "data" / "curated"

ALIASES_TO_EXISTING = {  # dataset skill → (existing canonical, aliases)
    "Amazon Web Services (AWS)": ("AWS", ["amazon web services (aws)"]),
    "Apache Hadoop": ("Hadoop", ["apache hadoop"]),
    "Google BigQuery": ("BigQuery", ["google bigquery"]),
    "Elastic Stack (ELK)": ("ELK Stack", ["elastic stack", "elastic stack (elk)", "elk"]),
    "Identity and access management (IAM)": ("Identity and Access Management", ["identity and access management (iam)", "iam"]),
    "JSON Web Token (JWT)": ("JWT", ["json web token", "json web token (jwt)", "json web tokens"]),
    "Jupyter": ("Jupyter Notebook", ["jupyter", "jupyterlab"]),
    "Search engine optimization (SEO)": ("SEO", ["search engine optimization", "search engine optimisation",
                                                 "search engine optimization (seo)"]),
    "OWASP Top 10": ("OWASP", ["owasp top 10", "owasp top ten"]),
    "Networking (TCP/IP, DNS, HTTP)": ("Networking Fundamentals", ["networking (tcp/ip, dns, http)"]),
    "Large language models (LLMs)": ("Large Language Models", ["large language models (llms)"]),
    "Retrieval-augmented generation (RAG)": ("Retrieval-Augmented Generation", ["rag", "retrieval augmented generation",
                                                                               "retrieval-augmented generation (rag)"]),
    "Room": ("Room Database", ["room", "android room", "room persistence library"]),
    "Shaders (HLSL/GLSL)": ("Shader Programming", ["shaders", "hlsl", "glsl", "shaders (hlsl/glsl)"]),
    "Linear algebra for games": ("Linear Algebra", ["linear algebra for games"]),
    "User personas": ("Personas", ["user personas"]),
    "Market analysis": ("Market Research", ["market analysis"]),  # proposed as new; the skill already exists
}

NEW_SKILLS = {  # canonical: (category, description, aliases)
    "Gradle": ("backend", "Build automation tool that compiles, tests and packages JVM and mobile app projects using scripted build files",
               ["gradle build tool"]),
    "Hilt": ("mobile", "Dependency injection library for Android apps that wires app components together at compile time",
             ["dagger hilt", "hilt dependency injection"]),
    "MVVM": ("mobile", "Model-View-ViewModel architecture pattern that separates user interface code from business logic and state",
             ["mvvm architecture", "model-view-viewmodel"]),
    "Combine Framework": ("mobile", "Apple framework for processing values over time with publishers and subscribers in reactive app code",
                          ["apple combine", "combine (swift)"]),
    "URLSession": ("mobile", "Apple networking API for making HTTP requests, downloads and uploads from apps on Apple platforms",
                   ["nsurlsession"]),
    "Swift Package Manager": ("mobile", "Apple dependency manager that fetches, builds and links code packages for app projects",
                              ["spm"]),
    "Swift Concurrency": ("mobile", "Language features for asynchronous app code using async and await, tasks and actors",
                          ["swift async/await", "swift concurrency (async/await)"]),
    "TestFlight": ("mobile", "Apple service for distributing beta builds of iPhone and iPad apps to testers before release",
                   ["apple testflight"]),
    "PHP Composer": ("backend", "Dependency manager for PHP projects that installs and updates the libraries declared in a project file",
                     ["composer (php)"]),
    "Gutenberg": ("cms-ecommerce-marketing", "Block-based content editor of WordPress, extended by developers with custom blocks for pages",
                  ["gutenberg block editor", "wordpress block editor"]),
    "WordPress Plugin Development": ("cms-ecommerce-marketing", "Building plugins with hooks and filters that add features to WordPress websites",
                                     ["wordpress plugins"]),
    "WordPress REST API": ("cms-ecommerce-marketing", "HTTP interface of WordPress for reading and writing site content from other applications",
                           ["wp rest api"]),
    "WP-CLI": ("cms-ecommerce-marketing", "Command-line tool for managing WordPress sites, plugins, users and database tasks from a terminal",
               ["wp cli"]),
    "DVC": ("ai-ml", "Data Version Control tool that versions datasets and trained models alongside code in repositories",
            ["data version control"]),
    "Kubeflow": ("ai-ml", "Platform for building, deploying and managing machine learning pipelines on container clusters",
                 ["kubeflow pipelines"]),
    "Gemini API": ("ai-ml", "Google API for calling Gemini language models to generate text, code and structured output",
                   ["google gemini api", "gemini"]),
    "LLM Evaluation": ("ai-ml", "Measuring the quality, accuracy and safety of language model outputs with test sets and metrics",
                       ["llm evals", "evaluating llms"]),
    "Container Security": ("security", "Securing container images and runtimes by scanning images for vulnerabilities and hardening deployments",
                           ["container image scanning", "image scanning"]),
    "Software Supply Chain Security": ("security", "Protecting the build and dependency chain of software with signed artifacts, provenance checks and bills of materials",
                                       ["sbom", "software bill of materials", "software supply chain security (sbom)"]),
    "Service Level Objectives": ("cloud-devops", "Reliability targets for a service, defined from service level indicators and tracked with error budgets",
                                 ["slo", "slos", "service level objectives (slos)"]),
    "Amplitude": ("data", "Product analytics platform for tracking user events, funnels and retention in web and mobile apps",
                  ["amplitude analytics"]),
    "Product Analytics": ("data", "Analysing how users adopt and use product features through event data, funnels and retention metrics",
                          []),
    "Product Requirements Documents": ("project-agile-tools", "Documents describing a product feature's goals, users, requirements and success measures for development teams",
                                       ["prd", "prds"]),
    "Prioritization Frameworks": ("project-agile-tools", "Methods such as RICE and MoSCoW for ranking product features and work by value and effort",
                                  ["rice", "moscow method", "prioritisation frameworks", "prioritization frameworks (rice, moscow)"]),
    "Game Physics": ("game-embedded-iot-blockchain", "Simulating motion, forces and rigid bodies in games so objects move and react realistically",
                     ["physics engines"]),
    "Collision Detection": ("game-embedded-iot-blockchain", "Detecting when game objects intersect or touch, using bounding volumes and spatial partitioning",
                            []),
    "Game AI": ("game-embedded-iot-blockchain", "Programming non-player character behaviour in games with pathfinding, state machines and behaviour trees",
                ["pathfinding", "behaviour trees"]),
}
DATASET_RENAMES = {"Composer": "PHP Composer", "Combine": "Combine Framework"}


def main():
    descriptions_path, categories_path, aliases_path = (DATA / "skill_descriptions.json", DATA / "skill_categories.json",
                                                        DATA / "skill_aliases.json")
    descriptions = json.loads(descriptions_path.read_text(encoding="utf8"))
    categories = json.loads(categories_path.read_text(encoding="utf8"))
    aliases = json.loads(aliases_path.read_text(encoding="utf8"))
    compact = normalise_module._compact
    owner = {}
    for canonical, forms in aliases["canonical"].items():
        for form in [canonical, *forms]:
            owner.setdefault(compact(form), canonical)
    for name in descriptions:
        if not name.startswith("_"):
            owner.setdefault(compact(name), name)

    problems = []

    def add_alias(canonical, alias):
        current = owner.get(compact(alias))
        if current not in (None, canonical):
            if canonical == "ELK Stack" and alias == "elk" and current == "Elasticsearch":
                aliases["canonical"]["Elasticsearch"] = [a for a in aliases["canonical"]["Elasticsearch"] if a != "elk"]
            else:
                problems.append(f"alias {alias!r} already belongs to {current!r} (wanted for {canonical!r})")
                return
        forms = aliases["canonical"].setdefault(canonical, [canonical.lower()] if canonical.lower() not in ("",) else [])
        if alias not in forms:
            forms.append(alias)
        owner[compact(alias)] = canonical

    for _, (canonical, forms) in ALIASES_TO_EXISTING.items():
        if canonical not in descriptions:
            problems.append(f"existing skill {canonical!r} not in the skill list")
            continue
        for alias in forms:
            add_alias(canonical, alias)
    for canonical, (category, description, forms) in NEW_SKILLS.items():
        if compact(canonical) in owner:
            problems.append(f"new skill {canonical!r} already resolves to {owner[compact(canonical)]!r}")
            continue
        descriptions[canonical] = description
        categories[canonical] = category
        owner[compact(canonical)] = canonical
        for alias in forms:
            add_alias(canonical, alias)
    if problems:
        raise SystemExit("\n".join(problems))
    from app.services.taxonomy import skills_editor  # the admin editor's writer keeps each file's layout

    skills_editor.write(descriptions, aliases, categories)

    # Dataset: renames and the Container merge.
    dataset_path = CURATED / "modern_roles_v1.json"
    data = json.loads(dataset_path.read_text(encoding="utf8"))
    for role in data["roles"]:
        for req in role["required_skills"]:
            req["any_of"] = [DATASET_RENAMES.get(s, s) for s in req["any_of"]]
            if req["skill"] in DATASET_RENAMES:
                req["skill"] = DATASET_RENAMES[req["skill"]]
        if role["id"] == "devsecops-engineer":
            reqs = role["required_skills"]
            keep = next(q for q in reqs if q["skill"] == "Container security")
            gone = next(q for q in reqs if q["skill"] == "Container image scanning")
            keep["evidence"] = sorted(set(keep["evidence"]) | set(gone["evidence"]))
            keep["roadmap_topics"] = sorted(set(keep.get("roadmap_topics", [])) | set(gone.get("roadmap_topics", [])))
            if gone.get("from_onet"):
                keep["from_onet"] = sorted(set(keep.get("from_onet", [])) | set(gone["from_onet"]))
            keep["importance"] = "essential" if len({e.split(':')[0] for e in keep["evidence"]}) >= 2 else "optional"
            keep["merged_from"] = ["Container image scanning"]
            role["required_skills"] = [q for q in reqs if q is not gone]
    data["skill_list_note"] = ("Module 5.2 adoption (2026-10-17): every any_of skill is in the Muqayyim skill list "
                               "(eval/curated_roles/apply_skill_proposals.py); 'Container image scanning' merged into "
                               "'Container security'; 'Composer' / 'Combine' renamed to 'PHP Composer' / 'Combine Framework'.")
    dataset_path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf8")
    review_path = CURATED / "review.csv"
    rows = list(csv.reader(review_path.open(encoding="utf8")))
    rows = [r for r in rows if not (r[0] == "DevSecOps Engineer" and r[1] == "Container image scanning")]
    for r in rows[1:]:
        r[1] = DATASET_RENAMES.get(r[1], r[1])
    with review_path.open("w", newline="", encoding="utf8") as handle:
        csv.writer(handle).writerows(rows)
    print(f"aliases added for {len(ALIASES_TO_EXISTING)} existing skills; {len(NEW_SKILLS)} new skills; dataset updated")


if __name__ == "__main__":
    main()
