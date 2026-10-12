import logging

import httpx
import pytest

from app.services import core_client
from app.config.settings import settings


@pytest.fixture
def transport(monkeypatch):
    """Route core_client's httpx traffic to a handler; record backoff sleeps."""
    state = {"calls": [], "sleeps": [], "handler": None}

    def handler(request: httpx.Request):
        state["calls"].append(request)
        return state["handler"](request)

    real_client = httpx.AsyncClient

    def fake_client(*args, **kwargs):
        kwargs["transport"] = httpx.MockTransport(handler)
        return real_client(*args, **kwargs)

    async def fake_sleep(seconds):
        state["sleeps"].append(seconds)

    monkeypatch.setattr(core_client.httpx, "AsyncClient", fake_client)
    monkeypatch.setattr(core_client.asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(settings, "INTERNAL_API_KEY", "secret-key-xyz")
    monkeypatch.setattr(settings, "CORE_SERVICE_URL", "http://core.test")
    return state


async def test_success_first_attempt(transport):
    transport["handler"] = lambda req: httpx.Response(200, json={"success": True})

    assert await core_client.notify_cv_status("u1", "parsed") is True
    assert len(transport["calls"]) == 1
    req = transport["calls"][0]
    assert req.method == "PUT"
    assert str(req.url) == "http://core.test/internal/users/u1/cv-status"
    assert req.headers["X-Internal-Key"] == "secret-key-xyz"
    assert req.content == b'{"status":"parsed"}'


async def test_retries_three_times_then_logs(transport, caplog):
    def boom(req):
        raise httpx.ConnectError("connection refused", request=req)

    transport["handler"] = boom
    with caplog.at_level(logging.ERROR, logger=core_client.__name__):
        result = await core_client.notify_cv_status("user-42", "processing")

    assert result is False
    assert len(transport["calls"]) == 3
    assert transport["sleeps"] == [0.5, 1.0]  # backoff between the 3 attempts
    messages = " ".join(r.getMessage() for r in caplog.records)
    assert "user-42" in messages and "processing" in messages
    assert "secret-key-xyz" not in messages  # key never logged


async def test_retries_on_5xx_then_succeeds(transport):
    responses = iter([httpx.Response(503), httpx.Response(200, json={})])
    transport["handler"] = lambda req: next(responses)

    assert await core_client.notify_cv_status("u1", "verified") is True
    assert len(transport["calls"]) == 2


async def test_does_not_retry_on_4xx(transport):
    transport["handler"] = lambda req: httpx.Response(404)

    assert await core_client.notify_cv_status("missing", "parsed") is False
    assert len(transport["calls"]) == 1


async def test_rejects_unknown_status_without_calling(transport):
    transport["handler"] = lambda req: httpx.Response(200)

    assert await core_client.notify_cv_status("u1", "Verified") is False
    assert transport["calls"] == []


async def test_push_keeps_order_and_does_not_block(monkeypatch):
    import asyncio

    delivered = []

    async def slow_notify(user_id, status):
        await asyncio.sleep(0.2 if status == "processing" else 0)
        delivered.append(status)
        return True

    monkeypatch.setattr(core_client, "notify_cv_status", slow_notify)
    monkeypatch.setattr(core_client, "INLINE_WAIT_SECONDS", 0.05)

    await core_client.push_cv_status("u9", "processing")  # returns after 0.05s, still running
    await core_client.push_cv_status("u9", "parsed")
    assert delivered == []  # neither finished yet; caller was not blocked
    await asyncio.sleep(0.3)
    assert delivered == ["processing", "parsed"]  # delivered in order
