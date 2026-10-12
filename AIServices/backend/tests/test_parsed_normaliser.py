"""
Stage 5 normaliser: parsed data always fits the limits the verify endpoint
enforces. Property-style: over the fixtures plus generated worst cases, every
verify error must point at a field the entry itself flags in needsReview.
"""

import random
import re

import pytest
from pydantic import ValidationError

from app.constants.profile_limits import PROFILE_LIMITS as L
from app.middleware.validation import format_validation_errors
from app.schemas.cv_schema import CVVerifyRequestSchema
from app.services.nlp_extractor import get_nlp_extractor
from app.services.verify_rules import check_verified_data
from app.utils.parsed_normaliser import normalise_parsed
from tests.cv_fixtures import SAMPLE_CV_TEXT

KEYS = ["skills", "education", "experience", "certifications", "projects"]


def verify_errors(parsed: dict) -> list:
    """Errors the verify endpoint would return for this data, unchanged."""
    try:
        request = CVVerifyRequestSchema(file_id="abc-123", verified_data=parsed)
    except ValidationError as exc:
        return format_validation_errors(exc.errors())
    return check_verified_data(request.verified_data.model_dump())[1]


def assert_only_flagged_fields_fail(parsed: dict):
    for error in verify_errors(parsed):
        m = re.match(r"verified_data\.(\w+)\[(\d+)\]\.(\w+)", error["field"])
        assert m, f"section-level error: {error}"
        section, index, field = m.group(1), int(m.group(2)), m.group(3)
        assert field in parsed[section][index]["needsReview"], error


def random_text(rng: random.Random, max_len: int) -> str:
    alphabet = "abcdefghij KLMNOP\t\x07–|,.()"
    return "".join(rng.choice(alphabet) for _ in range(rng.randint(0, max_len)))


def worst_case(seed: int) -> dict:
    rng = random.Random(seed)
    long = lambda: random_text(rng, 2500)  # noqa: E731
    dates = ["", "2020", "2020-05", "Jan 2019", "13/2020", "1900", "2099", "soon", "Present", None]
    return {
        "skills": [{"name": long()} for _ in range(rng.randint(0, 150))] + [{"name": "Python"}, {"name": "python"}],
        "experience": [
            {"title": long(), "company": long(), "location": long(), "description": long(),
             "startDate": rng.choice(dates), "endDate": rng.choice(dates), "current": rng.random() < 0.3,
             "duration": long()}
            for _ in range(rng.randint(0, 40))
        ],
        "education": [
            {"degree": long(), "institution": long(), "field": long(), "gpa": long(),
             "startDate": rng.choice(dates), "endDate": rng.choice(dates)}
            for _ in range(rng.randint(0, 20))
        ],
        "certifications": [
            {"name": long(), "issuer": long(), "date": rng.choice(dates), "url": rng.choice(["", "javascript:x", "coursera.org/verify/1", long()])}
            for _ in range(rng.randint(0, 40))
        ],
        "projects": [
            {"name": long(), "description": long(), "technologies": [long() for _ in range(rng.randint(0, 50))],
             "githubUrl": rng.choice(["", "github.com/a/b", "https://github.com/a", long()]),
             "liveUrl": rng.choice(["", "https://x.example.com", "ftp://x.com"])}
            for _ in range(rng.randint(0, 60))
        ],
    }


def test_sample_cv_output_passes_verify_except_flagged_fields():
    x = get_nlp_extractor()
    parsed = normalise_parsed({k: getattr(x, f"extract_{k}")(SAMPLE_CV_TEXT) for k in KEYS})
    assert_only_flagged_fields_fail(parsed)


@pytest.mark.parametrize("seed", range(25))
def test_worst_case_inputs_fit_the_limits(seed):
    parsed = normalise_parsed(worst_case(seed))
    assert len(parsed["skills"]) <= L["skill"]["maxTotal"]
    assert len(parsed["experience"]) <= L["maxEntries"]["experience"]
    assert len(parsed["education"]) <= L["maxEntries"]["education"]
    assert len(parsed["certifications"]) <= L["maxEntries"]["certifications"]
    assert len(parsed["projects"]) <= L["maxEntries"]["projects"]
    assert all(not re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", e["title"]) for e in parsed["experience"])
    assert_only_flagged_fields_fail(parsed)


def test_truncation_and_dropped_values_are_flagged():
    parsed = normalise_parsed({
        "experience": [{"title": "T" * 150, "company": "Acme", "startDate": "2020", "endDate": "2019"}],
        "certifications": [{"name": "Cert", "issuer": "X", "url": "javascript:alert(1)"}],
        "projects": [{"name": "P", "githubUrl": "https://github.com/onlyowner"}],
        "skills": [{"name": "React"}, {"name": "react"}, {"name": "x" * 60}],
    })
    e = parsed["experience"][0]
    assert len(e["title"]) == L["titleMax"] and "title" in e["needsReview"]
    assert e["endDate"] == "" and "endDate" in e["needsReview"]
    c = parsed["certifications"][0]
    assert c["url"] == "" and c["needsReview"] == ["url"]
    p = parsed["projects"][0]
    assert p["githubUrl"] == "" and p["needsReview"] == ["githubUrl"]
    assert [s["name"] for s in parsed["skills"]] == ["React"]


def test_entries_without_any_identifying_text_are_dropped():
    parsed = normalise_parsed({"experience": [{"title": "  ", "company": ""}], "projects": [{"name": ""}]})
    assert parsed["experience"] == [] and parsed["projects"] == []
