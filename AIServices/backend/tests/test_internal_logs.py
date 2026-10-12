from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi import FastAPI

from app.config.settings import settings
from app.routes import internal_logs_routes

from .db_fixtures import real_db  # noqa: F401 — pytest fixture

KEY = "k-logs-123"


def minutes_ago(m):
    return datetime.now(timezone.utc) - timedelta(minutes=m)


@pytest.fixture
async def client(real_db, monkeypatch):
    monkeypatch.setattr(settings, "INTERNAL_API_KEY", KEY)
    await real_db["error_logs"].insert_many([
        {"timestamp": minutes_ago(1), "level": "warning", "service": "ai", "module": "cv-parsing", "errorType": "CV_TEXT_EXTRACTION_FAILED", "message": "empty pdf", "requestId": "rid-ai-0001-abcd", "stack": "Traceback A", "acknowledged": False},
        {"timestamp": minutes_ago(2), "level": "error", "service": "ai", "module": "unhandled", "errorType": "ValueError", "message": "bad value", "stack": "Traceback B", "acknowledged": False},
        {"timestamp": minutes_ago(60 * 30), "level": "critical", "service": "ai", "module": "database", "errorType": "ServerSelectionTimeoutError", "message": "old", "acknowledged": True},
    ])
    app = FastAPI()
    app.include_router(internal_logs_routes.router)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://localhost") as c:
        yield c


H = {"X-Internal-Key": KEY}


async def test_requires_internal_key(client):
    assert (await client.get("/internal/logs/errors")).status_code == 401
    assert (await client.get("/internal/logs/errors", headers={"X-Internal-Key": "wrong"})).status_code == 403


async def test_list_newest_first_without_stacks_and_filters(client):
    body = (await client.get("/internal/logs/errors", headers=H)).json()
    assert body["total"] == 3
    assert [r["errorType"] for r in body["data"]] == ["CV_TEXT_EXTRACTION_FAILED", "ValueError", "ServerSelectionTimeoutError"]
    assert all("stack" not in r and r["id"] for r in body["data"])

    assert (await client.get("/internal/logs/errors", params={"level": "error"}, headers=H)).json()["total"] == 1
    assert (await client.get("/internal/logs/errors", params={"module": "cv-parsing"}, headers=H)).json()["total"] == 1
    assert (await client.get("/internal/logs/errors", params={"search": "rid-ai-0001"}, headers=H)).json()["total"] == 1
    assert (await client.get("/internal/logs/errors", params={"acknowledged": "false"}, headers=H)).json()["total"] == 2
    since = minutes_ago(60).isoformat()
    assert (await client.get("/internal/logs/errors", params={"from": since}, headers=H)).json()["total"] == 2
    page2 = (await client.get("/internal/logs/errors", params={"limit": 2, "page": 2}, headers=H)).json()
    assert [r["errorType"] for r in page2["data"]] == ["ServerSelectionTimeoutError"]


async def test_detail_includes_stack_and_acknowledge(client):
    first = (await client.get("/internal/logs/errors", params={"limit": 1}, headers=H)).json()["data"][0]
    detail = (await client.get(f"/internal/logs/errors/{first['id']}", headers=H)).json()["data"]
    assert detail["stack"] == "Traceback A"

    ack = await client.patch(f"/internal/logs/errors/{first['id']}/acknowledge", json={"acknowledgedBy": "admin-1"}, headers=H)
    assert ack.status_code == 200
    data = ack.json()["data"]
    assert data["acknowledged"] is True and data["acknowledgedBy"] == "admin-1" and data["acknowledgedAt"]
    assert "stack" not in data
    assert (await client.get("/internal/logs/errors/507f1f77bcf86cd799439011", headers=H)).status_code == 404
    assert (await client.get("/internal/logs/errors/not-an-id", headers=H)).status_code == 404


async def test_summary_counts_since(client):
    since = minutes_ago(24 * 60).isoformat()
    body = (await client.get("/internal/logs/summary", params={"since": since}, headers=H)).json()
    assert body["counts"] == {"warning": 1, "error": 1, "critical": 0}
