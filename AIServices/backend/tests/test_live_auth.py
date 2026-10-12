import logging
import time
from datetime import datetime, timezone
from unittest.mock import AsyncMock

import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient
from jose import jwt

from app.config.settings import settings
from app.middleware.auth import get_current_user, register_auth_error_handler
from app.services import auth_state_cache, core_client
from app.services.core_client import CoreUnavailable

USER_ID = "507f1f77bcf86cd799439011"
ACTIVE = {"exists": True, "isActive": True, "role": "JobSeeker", "passwordChangedAt": None}


def token(iat_offset=-60, role="JobSeeker", secret=None):
    now = int(time.time())
    return jwt.encode(
        {"userId": USER_ID, "id": USER_ID, "role": role, "iat": now + iat_offset, "exp": now + 3600},
        secret or settings.JWT_SECRET,
        algorithm="HS256",
    )


@pytest.fixture
def env(monkeypatch):
    auth_state_cache.clear_auth_state_cache()
    clock = {"now": 1000.0}
    monkeypatch.setattr(auth_state_cache.time, "monotonic", lambda: clock["now"])
    monkeypatch.setattr(settings, "AUTH_CACHE_TTL_SECONDS", 30)
    fetch = AsyncMock(return_value=ACTIVE)
    monkeypatch.setattr(core_client, "get_auth_state", fetch)

    app = FastAPI()
    register_auth_error_handler(app)

    @app.get("/me")
    async def me(user: dict = Depends(get_current_user)):
        return user

    client = TestClient(app)

    def get(tok=None):
        headers = {"Authorization": f"Bearer {tok}"} if tok else {}
        return client.get("/me", headers=headers)

    yield {"get": get, "fetch": fetch, "clock": clock}
    auth_state_cache.clear_auth_state_cache()


def test_active_user_allowed_with_database_role(env):
    env["fetch"].return_value = {**ACTIVE, "role": "Admin"}
    res = env["get"](token(role="JobSeeker"))
    assert res.status_code == 200
    assert res.json() == {"user_id": USER_ID, "role": "Admin"}  # DB role, not the claim


def test_inactive_user_403(env):
    env["fetch"].return_value = {**ACTIVE, "isActive": False}
    res = env["get"](token())
    assert res.status_code == 403
    assert res.json()["code"] == "ACCOUNT_DEACTIVATED"
    assert res.json()["message"] == "Your account has been suspended. Contact support."


def test_unknown_user_401(env):
    env["fetch"].return_value = {"exists": False}
    res = env["get"](token())
    assert res.status_code == 401
    assert res.json()["code"] == "USER_NOT_FOUND"


def test_revoked_token_401_and_newer_token_ok(env):
    changed = datetime.fromtimestamp(time.time() - 30, tz=timezone.utc).isoformat().replace("+00:00", "Z")
    env["fetch"].return_value = {**ACTIVE, "passwordChangedAt": changed}
    old = env["get"](token(iat_offset=-60))
    assert old.status_code == 401
    assert old.json()["code"] == "TOKEN_REVOKED"
    assert env["get"](token(iat_offset=0)).status_code == 200


def test_core_down_without_cache_fails_closed(env):
    env["fetch"].side_effect = CoreUnavailable("ConnectError")
    res = env["get"](token())
    assert res.status_code == 503
    assert res.json()["code"] == "AUTH_UNAVAILABLE"


def test_core_down_with_expired_cache_under_grace_allowed_with_warning(env, caplog):
    assert env["get"](token()).status_code == 200  # cached at t=1000
    env["fetch"].side_effect = CoreUnavailable("ConnectError")
    env["clock"]["now"] += 30 + 120  # expired 2 minutes ago, within the 5-minute grace

    with caplog.at_level(logging.WARNING, logger=auth_state_cache.__name__):
        res = env["get"](token())
    assert res.status_code == 200
    assert any("expired auth state" in r.getMessage() and USER_ID in r.getMessage() for r in caplog.records)


def test_core_down_with_cache_beyond_grace_fails_closed(env):
    assert env["get"](token()).status_code == 200
    env["fetch"].side_effect = CoreUnavailable("ConnectError")
    env["clock"]["now"] += 30 + 5 * 60 + 1
    assert env["get"](token()).json()["code"] == "AUTH_UNAVAILABLE"


def test_cache_hit_avoids_second_call_within_ttl(env):
    assert env["get"](token()).status_code == 200
    env["clock"]["now"] += 29
    assert env["get"](token()).status_code == 200
    assert env["fetch"].await_count == 1
    env["clock"]["now"] += 2  # past TTL → refreshed
    assert env["get"](token()).status_code == 200
    assert env["fetch"].await_count == 2


def test_suspension_takes_effect_after_ttl(env):
    assert env["get"](token()).status_code == 200
    env["fetch"].return_value = {**ACTIVE, "isActive": False}
    env["clock"]["now"] += 10
    assert env["get"](token()).status_code == 200  # still cached
    env["clock"]["now"] += 21
    assert env["get"](token()).status_code == 403  # refreshed after TTL


def test_token_errors_have_codes(env):
    assert env["get"]().json()["code"] == "NO_TOKEN"
    assert env["get"]("not-a-jwt").json()["code"] == "TOKEN_INVALID"
    assert env["get"](token(secret="wrong-secret")).json()["code"] == "TOKEN_INVALID"
    expired = jwt.encode({"userId": USER_ID, "iat": 1, "exp": 2}, settings.JWT_SECRET, algorithm="HS256")
    assert env["get"](expired).json()["code"] == "TOKEN_EXPIRED"
    env["fetch"].assert_not_awaited()  # no Core call for bad tokens


async def test_get_auth_state_client(monkeypatch):
    import httpx

    calls = []

    def handler(request):
        calls.append(request)
        if request.url.path.endswith("/missing/auth-state"):
            return httpx.Response(404, json={"exists": False})
        if request.url.path.endswith("/broken/auth-state"):
            return httpx.Response(500)
        return httpx.Response(200, json=ACTIVE)

    real = httpx.AsyncClient
    monkeypatch.setattr(core_client.httpx, "AsyncClient", lambda *a, **k: real(*a, transport=httpx.MockTransport(handler), **k))
    monkeypatch.setattr(settings, "INTERNAL_API_KEY", "k-1")

    assert await core_client.get_auth_state("u1") == ACTIVE
    assert calls[0].headers["X-Internal-Key"] == "k-1"
    assert await core_client.get_auth_state("missing") == {"exists": False}
    with pytest.raises(CoreUnavailable):
        await core_client.get_auth_state("broken")
