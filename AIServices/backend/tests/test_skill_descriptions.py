"""
The curated skill descriptions (app/data/skill_descriptions.json) pass
scripts/check_skill_descriptions.py, and are used ONLY as embedding text —
never as the CV parser's extraction vocabulary.
"""

import builtins
import importlib.util
import json
import pathlib
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "check_skill_descriptions.py"
SERVICES = Path(__file__).resolve().parents[1] / "app" / "services"
PARSER_SOURCES = [
    SERVICES / "nlp_extractor.py",
    SERVICES / "cv_parser.py",
    *sorted((SERVICES / "extractors").glob("*.py")),
]


def load_checker():
    spec = importlib.util.spec_from_file_location("check_skill_descriptions", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_curated_descriptions_pass_all_checks():
    report = load_checker().run_checks()
    assert report["errors"] == []
    assert 800 <= report["total"] <= 1200  # 985 (09a2) + 108 role skills (09b2)


def test_benchmark_seed_entries_are_unchanged():
    checker = load_checker()
    seed = json.loads(checker.SEED.read_text(encoding="utf8"))
    descriptions = json.loads(checker.DESCRIPTIONS.read_text(encoding="utf8"))
    assert len(seed) == 283
    assert {name: descriptions.get(name) for name in seed} == seed


# ── Embedding text only, never extraction vocabulary ─────────────────────────
def test_parser_code_never_references_the_description_file():
    for source in PARSER_SOURCES:
        assert "skill_descriptions" not in source.read_text(encoding="utf8"), source.name


def test_extractor_never_opens_the_description_file(monkeypatch):
    from app.services.nlp_extractor import NLPExtractor
    from tests.cv_fixtures import SAMPLE_CV_TEXT

    description_count = len(json.loads(load_checker().DESCRIPTIONS.read_text(encoding="utf8")))

    def guard(path):
        if "skill_descriptions" in str(path):
            raise AssertionError(f"CV extraction must not read {path}")

    real_open, real_read_text, real_path_open = builtins.open, pathlib.Path.read_text, pathlib.Path.open
    monkeypatch.setattr(builtins, "open", lambda file, *a, **k: (guard(file), real_open(file, *a, **k))[1])
    monkeypatch.setattr(pathlib.Path, "read_text", lambda self, *a, **k: (guard(self), real_read_text(self, *a, **k))[1])
    monkeypatch.setattr(pathlib.Path, "open", lambda self, *a, **k: (guard(self), real_path_open(self, *a, **k))[1])

    extractor = NLPExtractor()  # a fresh instance builds its vocabulary under the guard
    for section in ("skills", "education", "experience", "certifications", "projects"):
        getattr(extractor, f"extract_{section}")(SAMPLE_CV_TEXT)

    vocabulary = {s.lower() for s in extractor.technical_skills | extractor.soft_skills}
    assert {"linear", "sanity"}.isdisjoint(vocabulary)
    assert len(vocabulary) < description_count // 4  # the parser keeps its own short list


@pytest.mark.parametrize(
    "text",
    [
        "Skills\nLinear Regression, Sanity Testing, Python",
        "Experience\nData Analyst at Acme\n- Built linear regression models and ran sanity testing before releases",
        "linear regression, sanity testing, logistic regression",
    ],
)
def test_common_phrases_do_not_become_description_only_skills(text):
    from app.services.nlp_extractor import get_nlp_extractor

    names = {s["name"] for s in get_nlp_extractor().extract_skills(text)}
    assert not names & {"Linear", "Sanity"}
