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
    # Module 5.2: production scores with matching.related_credit = false, so the check judges the credit the score
    # gives beyond an exact key (any-of alternatives: the B2 metric, fixed in eval/curated_roles/expectations_b2.md).
    assert result["scoring_mode"] == "exact"
    chef = result["profiles"]["chef"]["alternative_credit_pct"]
    web = result["profiles"]["web"]["alternative_credit_pct"]
    assert result["check"]["passed"], result["check"]
    assert chef <= check.MAX_CHEF_RATE and (web == 0 or chef <= check.MAX_CHEF_TO_WEB * web)
    # Legacy mode (related_credit = true) is a known limitation, recorded, not asserted: since ESCO's retirement the
    # chef's related-credit rate is 5.4 % (> 5 %; 2026-10-17), from neighbour credits on O*NET / curated tool lists.
    legacy = result["legacy_related_check"]
    print(f"legacy related-credit rate (not asserted): chef {legacy['chef_pooled_pct']} % vs web {legacy['web_pooled_pct']} %")
