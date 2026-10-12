import re

from fastapi.testclient import TestClient

from app.main import app

UUID_V4 = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")

# No `with` block: the lifespan (MongoDB connection) is not started.
client = TestClient(app, base_url="http://localhost")


def test_echoes_gateway_request_id():
    res = client.get("/health", headers={"X-Request-Id": "gw-req-1234-abcd"})
    assert res.status_code == 200
    assert res.headers["x-request-id"] == "gw-req-1234-abcd"


def test_generates_when_missing_or_invalid():
    assert UUID_V4.match(client.get("/health").headers["x-request-id"])
    assert UUID_V4.match(client.get("/health", headers={"X-Request-Id": "bad id!"}).headers["x-request-id"])


def test_present_on_auth_error_responses():
    res = client.get("/api/cv/latest", headers={"X-Request-Id": "gw-req-5678-efgh"})
    assert res.status_code == 401
    assert res.json()["code"] == "NO_TOKEN"
    assert res.headers["x-request-id"] == "gw-req-5678-efgh"
