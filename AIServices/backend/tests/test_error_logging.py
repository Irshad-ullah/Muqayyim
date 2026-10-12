import logging
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI
from pymongo.errors import ServerSelectionTimeoutError

from app.config.database import ensure_log_indexes, ensure_ttl_index
from app.config.settings import settings
from app.main import app as main_app
from app.middleware.auth import get_current_user
from app.routes import cv_routes
from app.services import core_client, error_logger

from .db_fixtures import flush_logs, real_db  # noqa: F401 — pytest fixture

JWT = "eyJhbGciOiJIUzI1NiJ9.eyJ1c2VySWQiOiIxIn0.c2lnbmF0dXJlLXNpZ24"


@pytest.fixture
def boom_routes():
    """Temporarily add throwing routes to the real app (real middleware + handlers)."""

    async def boom():
        raise ZeroDivisionError(f"division by zero near token {JWT}")

    async def db_down():
        raise ServerSelectionTimeoutError("localhost:27017: connection refused")

    main_app.add_api_route("/__test/boom", boom)
    main_app.add_api_route("/__test/db-down", db_down)
    yield
    main_app.router.routes = [r for r in main_app.router.routes if not getattr(r, "path", "").startswith("/__test/")]


def client_for(app):
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app, raise_app_exceptions=False), base_url="http://localhost")


async def test_unhandled_exception_returns_clean_500_and_is_logged(real_db, boom_routes, monkeypatch):
    monkeypatch.setattr(core_client, "send_alert", AsyncMock(return_value=True))
    async with client_for(main_app) as client:
        res = await client.get("/__test/boom?secret=1", headers={"X-Request-Id": "ai-boom-0001-abcd"})

    assert res.status_code == 500
    assert res.json() == {
        "success": False,
        "code": "INTERNAL_ERROR",
        "message": "Something went wrong. Reference: ai-boom-0001-abcd",
        "requestId": "ai-boom-0001-abcd",
    }
    assert res.headers["x-request-id"] == "ai-boom-0001-abcd"
    assert "Traceback" not in res.text and "ZeroDivision" not in res.text

    await flush_logs()
    entry = await real_db["error_logs"].find_one({"requestId": "ai-boom-0001-abcd"})
    assert entry is not None
    assert entry["level"] == "error"
    assert entry["service"] == "ai"
    assert entry["module"] == "unhandled"
    assert entry["errorType"] == "ZeroDivisionError"
    assert entry["method"] == "GET"
    assert entry["path"] == "/__test/boom"
    assert entry["statusCode"] == 500
    assert entry["acknowledged"] is False
    assert "Traceback" in entry["stack"]
    assert "[REDACTED_JWT]" in entry["message"] and JWT not in entry["message"]
    core_client.send_alert.assert_not_awaited()


async def test_database_error_is_critical_and_requests_an_alert(real_db, boom_routes, monkeypatch):
    alert = AsyncMock(return_value=True)
    monkeypatch.setattr(core_client, "send_alert", alert)
    async with client_for(main_app) as client:
        res = await client.get("/__test/db-down", headers={"X-Request-Id": "ai-crit-0001-abcd"})
    assert res.status_code == 500
    await flush_logs()
    entry = await real_db["error_logs"].find_one({"requestId": "ai-crit-0001-abcd"})
    assert entry["level"] == "critical"
    alert.assert_awaited_once()
    assert alert.await_args.args[0]["errorType"] == "ServerSelectionTimeoutError"


async def test_log_write_failure_falls_back_to_console(boom_routes, monkeypatch, caplog):
    class BrokenDb(dict):
        def __missing__(self, key):
            class Coll:
                async def insert_one(self, doc):
                    raise RuntimeError("disk full")

            return Coll()

    from app.config import database as database_module

    monkeypatch.setattr(database_module, "database", BrokenDb())
    with caplog.at_level(logging.ERROR, logger=error_logger.__name__):
        async with client_for(main_app) as client:
            res = await client.get("/__test/boom", headers={"X-Request-Id": "ai-boom-0002-abcd"})
        await flush_logs()
    assert res.status_code == 500
    assert any("write-failed" in r.getMessage() and "ai-boom-0002-abcd" in r.getMessage() for r in caplog.records)


async def test_corrupted_cv_is_logged_as_a_warning(real_db, monkeypatch, tmp_path):
    monkeypatch.setattr(core_client, "notify_cv_status", AsyncMock(return_value=True))
    monkeypatch.setattr(settings, "UPLOAD_DIRECTORY", str(tmp_path))
    (tmp_path / "bad42.pdf").write_bytes(b"\x00\x01not a pdf\xff" * 20)

    app = FastAPI()
    app.include_router(cv_routes.router)
    app.dependency_overrides[get_current_user] = lambda: {"user_id": "507f1f77bcf86cd799439011", "role": "JobSeeker"}
    async with client_for(app) as client:
        res = await client.post("/api/cv/parse/bad42")
    assert res.status_code == 422

    await flush_logs()
    entry = await real_db["error_logs"].find_one({"module": "cv-parsing"})
    assert entry["level"] == "warning"
    assert entry["service"] == "ai"
    assert entry["errorType"] == "CV_TEXT_EXTRACTION_FAILED"
    assert entry["statusCode"] == 422
    assert "bad42" in entry["message"]


async def test_cv_status_sync_failure_is_a_warning(real_db, monkeypatch):
    def boom(req):
        raise httpx.ConnectError("refused", request=req)

    real = httpx.AsyncClient
    monkeypatch.setattr(core_client.httpx, "AsyncClient", lambda *a, **k: real(*a, transport=httpx.MockTransport(boom), **k))
    monkeypatch.setattr(core_client.asyncio, "sleep", AsyncMock())

    assert await core_client.notify_cv_status("507f1f77bcf86cd799439011", "parsed") is False
    await flush_logs()
    entry = await real_db["error_logs"].find_one({"errorType": "CV_STATUS_SYNC_FAILED"})
    assert entry["level"] == "warning" and entry["module"] == "internal-client"
    assert entry["userId"] == "507f1f77bcf86cd799439011"


async def test_core_unavailable_for_auth_state_logs_one_warning_per_minute(real_db, monkeypatch):
    def boom(req):
        raise httpx.ConnectError("refused", request=req)

    real = httpx.AsyncClient
    monkeypatch.setattr(core_client.httpx, "AsyncClient", lambda *a, **k: real(*a, transport=httpx.MockTransport(boom), **k))
    for _ in range(5):
        with pytest.raises(core_client.CoreUnavailable):
            await core_client.get_auth_state("u1")
    await flush_logs()
    assert await real_db["error_logs"].count_documents({"errorType": "CORE_UNAVAILABLE", "level": "warning"}) == 1


async def test_ttl_index_uses_configured_retention(real_db, monkeypatch):
    monkeypatch.setattr(settings, "LOG_RETENTION_DAYS", 30)
    await ensure_log_indexes(real_db)
    info = await real_db["error_logs"].index_information()
    assert info["timestamp_ttl"]["expireAfterSeconds"] == 30 * 86400
    assert info["timestamp_ttl"]["key"] == [("timestamp", 1)]
    assert "service_1_level_1_timestamp_-1" in info

    await ensure_ttl_index(real_db, "error_logs", 7)
    info = await real_db["error_logs"].index_information()
    assert info["timestamp_ttl"]["expireAfterSeconds"] == 7 * 86400
