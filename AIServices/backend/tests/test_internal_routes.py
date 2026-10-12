from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.config.settings import settings
from app.routes import internal_routes


def make_client(monkeypatch, docs):
    class Coll:
        async def find_one(self, query, sort=None):
            return docs.get(query["user_id"])

    monkeypatch.setattr(internal_routes, "get_database", lambda: {"cv_parsed_data": Coll()})
    monkeypatch.setattr(settings, "INTERNAL_API_KEY", "k-123")
    app = FastAPI()
    app.include_router(internal_routes.router)
    return TestClient(app)


def test_internal_requires_key(monkeypatch):
    client = make_client(monkeypatch, {})
    assert client.get("/internal/cv/u1/latest").status_code == 401
    assert client.get("/internal/cv/u1/latest", headers={"X-Internal-Key": "wrong"}).status_code == 403


def test_internal_latest(monkeypatch):
    client = make_client(monkeypatch, {"u1": {"parsed_data": {"skills": []}, "parsing_status": "parsed"}})
    res = client.get("/internal/cv/u1/latest", headers={"X-Internal-Key": "k-123"})
    assert res.status_code == 200
    assert res.json()["cv"]["parsing_status"] == "parsed"
    assert client.get("/internal/cv/u2/latest", headers={"X-Internal-Key": "k-123"}).status_code == 404
