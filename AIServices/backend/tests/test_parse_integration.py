"""
Upload → parse → GET /api/cv/latest → verify, end to end inside AIServices
(fake DB and Core). The stored result is already in the profile's shape;
after the user fills the needsReview fields, verify succeeds.
"""

import pytest

from tests.cv_fixtures import SAMPLE_CV_LINES, make_docx, make_pdf
from tests.parse_env import make_env, record, statuses, upload_and_parse


@pytest.fixture
def env(monkeypatch, tmp_path):
    return make_env(monkeypatch, tmp_path)


@pytest.mark.parametrize("name, builder", [("cv.pdf", make_pdf), ("cv.docx", make_docx)], ids=["pdf", "docx"])
def test_upload_parse_latest_verify(env, name, builder):
    res = upload_and_parse(env, name, builder(SAMPLE_CV_LINES))
    assert res.status_code == 200, res.text
    assert statuses(env["notify"]) == ["uploaded", "processing", "parsed"]
    file_id = res.json()["file_id"]

    latest = env["client"].get("/api/cv/latest").json()
    assert latest["status"] == "parsed"
    data = latest["cvData"]
    assert data == record(env)["parsed_data"]
    assert {c["name"] for c in data["certifications"]} >= {"AWS Certified Cloud Practitioner", "Meta Front-End Developer"}

    # Verifying unchanged data fails only on the fields flagged for review.
    first = env["client"].put("/api/cv/verify", json={"file_id": file_id, "verified_data": data})
    assert first.status_code == 422
    flagged = {
        f"verified_data.{section}[{i}].{field}"
        for section in ("experience", "education", "certifications", "projects")
        for i, entry in enumerate(data[section])
        for field in entry["needsReview"]
    }
    assert {e["field"] for e in first.json()["errors"]} <= flagged

    # The user fills them in (what the review screen enforces) → verified.
    intern = next(e for e in data["experience"] if e["title"] == "Web Development Intern")
    intern.update(startDate="2019-06", endDate="2019-08")
    ml = next(c for c in data["certifications"] if c["name"] == "Machine Learning Specialization")
    ml["issuer"] = "Coursera"
    done = env["client"].put("/api/cv/verify", json={"file_id": file_id, "verified_data": data})
    assert done.status_code == 200, done.text
    assert record(env)["parsing_status"] == "verified"
    stored = record(env)["parsed_data"]
    assert "needsReview" not in stored["experience"][0]
    assert stored["experience"][0]["startDate"] == "2022-01" and stored["experience"][0]["current"] is True
