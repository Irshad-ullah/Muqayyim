from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config.settings import settings
from app.middleware.auth import get_current_user
from app.routes import cv_routes
from app.services import core_client

USER_ID = "507f1f77bcf86cd799439011"


class FakeCollection:
    def __init__(self):
        self.docs = {}

    async def update_one(self, query, update, upsert=False):
        doc = self.docs.setdefault(query["user_id"], {"user_id": query["user_id"]})
        doc.update(update.get("$set", {}))

        class Result:
            matched_count = 1

        return Result()

    async def find_one(self, query, sort=None):
        return self.docs.get(query["user_id"])


class FakeDb(dict):
    def __missing__(self, key):
        self[key] = FakeCollection()
        return self[key]


class FakeExtractor:
    def extract_skills(self, text):
        return [{"name": "Python", "confidence": 0.9}]

    def extract_education(self, text):
        return []

    def extract_experience(self, text):
        return []

    def extract_certifications(self, text):
        return []

    def extract_projects(self, text):
        return []


@pytest.fixture
def env(monkeypatch, tmp_path):
    db = FakeDb()
    notify = AsyncMock(return_value=True)
    # Routes push through core_client.push_cv_status → notify_cv_status.
    monkeypatch.setattr(core_client, "notify_cv_status", notify)
    monkeypatch.setattr(cv_routes, "get_database", lambda: db)
    monkeypatch.setattr(cv_routes, "get_nlp_extractor", lambda: FakeExtractor())
    monkeypatch.setattr(settings, "UPLOAD_DIRECTORY", str(tmp_path))

    app = FastAPI()
    app.include_router(cv_routes.router)
    app.dependency_overrides[get_current_user] = lambda: {"user_id": USER_ID, "role": "JobSeeker"}
    return {"client": TestClient(app), "notify": notify, "db": db, "dir": tmp_path}


def statuses(notify):
    assert all(call.args[0] == USER_ID for call in notify.await_args_list)
    return [call.args[1] for call in notify.await_args_list]


def test_parse_success_notifies_processing_then_parsed(env, monkeypatch):
    (env["dir"] / "abc123.pdf").write_bytes(b"%PDF-1.4 placeholder")
    monkeypatch.setattr(cv_routes, "parse_cv_file", lambda path, ext: ("Python developer", True))

    res = env["client"].post("/api/cv/parse/abc123")

    assert res.status_code == 200
    assert res.json()["parsing_status"] == "parsed"
    assert statuses(env["notify"]) == ["processing", "parsed"]
    assert env["db"]["cv_parsed_data"].docs[USER_ID]["parsing_status"] == "parsed"


def test_corrupted_file_notifies_processing_then_failed(env):
    # A stored ".pdf" whose content is not a PDF: caught by the signature check.
    (env["dir"] / "bad999.pdf").write_bytes(b"\x00\x01this is not a pdf\xff" * 20)

    res = env["client"].post("/api/cv/parse/bad999")

    assert res.status_code == 422
    assert res.json()["code"] == "INVALID_FILE_TYPE"
    assert statuses(env["notify"]) == ["processing", "failed"]
    assert env["db"]["cv_parsed_data"].docs[USER_ID]["parsing_status"] == "failed"


def test_extraction_error_notifies_failed(env, monkeypatch):
    (env["dir"] / "err1.pdf").write_bytes(b"%PDF-1.4 placeholder")

    def explode(path, ext):
        raise RuntimeError("extractor crashed")

    monkeypatch.setattr(cv_routes, "parse_cv_file", explode)
    res = env["client"].post("/api/cv/parse/err1")

    assert res.status_code == 500
    assert statuses(env["notify"]) == ["processing", "failed"]


def test_missing_file_does_not_change_status(env):
    res = env["client"].post("/api/cv/parse/doesnotexist")
    assert res.status_code == 404
    assert statuses(env["notify"]) == []


def test_upload_notifies_uploaded(env):
    res = env["client"].post(
        "/api/cv/upload",
        files={"file": ("cv.pdf", b"%PDF-1.4 small file", "application/pdf")},
    )
    assert res.status_code == 200
    assert statuses(env["notify"]) == ["uploaded"]


def test_verify_notifies_verified(env):
    env["db"]["cv_parsed_data"].docs[USER_ID] = {"user_id": USER_ID, "parsing_status": "parsed"}
    res = env["client"].put(
        "/api/cv/verify",
        json={"file_id": "abc123", "verified_data": {"skills": [{"name": "Python"}]}},
    )
    assert res.status_code == 200
    assert statuses(env["notify"]) == ["verified"]
    assert env["db"]["cv_parsed_data"].docs[USER_ID]["parsing_status"] == "verified"


def test_latest_returns_users_record(env):
    env["db"]["cv_parsed_data"].docs[USER_ID] = {
        "user_id": USER_ID,
        "parsing_status": "parsed",
        "parsed_data": {"skills": [{"name": "Go"}], "education": [], "experience": [], "projects": []},
    }
    body = env["client"].get("/api/cv/latest").json()
    assert body["status"] == "parsed"
    assert body["cvData"]["skills"][0]["name"] == "Go"


def test_latest_without_record_returns_null(env):
    body = env["client"].get("/api/cv/latest").json()
    assert body == {"success": True, "cvData": None, "status": None, "uploadDate": None}
