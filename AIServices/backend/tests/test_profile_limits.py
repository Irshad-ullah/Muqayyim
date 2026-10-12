"""
Limits parity: app/constants/profile_limits.py must equal CoreServices'
backend/validation/profileLimits.json (the single source of truth).
"""

import json
from pathlib import Path

import pytest

from app.constants.profile_limits import PROFILE_LIMITS

CORE_LIMITS = Path(__file__).resolve().parents[3] / "CoreServices" / "backend" / "validation" / "profileLimits.json"


@pytest.mark.skipif(not CORE_LIMITS.exists(), reason="CoreServices is not checked out next to AIServices")
def test_limits_match_core_services():
    core = json.loads(CORE_LIMITS.read_text(encoding="utf8"))
    assert PROFILE_LIMITS == core
