"""
PUT /api/cv/verify: Pydantic limits match CoreServices, and validation errors
use the standard shape { success, code: VALIDATION_ERROR, message, errors[] }.
"""

from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.middleware.auth import get_current_user
from app.middleware.validation import field_path, register_validation_error_handler
from app.routes import cv_routes
from app.services import core_client

USER_ID = "507f1f77bcf86cd799439011"


class FakeCollection:
    def __init__(self):
        self.saved = None

    async def update_one(self, query, update, upsert=False):
        self.saved = update.get("$set")

        class Result:
            matched_count = 1

        return Result()


@pytest.fixture
def env(monkeypatch):
    collection = FakeCollection()
    monkeypatch.setattr(core_client, "notify_cv_status", AsyncMock(return_value=True))
    monkeypatch.setattr(cv_routes, "get_database", lambda: {"cv_parsed_data": collection})
    app = FastAPI()
    register_validation_error_handler(app)
    app.include_router(cv_routes.router)
    app.dependency_overrides[get_current_user] = lambda: {"user_id": USER_ID, "role": "JobSeeker"}
    return {"client": TestClient(app), "collection": collection}


def verify(env, data, file_id="3f2b9c1e-aaaa-bbbb-cccc-0123456789ab"):
    return env["client"].put("/api/cv/verify", json={"file_id": file_id, "verified_data": data})


def test_valid_data_is_cleaned_and_saved(env):
    res = verify(env, {
        "skills": [{"name": "  Python\u0007 "}],
        "experience": [{"title": " Engineer ", "company": "Acme", "duration": "2019 - 2021", "startDate": "Jan 2019", "endDate": "2021"}],
        "projects": [{"name": "P", "description": "line 1\r\nline 2", "technologies": ["", " Go "]}],
    })
    assert res.status_code == 200
    saved = env["collection"].saved["parsed_data"]
    assert saved["skills"][0]["name"] == "Python"
    assert saved["experience"][0]["title"] == "Engineer"
    assert saved["projects"][0] == {"name": "P", "description": "line 1\nline 2", "technologies": ["Go"], "githubUrl": "", "liveUrl": ""}


def test_limits_violations_use_the_standard_shape(env):
    res = verify(env, {
        "skills": [{"name": "x" * 51}],
        "education": [{"degree": "", "institution": "i" * 151}],
        "experience": [{"title": "ok", "company": "ok"}, {"title": "t" * 101, "company": "c"}],
        "projects": [{"name": "p", "description": "d" * 1001, "technologies": ["y" * 51]}],
    })
    assert res.status_code == 422
    body = res.json()
    assert body["success"] is False and body["code"] == "VALIDATION_ERROR"
    assert isinstance(body["message"], str) and body["message"]
    fields = {e["field"] for e in body["errors"]}
    assert {
        "verified_data.skills[0].name",
        "verified_data.education[0].degree",
        "verified_data.education[0].institution",
        "verified_data.experience[1].title",
        "verified_data.projects[0].description",
        "verified_data.projects[0].technologies[0]",
    } <= fields
    # Submitted values are never echoed back.
    assert "t" * 101 not in res.text and "input" not in body["errors"][0]
    assert env["collection"].saved is None


def test_entry_counts_are_limited(env):
    res = verify(env, {"experience": [{"title": "t", "company": "c"}] * 31, "skills": [{"name": f"s{i}"} for i in range(101)]})
    assert res.status_code == 422
    fields = {e["field"] for e in res.json()["errors"]}
    assert {"verified_data.experience", "verified_data.skills"} <= fields


def test_wrong_types_and_missing_fields(env):
    res = verify(env, {"experience": "not-a-list"})
    assert res.status_code == 422
    assert res.json()["errors"][0]["field"] == "verified_data.experience"
    res = env["client"].put("/api/cv/verify", json={"verified_data": {}})
    assert res.status_code == 422
    assert res.json()["errors"][0]["field"] == "file_id"


def test_file_id_must_be_an_id(env):
    res = verify(env, {}, file_id="../../etc/passwd")
    assert res.status_code == 422
    assert res.json()["errors"][0]["field"] == "file_id"


def test_invalid_json_is_400(env):
    res = env["client"].put("/api/cv/verify", content=b'{"file_id": ', headers={"Content-Type": "application/json"})
    assert res.status_code == 400
    assert res.json()["code"] == "INVALID_JSON"


def test_field_path_format():
    assert field_path(("body", "verified_data", "experience", 1, "title")) == "verified_data.experience[1].title"
    assert field_path(("body",)) == "body"
    assert field_path(("query", "page")) == "page"
