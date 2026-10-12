from app.utils.mask import REDACTED, mask_deep, mask_message, mask_stack, mask_string

JWT = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiIxMjMifQ.c2lnbmF0dXJlLXNpZ25hdHVyZQ"


def test_mask_deep_redacts_sensitive_keys_at_any_depth():
    data = {
        "user": {"email": "a@b.co", "password": "hunter2", "profile": {"apiKey": "k1", "api_key": "k2"}},
        "headers": {"Authorization": "Bearer abc", "Cookie": "sid=1", "X-Internal-Key": "secret"},
        "items": [{"token": "t1"}, {"nested": [{"refresh_token": "t2", "client_secret": "s"}]}],
        "count": 3,
    }
    out = mask_deep(data)
    assert out["user"]["password"] == REDACTED
    assert out["user"]["email"] == "a@b.co"
    assert out["user"]["profile"] == {"apiKey": REDACTED, "api_key": REDACTED}
    assert out["headers"] == {"Authorization": REDACTED, "Cookie": REDACTED, "X-Internal-Key": REDACTED}
    assert out["items"][0]["token"] == REDACTED
    assert out["items"][1]["nested"][0] == {"refresh_token": REDACTED, "client_secret": REDACTED}
    assert out["count"] == 3
    assert data["user"]["password"] == "hunter2"  # original untouched


def test_jwt_and_secrets_in_messages_are_redacted():
    assert mask_string(f"bad token {JWT} here") == "bad token [REDACTED_JWT] here"
    assert "abc.def.ghi" not in mask_string("Authorization: Bearer abc.def.ghi")
    assert mask_string("mongodb://admin:S3cret!@db:27017/ai_db") == f"mongodb://admin:{REDACTED}@db:27017/ai_db"
    assert mask_string("login user=bob password=hunter2 ok") == f"login user=bob password={REDACTED} ok"


def test_truncation():
    assert len(mask_message("x" * 5000)) == 1000
    assert len(mask_stack("y" * 9000)) == 4000
    assert mask_stack(None) is None
