"""Module 6 Part 1: the deterministic learning-path structure — missing requirements of one career match, the chosen
any-of alternative, the 8-module cap (essential first), tier → quick wins → nearest-neighbour order, prerequisite
validation (only path skills, no self-pairs, duplicates or cycles) and the minimal reorder, and the internal route."""

import numpy as np
import pytest

from app.services.learning import structure
from app.services.professions.store import PROFESSIONS, make_skill, profession_doc
from tests.db_fixtures import real_db  # noqa: F401 — pytest fixture
from tests.test_matching import KEY, db, index, matching_db, stub  # noqa: F401 — fixtures


def item(key, tier="essential", quick=False, position=0):
    return {"key": key, "skill": key.title(), "tier": tier, "quick_win": quick, "position": position, "requirement_key": key}


def vec(*values):
    v = np.zeros(4, dtype=np.float32)
    v[: len(values)] = values
    return v / np.linalg.norm(v)


# ── ordering ──────────────────────────────────────────────────────────────────
def test_tiers_then_quick_wins_then_nearest_neighbours():
    vectors = {"a": vec(1, 0), "b": vec(0, 1), "c": vec(0.9, 0.1), "d": vec(0.1, 0.9), "q": vec(0, 0, 1), "o": vec(1, 1)}
    items = [item("a", position=0), item("b", position=1), item("c", position=2), item("d", position=3),
             item("q", quick=True, position=4), item("o", tier="optional", quick=True, position=5)]
    user = np.stack([vec(1, 0)])
    order = [m["key"] for m in structure.order_modules(items, vectors, user)]
    assert order[0] == "q"                         # essential quick win first
    assert order[-1] == "o"                        # optional tier last, even though it is a quick win
    # q is orthogonal to the rest, so the chain restarts in role order (a) and then follows neighbours: a→c, then d→b
    assert order[1:5] == ["a", "c", "d", "b"]
    assert structure.order_modules(items, vectors, user) == structure.order_modules(items, vectors, user)  # deterministic


def test_without_vectors_the_role_order_is_kept():
    items = [item("x", position=2), item("y", position=0), item("z", position=1)]
    assert [m["key"] for m in structure.order_modules(items, {}, None)] == ["y", "z", "x"]


# ── prerequisites ─────────────────────────────────────────────────────────────
def test_prerequisite_validation_rules():
    keys = ["javascript", "react", "typescript"]
    accepted, rejected = structure.validate_prerequisites(
        [["JavaScript", "React"], ["React", "JavaScript"], ["Docker", "React"], ["React", "React"],
         ["JavaScript", "React"], ["javascript", "typescript"], "nonsense"], keys)
    assert accepted == [("javascript", "react"), ("javascript", "typescript")]
    reasons = [r["reason"] for r in rejected]
    assert reasons == ["would create a cycle", "skill not in the path", "a skill cannot be its own prerequisite",
                       "duplicate", "not a pair"]


def test_prerequisites_move_only_what_must_move():
    modules = [{"key": k} for k in ["react", "css", "javascript", "git"]]
    out = structure.apply_prerequisites(modules, [("javascript", "react")])
    assert [m["key"] for m in out] == ["javascript", "react", "css", "git"]
    assert next(m for m in out if m["key"] == "react")["prerequisites"] == ["javascript"]
    unchanged = structure.apply_prerequisites([{"key": k} for k in ["a", "b"]], [("a", "b")])
    assert [m["key"] for m in unchanged] == ["a", "b"]


# ── candidates (any-of choice) ────────────────────────────────────────────────
def test_any_of_choice_and_invalid_choices():
    member = {"required": [
        {"key": "react", "name": "React / Angular", "status": "missing",
         "group": {"phrase": "React / Angular", "alternatives": ["React", "Angular"]}},
        {"key": "git", "name": "Git", "status": "matched"},
        {"key": "jest", "name": "Jest", "status": "missing", "related_hint": {"skill": "JUnit", "similarity": 0.8}},
    ]}
    profession = {"skills": [make_skill("React", "essential", "x"), make_skill("Jest", "optional", "x")]}
    default = structure.candidates(member, profession)
    assert [(c["skill"], c["tier"], c["quick_win"]) for c in default] == [("React", "essential", False), ("Jest", "optional", True)]
    chosen = structure.candidates(member, profession, {"react": "angular"})
    assert chosen[0]["skill"] == "Angular" and chosen[0]["requirement_key"] == "react"
    with pytest.raises(structure.InvalidChoice):
        structure.candidates(member, profession, {"react": "vue.js"})
    with pytest.raises(structure.InvalidChoice):
        structure.candidates(member, profession, {"jest": "mocha"})


# ── the service on the shared matching fixture ────────────────────────────────
# "Web developer" needs React, Vue.js, Python, Django, Excel; u1 holds React and Python; Vue.js is 0.90 from React and
# Django 0.80 from Python (related hints), Excel is unrelated.
async def owned_u1(db):
    from app.services.matching import service

    return await service.user_skills("u1", db)


async def test_build_from_a_career_match(matching_db):
    path = await structure.build(await owned_u1(matching_db), "manual:web", matching_db)
    assert [m["skill"] for m in path["modules"]] == ["Vue.js", "Django", "Excel"]  # quick wins (closest first), then the rest
    assert [m["order"] for m in path["modules"]] == [1, 2, 3]
    assert path["modules"][0]["quick_win"] and path["modules"][0]["hint"]["skill"] == "React"
    assert path["more"] == {"count": 0, "skills": []}
    assert path["snapshot"]["skills_hash"] and path["snapshot"]["dataset_hash"] and path["title"] == "Web developer"
    again = await structure.build(await owned_u1(matching_db), "manual:web", matching_db)
    assert again["modules"] == path["modules"]
    with_prereq = await structure.build(await owned_u1(matching_db), "manual:web", matching_db,
                                        prerequisites=[["Excel", "Vue.js"], ["Kubernetes", "Excel"]])
    assert [m["skill"] for m in with_prereq["modules"]] == ["Excel", "Vue.js", "Django"]
    assert with_prereq["prerequisites"]["rejected"][0]["reason"] == "skill not in the path"


async def test_cap_of_eight_modules_essential_first(matching_db):
    skills = [make_skill(f"Tool {i}", "optional", f"Tool {i}") for i in range(6)] + \
             [make_skill(f"Core {i}", "essential", f"Core {i}") for i in range(6)]
    doc = profession_doc(profession_id="manual:big", title="Big role", alt_titles=[], description="", category="Other",
                         source="manual", source_code="", source_version="manual", skills=skills)
    await matching_db[PROFESSIONS].insert_one(doc)
    from app.services.professions.role_index import get_role_index

    await get_role_index().rebuild(matching_db)
    path = await structure.build(await owned_u1(matching_db), "manual:big", matching_db)
    tiers = [m["tier"] for m in path["modules"]]
    assert len(path["modules"]) == 8 and tiers[:6] == ["essential"] * 6 and tiers[6:] == ["optional"] * 2
    # 6 essential + 4 optional topped up to the required 10 → 8 kept, 2 more (the other optionals are not required)
    assert path["more"]["count"] == 2


@pytest.fixture
def client(matching_db, monkeypatch):
    import httpx
    from fastapi import FastAPI

    from app.config.settings import settings
    from app.routes import learning_routes

    monkeypatch.setattr(settings, "INTERNAL_API_KEY", KEY["X-Internal-Key"])
    app = FastAPI()
    app.include_router(learning_routes.router)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://localhost")


async def test_route(client):
    async with client as c:
        ok = await c.post("/internal/learning/structure", json={"profession_id": "manual:web"}, headers={**KEY, "X-User-Id": "u1"})
        assert ok.status_code == 200 and ok.json()["data"]["modules"][0]["skill"] == "Vue.js"
        assert (await c.post("/internal/learning/structure", json={"profession_id": "manual:none"},
                             headers={**KEY, "X-User-Id": "u1"})).json()["code"] == "PROFESSION_NOT_FOUND"
        assert (await c.post("/internal/learning/structure", json={"profession_id": "manual:web"},
                             headers=KEY)).json()["code"] == "INVALID_USER_ID"
        assert (await c.post("/internal/learning/structure", json={"profession_id": "manual:web", "extra": 1},
                             headers={**KEY, "X-User-Id": "u1"})).status_code == 422


# ── learning skills (completed modules) count in the match and are reported as unverified ─────────────────────────
async def test_learning_skills_count_and_are_reported_as_unverified(matching_db, stub):
    from app.services.embeddings.user_profiles import upsert_user_skills
    from app.services.matching import service

    await upsert_user_skills("u9", [{"name": "React", "source": "cv"}, {"name": "Excel", "source": "learning"}],
                             embedder=stub, db=matching_db)
    listed = await service.get_matches("u9", matching_db)
    web = next(r for r in listed["results"] if r["profession_id"] == "manual:web")
    assert web["matched"] == 2 and listed["unverified_skill_count"] == 1  # Excel counts, and is flagged unverified
    detail = await service.get_match_detail("u9", "manual:sheets", matching_db)
    row = detail["members"][0]["required"][0]
    assert row["status"] == "matched" and row["via"]["source"] == "learning"
    assert "your learning path (not verified)" in " ".join(detail["members"][0]["explanation"])


# ── Part 6: paths use verified skills only; the state endpoint gives the hashes for "Regenerate?" ─────────────────
async def test_paths_use_verified_skills_and_state_reports_the_hashes(client, matching_db, stub):
    from app.services.embeddings.user_profiles import upsert_user_skills
    from app.services.learning import structure

    await upsert_user_skills("u8", [{"name": "React", "source": "cv"}], embedder=stub, db=matching_db)
    async with client as c:
        h = {**KEY, "X-User-Id": "u8"}
        first = (await c.post("/internal/learning/structure", json={"profession_id": "manual:web"}, headers=h)).json()["data"]
        state = (await c.get("/internal/learning/state", headers=h)).json()["data"]
        assert state == {"skills_hash": first["snapshot"]["skills_hash"], "dataset_hash": first["snapshot"]["dataset_hash"]}
        # completing a module (a learning skill) changes neither the path nor the hash
        await upsert_user_skills("u8", [{"name": "React", "source": "cv"}, {"name": "Vue.js", "source": "learning"}],
                                 embedder=stub, db=matching_db)
        again = (await c.post("/internal/learning/structure", json={"profession_id": "manual:web"}, headers=h)).json()["data"]
        assert [m["skill"] for m in again["modules"]] == [m["skill"] for m in first["modules"]]
        assert (await c.get("/internal/learning/state", headers=h)).json()["data"] == state
        # a verified profile change does
        await upsert_user_skills("u8", [{"name": "React", "source": "cv"}, {"name": "Excel", "source": "manual"}],
                                 embedder=stub, db=matching_db)
        assert (await c.get("/internal/learning/state", headers=h)).json()["data"]["skills_hash"] != state["skills_hash"]
        assert (await c.get("/internal/learning/state", headers=KEY)).json()["code"] == "INVALID_USER_ID"
    assert structure.verified({"a": {"source": "cv"}, "b": {"source": "learning"}}) == {"a": {"source": "cv"}}
