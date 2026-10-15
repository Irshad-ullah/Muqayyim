"""
Background credit rate regression check (09b2), run with `pytest -m slow`.

Needs the real model and the imported professions in ai_db (not ai_db_test): it
reads the live profession database and role-skill index, writes nothing. Must be
run for any future threshold or matching change (Module 5's evaluation included).
"""

import importlib.util
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "eval" / "background_credit_rate.py"


def load_check():
    spec = importlib.util.spec_from_file_location("background_credit_rate", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.mark.slow
async def test_unrelated_profile_gets_little_background_credit():
    check = load_check()
    try:
        result = await check.run()
    except check.CheckUnavailable as exc:  # no professions imported on this machine
        pytest.skip(str(exc))
    chef = result["profiles"]["chef"]["pooled_related_pct"]
    web = result["profiles"]["web"]["pooled_related_pct"]
    assert result["check"]["passed"], result["check"]
    assert chef <= check.MAX_CHEF_RATE and chef <= check.MAX_CHEF_TO_WEB * web
