"""Shared in-memory setup for CV route tests (fake DB, fake Core, real parser)."""

from unittest.mock import AsyncMock

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config.settings import settings
from app.middleware.auth import get_current_user
from app.middleware.validation import register_validation_error_handler
from app.routes import cv_routes
from app.services import core_client

USER_ID = "507f1f77bcf86cd799439011"


class FakeCollection:
    def __init__(self):
        self.docs = {}

    async def update_one(self, query, update, upsert=False):
        doc = self.docs.setdefault(query["user_id"], {"user_id": query["user_id"]})
        doc.update(update.get("$set", {}))
        if upsert:
            for key, value in update.get("$setOnInsert", {}).items():
                doc.setdefault(key, value)

        class Result:
            matched_count = 1

        return Result()

    async def find_one(self, query, sort=None):
        return self.docs.get(query["user_id"])


class FakeDb(dict):
    def __missing__(self, key):
        self[key] = FakeCollection()
        return self[key]


def make_env(monkeypatch, tmp_path):
    db = FakeDb()
    notify = AsyncMock(return_value=True)
    monkeypatch.setattr(core_client, "notify_cv_status", notify)
    monkeypatch.setattr(cv_routes, "get_database", lambda: db)
    monkeypatch.setattr(settings, "UPLOAD_DIRECTORY", str(tmp_path))
    app = FastAPI()
    register_validation_error_handler(app)
    app.include_router(cv_routes.router)
    app.dependency_overrides[get_current_user] = lambda: {"user_id": USER_ID, "role": "JobSeeker"}
    return {"client": TestClient(app), "notify": notify, "db": db, "dir": tmp_path}


def statuses(notify):
    return [call.args[1] for call in notify.await_args_list]


def record(env):
    return env["db"]["cv_parsed_data"].docs.get(USER_ID, {})


def upload(env, name: str, data: bytes, mime: str = "application/octet-stream"):
    return env["client"].post("/api/cv/upload", files={"file": (name, data, mime)})


def upload_and_parse(env, name: str, data: bytes):
    res = upload(env, name, data)
    assert res.status_code == 200, res.text
    return env["client"].post(f"/api/cv/parse/{res.json()['file_id']}")
