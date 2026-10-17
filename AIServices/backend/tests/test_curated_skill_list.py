"""Module 5.2: the skill-list additions for the curated roles — every any_of skill of the curated dataset is in the skill
list, the 27 new skills have a description and a category (so they get vectors), the 17 aliases resolve to the existing
skills, the Container merge and Collision Detection as its own skill."""

import json
from pathlib import Path

import pytest

from app.services.embeddings.normalise import normalise_skill
from app.services.professions.esco_role_map import vocabulary

DATA = Path(__file__).resolve().parents[1] / "app" / "data"
DATASET = Path(__file__).resolve().parents[2] / "data" / "curated" / "modern_roles_v1.json"
NEW = ["Gradle", "Hilt", "MVVM", "Combine Framework", "URLSession", "Swift Package Manager", "Swift Concurrency", "TestFlight",
       "PHP Composer", "Gutenberg", "WordPress Plugin Development", "WordPress REST API", "WP-CLI", "DVC", "Kubeflow",
       "Gemini API", "LLM Evaluation", "Container Security", "Software Supply Chain Security", "Service Level Objectives",
       "Amplitude", "Product Analytics", "Product Requirements Documents", "Prioritization Frameworks", "Game Physics",
       "Collision Detection", "Game AI"]


def test_every_curated_any_of_skill_is_in_the_skill_list():
    vocab = vocabulary()
    data = json.loads(DATASET.read_text(encoding="utf8"))
    missing = [s for r in data["roles"] for q in r["required_skills"] for s in q["any_of"] if normalise_skill(s)[0] not in vocab]
    assert missing == []


def test_new_skills_have_descriptions_and_categories():
    descriptions = json.loads((DATA / "skill_descriptions.json").read_text(encoding="utf8"))
    categories = json.loads((DATA / "skill_categories.json").read_text(encoding="utf8"))
    assert len(NEW) == 27
    for name in NEW:
        assert 8 <= len(descriptions[name].split()) <= 20, name
        assert categories[name], name


@pytest.mark.parametrize("alias, canonical", [
    ("Amazon Web Services (AWS)", "AWS"), ("Apache Hadoop", "Hadoop"), ("Google BigQuery", "BigQuery"),
    ("Elastic Stack (ELK)", "ELK Stack"), ("ELK", "ELK Stack"), ("Identity and access management (IAM)", "Identity and Access Management"),
    ("JSON Web Token (JWT)", "JWT"), ("Jupyter", "Jupyter Notebook"), ("Search engine optimization (SEO)", "SEO"),
    ("OWASP Top 10", "OWASP"), ("Networking (TCP/IP, DNS, HTTP)", "Networking Fundamentals"),
    ("Large language models (LLMs)", "Large Language Models"), ("Retrieval-augmented generation (RAG)", "Retrieval-Augmented Generation"),
    ("Room", "Room Database"), ("Shaders (HLSL/GLSL)", "Shader Programming"), ("Linear algebra for games", "Linear Algebra"),
    ("User personas", "Personas"), ("Market analysis", "Market Research"),
    ("Container image scanning", "Container Security"), ("MVVM architecture", "MVVM"),
])
def test_aliases_resolve(alias, canonical):
    assert normalise_skill(alias)[1] == canonical


def test_collision_detection_is_its_own_skill_and_the_container_requirements_merged():
    vocab = vocabulary()
    assert vocab[normalise_skill("Collision detection")[0]] == "Collision Detection"
    assert normalise_skill("Collision Detection")[0] != normalise_skill("Game Physics")[0]
    data = json.loads(DATASET.read_text(encoding="utf8"))
    devsecops = next(r for r in data["roles"] if r["id"] == "devsecops-engineer")
    names = [q["skill"] for q in devsecops["required_skills"]]
    assert "Container security" in names and "Container image scanning" not in names
