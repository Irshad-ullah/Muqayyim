"""
Limits parity: app/constants/profile_limits.py must equal CoreServices'
backend/validation/profileLimits.json (the single source of truth).
"""

import json
from pathlib import Path

import pytest

from app.constants.profile_limits import PROFILE_LIMITS
from app.utils.limits_fit import fit_parsed_to_limits

CORE_LIMITS = Path(__file__).resolve().parents[3] / "CoreServices" / "backend" / "validation" / "profileLimits.json"


@pytest.mark.skipif(not CORE_LIMITS.exists(), reason="CoreServices is not checked out next to AIServices")
def test_limits_match_core_services():
    core = json.loads(CORE_LIMITS.read_text(encoding="utf8"))
    assert PROFILE_LIMITS == core


def test_fit_parsed_to_limits_cuts_text_and_lists():
    skills = [{"name": " Python "}, {"name": "python"}, {"name": "x" * 51}] + [{"name": f"s{i}"} for i in range(150)]
    education = [{"degree": "d" * 120, "institution": "i" * 200, "year": "2019 - 2023 (exp.)"}] * 20
    experience = [{"title": "t" * 300, "company": "c" * 300, "duration": "x" * 150}] * 40
    projects = [{"name": "p" * 150, "description": "d" * 2000, "technologies": ["Go", "go", "", "y" * 60] + [f"t{i}" for i in range(40)]}] * 60

    s, ed, ex, pr = fit_parsed_to_limits(skills, education, experience, projects)
    assert s[0]["name"] == "Python" and len(s) == 100 and all(len(x["name"]) <= 50 for x in s)
    assert len(ed) == 15 and len(ed[0]["degree"]) == 100 and len(ed[0]["institution"]) == 150 and len(ed[0]["year"]) <= 10
    assert len(ex) == 30 and len(ex[0]["title"]) == 100 and len(ex[0]["company"]) == 150
    assert len(pr) == 50 and len(pr[0]["name"]) == 100 and len(pr[0]["description"]) == 1000
    assert pr[0]["technologies"][:2] == ["Go", "t0"] and len(pr[0]["technologies"]) == 30
