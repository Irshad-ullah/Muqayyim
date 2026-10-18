"""Module 6 Part 3: learning-path enrichment with the fake LLM provider — what is sent (role, module skills, skill
names, preferences only), 0 URLs from the model (any URL → invalid output after the corrective retry), module set =
path set, hours and platform bounds, links built by our code, labels, the free-only filter, prerequisite reordering,
the cache following the preferences, "suggest another resource", and the internal routes."""

import json
from datetime import datetime, timezone

import httpx
import pytest
from fastapi import FastAPI

from app.config.settings import settings
from app.services.learning import enrich
from app.services.llm import client as llm_client
from app.services.llm.client import LLMClient
from app.services.llm.errors import LLMInvalidOutput
from app.services.llm.providers.fake import FakeProvider
from tests.db_fixtures import real_db  # noqa: F401 — pytest fixture

MODULES = [{"key": "javascript", "skill": "JavaScript"}, {"key": "react", "skill": "React"}]


def rec(title="React Course for Beginners", platform="YouTube", free=True, instructor="freeCodeCamp"):
    return {"platform": platform, "title": title, "instructor": instructor, "description": "A full course.",
            "free": free}


def module(skill, hours=(10, 20), recs=None, **over):
    body = {"skill": skill, "why": f"{skill} is used every day in this role.", "subtopics": ["Basics", "Practice", "Testing"],
            "project": f"Build a small app with {skill}.", "hours_min": hours[0], "hours_max": hours[1],
            "recommendations": recs or [rec(), rec("The Official Tutorial", "Official docs", instructor="")]}
    body.update(over)
    return body


def answer(modules=None, prerequisites=None):
    return json.dumps({"modules": modules if modules is not None else [module("JavaScript"), module("React")],
                       "prerequisites": prerequisites or []})


def request(**over):
    body = {"role_title": "Frontend Developer", "modules": MODULES, "user_skills": ["HTML", "CSS"],
            "preferences": {"cost": "free", "hours_per_week": 6}}
    body.update(over)
    return enrich.EnrichRequest.model_validate(body)


@pytest.fixture
async def fake(real_db, monkeypatch):  # noqa: F811
    for name, value in {"LLM_RPM": 100, "LLM_TPM": 10_000_000, "LLM_RPD": 1000, "LLM_USER_DAILY_QUOTA": 50}.items():
        monkeypatch.setattr(settings, name, value)
    await llm_client.ensure_llm_indexes(real_db)
    provider = FakeProvider()
    llm_client.use_llm_client(LLMClient(provider, db=real_db, clock=lambda: datetime(2026, 10, 18, 12, 0, tzinfo=timezone.utc)))
    return provider


async def test_enrichment_with_links_built_by_our_code(fake):
    fake.push(answer(prerequisites=[["JavaScript", "React"]]))
    out = await enrich.enrich(request(), "u1")
    assert [m["skill"] for m in out["modules"]] == ["JavaScript", "React"] and out["order"] == ["javascript", "react"]
    first = out["modules"][0]
    assert first["hours"] == {"min": 10, "max": 20, "label": "estimated"} and len(first["subtopics"]) == 3
    yt = first["recommendations"][0]
    assert yt["search_url"] == "https://www.youtube.com/results?search_query=React+Course+for+Beginners+freeCodeCamp"
    assert yt["search_label"] == "Find on YouTube" and yt["label"] == "AI recommendation"
    assert first["recommendations"][1]["search_url"].startswith("https://duckduckgo.com/?q=JavaScript+The+Official+Tutorial")
    assert out["total_hours"] == {"min": 20, "max": 40, "label": "estimated"}
    assert out["prerequisites"]["accepted"] == [["javascript", "react"]]
    assert out["usage"]["prompt"] == "learning_path@v2"


async def test_only_role_modules_skill_names_and_preferences_are_sent(fake):
    fake.push(answer())
    await enrich.enrich(request(user_skills=["HTML", "Ayesha Raza", "CSS"]), "u1")
    sent = fake.sent_text
    for kept in ("Frontend Developer", '"JavaScript"', '"React"', '"CSS"', "Recommend English-language resources only",
                 "Recommend only free resources"):
        assert kept in sent, kept
    assert "<<<DATA modules>>>" in sent and "<<<DATA known_skills>>>" in sent and "<<<DATA role>>>" in sent


@pytest.mark.parametrize("bad, reason", [
    (answer([module("JavaScript", why="Read https://react.dev first."), module("React")]), "url_found"),    # URL in text
    (answer([module("JavaScript", recs=[rec(title="Visit www.example.com"), rec()]), module("React")]), "url_found"),
    (answer([module("JavaScript", recs=[rec(instructor="freecodecamp.org"), rec()]), module("React")]), "url_found"),
    (answer([module("JavaScript", hours=(1, 20)), module("React")]), "hours_out_of_range"),                 # below 2 h
    (answer([module("JavaScript", hours=(10, 90)), module("React")]), "hours_out_of_range"),                # above 80 h
    (answer([module("JavaScript", hours=(20, 10)), module("React")]), "hours_out_of_range"),                # min > max
    (answer([module(s, hours=(30, 80)) for s in ("JavaScript", "React", "a", "b", "c", "d")]), "module_set_mismatch"),
    (answer([module("JavaScript", recs=[rec(platform="Pluralsight"), rec()]), module("React")]), "schema"),  # not allowed
    (answer([module("JavaScript")]), "module_set_mismatch"),                                                 # dropped
    (answer([module("JavaScript"), module("React"), module("Docker")]), "module_set_mismatch"),              # added
    (answer([module("JavaScript"), module("Vue.js")]), "module_set_mismatch"),                               # renamed
    (answer([module("JavaScript"), module("JavaScript")]), "module_set_mismatch"),                           # repeated
    ("Here is your path!", "not_json"),
])
async def test_invalid_outputs_never_reach_a_path(fake, real_db, caplog, bad, reason):  # noqa: F811
    fake.push(bad)
    fake.push(bad)  # the corrective retry gets the same answer
    with caplog.at_level("WARNING", logger="app.services.llm.client"), pytest.raises(LLMInvalidOutput):
        await enrich.enrich(request(), "u1")
    record = await real_db["llm_usage"].find_one({"feature": "learning_path", "status": "invalid_output"}, sort=[("_id", -1)])
    assert reason in record["reject_reason"] and record["attempts"] == 2
    logged = [r.getMessage() for r in caplog.records if "rejected" in r.getMessage()]
    assert len(logged) == 2 and all(f"checks=" in m and reason in m for m in logged)
    for content in ("react.dev", "example.com", "Pluralsight", "Docker", "Here is your path"):  # names only, no content
        assert not any(content in m for m in logged)


async def test_total_hours_over_400_and_a_rejection_replaced_by_the_retry(fake, real_db):  # noqa: F811
    many = [{"key": k, "skill": k.title()} for k in ("javascript", "react", "a", "b", "c", "d")]
    over = answer([module(m["skill"], hours=(30, 80)) for m in many])  # 6 × 80 = 480 h
    fake.push(over)
    fake.push(over)
    with pytest.raises(LLMInvalidOutput):
        await enrich.enrich(request(modules=many), "u1")
    record = await real_db["llm_usage"].find_one({"status": "invalid_output"}, sort=[("_id", -1)])
    assert record["reject_reason"] == ["hours_out_of_range"]
    fake.push(answer([module("JavaScript")]))  # a module dropped, then a valid answer
    fake.push(answer())
    out = await enrich.enrich(request(user_skills=["Git"]), "u1")
    assert [m["skill"] for m in out["modules"]] == ["JavaScript", "React"]
    ok = await real_db["llm_usage"].find_one({"status": "ok"}, sort=[("_id", -1)])
    assert ok["attempts"] == 2 and ok["reject_reason"] == ["module_set_mismatch"]
    fake.push(answer())
    await enrich.enrich(request(user_skills=["Docker"]), "u1")
    clean = await real_db["llm_usage"].find_one({"status": "ok"}, sort=[("_id", -1)])
    assert "reject_reason" not in clean


async def test_free_only_drops_paid_and_paid_is_labelled(fake):
    mixed = [rec("Paid Bootcamp", "Udemy", free=False, instructor="Jane Teacher"), rec()]
    fake.push(answer([module("JavaScript", recs=mixed), module("React")]))
    free_only = await enrich.enrich(request(), "u1")
    assert [r["title"] for r in free_only["modules"][0]["recommendations"]] == ["React Course for Beginners"]
    fake.push(answer([module("JavaScript", recs=mixed), module("React")]))
    paid_ok = await enrich.enrich(request(preferences={"cost": "include_paid", "hours_per_week": 4}), "u1")
    paid = paid_ok["modules"][0]["recommendations"][0]
    assert paid["label"] == "AI recommendation, check before buying" and paid["search_label"] == "Find on Udemy"
    assert "Recommend English-language resources only" in fake.sent_text


async def test_the_cache_key_includes_the_preferences(fake):
    fake.push(answer())
    first = await enrich.enrich(request(), "u1")
    again = await enrich.enrich(request(), "u1")  # same preferences → cache, no provider call
    assert again["usage"]["cached"] is True and len(fake.requests) == 1
    fake.push(answer())
    other = await enrich.enrich(request(preferences={"cost": "include_paid", "hours_per_week": 6}), "u1")
    assert other["usage"]["cached"] is False and len(fake.requests) == 2 and first["modules"] == again["modules"]


async def test_suggest_another_resource(fake):
    fake.push(json.dumps({"recommendations": [rec("React Course for Beginners"), rec("Full Modern React Tutorial", instructor="Net Ninja")]}))
    out = await enrich.more(enrich.MoreRequest.model_validate(
        {"role_title": "Frontend Developer", "skill": "React", "exclude_titles": ["React Course for Beginners"]}), "u1")
    assert [r["title"] for r in out["recommendations"]] == ["Full Modern React Tutorial"]
    assert "React Course for Beginners" in fake.sent_text  # sent as already shown
    shown = ["React Course for Beginners", "Full Modern React Tutorial"]
    fake.push(json.dumps({"recommendations": [rec(shown[0]), rec(shown[1], instructor="Net Ninja")]}))
    fake.push(json.dumps({"recommendations": [rec(shown[0]), rec(shown[1], instructor="Net Ninja")]}))
    with pytest.raises(LLMInvalidOutput):  # nothing new
        await enrich.more(enrich.MoreRequest.model_validate(
            {"role_title": "Frontend Developer", "skill": "React", "exclude_titles": shown}), "u1")


async def test_routes(fake, monkeypatch):
    from app.routes import llm_routes

    monkeypatch.setattr(settings, "INTERNAL_API_KEY", "k-learn")
    app = FastAPI()
    app.include_router(llm_routes.router)
    headers = {"X-Internal-Key": "k-learn", "X-User-Id": "u1"}
    body = request().model_dump()
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://localhost") as c:
        fake.push(answer())
        ok = await c.post("/internal/llm/learning-enrich", json=body, headers=headers)
        assert ok.status_code == 200 and ok.json()["data"]["modules"][0]["skill"] == "JavaScript"
        fake.push(answer([module("JavaScript")]))
        fake.push(answer([module("JavaScript")]))
        # (hours per week is not sent to the model — the timeline is ours — so another skill list makes a new prompt)
        bad = await c.post("/internal/llm/learning-enrich", json={**body, "user_skills": ["HTML"]}, headers=headers)
        assert bad.status_code == 502 and bad.json()["code"] == "LLM_INVALID_OUTPUT"
        assert (await c.post("/internal/llm/learning-enrich", json=body, headers={"X-Internal-Key": "k-learn"})).status_code == 400
        assert (await c.post("/internal/llm/learning-enrich", json={**body, "profile": {"email": "x"}}, headers=headers)).status_code == 422
