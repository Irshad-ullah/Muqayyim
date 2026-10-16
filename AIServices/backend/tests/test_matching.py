"""Module 5 Part 1: career matching scores — required/optional split, the credit rule, the match
%, duplicate merging, explanations, the per-user service (alias re-normalisation, pending
embeddings, every profession scored) and the cache. Test database only; stub geometry."""

from datetime import datetime, timezone

import numpy as np
import pytest

from app.config.settings import settings
from app.services.embeddings.descriptions import get_description_provider
from app.services.embeddings.user_profiles import USER_SKILL_PROFILES, EmbeddingsPending, upsert_user_skills
from app.services.embeddings.vector_store import get_skill_vectors
from app.services.matching import scoring, service
from app.services.professions.role_skills import current_skill
from app.services.professions.store import PROFESSIONS
from tests.db_fixtures import real_db  # noqa: F401 — pytest fixture
from tests.test_professions import StubEmbedder, add_manual, db, index, stub, unit  # noqa: F401 — fixtures


def skill(name, **flags):
    return {"name": name, "key": name.lower(), "type": flags.pop("type", "technology"), **flags}


def onet(skills, title="Role"):
    return {"profession_id": "onet:1", "title": title, "source": "onet", "skills": skills}


def esco(skills, title="role"):
    return {"profession_id": "esco:1", "title": title, "source": "esco", "skills": skills}


# ── required / optional ───────────────────────────────────────────────────────
def test_onet_required_is_in_demand():
    skills = [skill(f"d{i}", in_demand=True, hot=True) for i in range(12)] + [skill(f"h{i}", hot=True) for i in range(5)]
    required, optional = scoring.split_required(onet(skills))
    assert [s["name"] for s in required] == [f"d{i}" for i in range(12)]
    assert [s["name"] for s in optional] == [f"h{i}" for i in range(5)]


def test_short_lists_are_topped_up_to_ten_in_stored_order():
    skills = [skill(f"d{i}", in_demand=True) for i in range(4)] + [skill(f"h{i}", hot=True) for i in range(9)]
    required, optional = scoring.split_required(onet(skills))
    assert [s["name"] for s in required] == ["d0", "d1", "d2", "d3", "h0", "h1", "h2", "h3", "h4", "h5"]
    assert [s["name"] for s in optional] == ["h6", "h7", "h8"]


def test_esco_required_is_essential_topped_up_in_stored_order():
    skills = [skill("o1", type="optional"), skill("e1", type="essential"), skill("o2", type="optional")] \
        + [skill(f"e{i}", type="essential") for i in range(2, 7)] + [skill(f"o{i}", type="optional") for i in range(3, 8)]
    required, optional = scoring.split_required(esco(skills))
    # 6 essential + the first 4 others in stored order (an optional listed first is taken first)
    assert {s["name"] for s in required} == {"e1", "e2", "e3", "e4", "e5", "e6", "o1", "o2", "o3", "o4"}
    assert [s["name"] for s in required][:3] == ["o1", "e1", "o2"]  # stored order is kept
    assert [s["name"] for s in optional] == ["o5", "o6", "o7"]


def test_a_list_shorter_than_ten_is_all_required():
    required, optional = scoring.split_required(onet([skill("a", hot=True), skill("b", in_demand=True)]))
    assert len(required) == 2 and optional == []


# ── the credit rule ───────────────────────────────────────────────────────────
def pair(user, role, sim, mutual=True, kind="described"):
    return {"user_key": user, "role_key": role, "role_name": role, "similarity": sim, "mutual_nn": mutual, "kind": kind}


def test_credit_rule_decides_the_kind_from_both_skills_description_status():
    described_roles = {"vue.js", "django"}
    pairs = [
        pair("react", "vue.js", 0.90, mutual=True),        # both described + mutual → credit
        pair("python", "django", 0.80, mutual=False),      # both described, not mutual → none
        pair("react", "build ui", 0.75, mutual=False),      # role not described (ESCO label) → mixed, no mutual needed
        # search_related labels this "described" (it is not mixed), but the user skill has no description:
        pair("frobskill", "pipelines", 0.95, mutual=True),
    ]
    best = scoring.related_credits(pairs, {"react": True, "python": True, "frobskill": False},
                                   lambda name: name in described_roles)
    assert set(best) == {"vue.js", "build ui"}
    assert best["vue.js"]["kind"] == "described" and best["build ui"]["kind"] == "mixed"


def test_the_best_pair_per_role_skill_is_kept():
    best = scoring.related_credits([pair("a", "x", 0.75), pair("b", "x", 0.88), pair("c", "x", 0.80)],
                                   {"a": True, "b": True, "c": True}, lambda name: True)
    assert best["x"]["user_key"] == "b" and best["x"]["similarity"] == 0.88


def test_match_percent_counts_required_skills_only():
    skills = [skill("React", in_demand=True), skill("Vue.js", in_demand=True), skill("Excel", in_demand=True),
              skill("Docker", hot=True)]
    owned = {"react": {"name": "React", "source": "cv"}, "docker": {"name": "Docker", "source": "manual"}}
    related = {"vue.js": {"user_key": "react", "similarity": 0.9, "kind": "described"}}
    # 4 skills < 10, so all four are required: React 1.0 + Vue.js 0.5 + Excel 0 + Docker 1.0
    result = scoring.score_profession(onet(skills), owned, related, lambda s: (s["key"], s["name"]))
    assert result["score"] == pytest.approx(62.5)
    assert (result["matched"], result["related"], result["missing"]) == (2, 1, 1)
    assert result["gaps"] == ["Excel"]
    big = [skill(f"d{i}", in_demand=True) for i in range(10)] + [skill("Docker", hot=True)]
    result = scoring.score_profession(onet(big), owned, related, lambda s: (s["key"], s["name"]))
    assert result["score"] == 0.0 and result["optional"][0]["status"] == scoring.MATCHED  # shown, not counted


def test_two_stored_names_that_now_share_a_key_count_once():
    skills = [skill("SAS language", in_demand=True), skill("SAS", in_demand=True)]
    result = scoring.score_profession(onet(skills), {"sas": {"name": "SAS"}}, {},
                                      lambda s: ("sas", "SAS"))
    assert result["required_count"] == 1 and result["score"] == 100.0


# ── duplicates, ranking, explanations ─────────────────────────────────────────
def scored(pid, title, source, score, category="Development", matched=0):
    return {"profession_id": pid, "title": title, "source": source, "score": score, "category": category,
            "matched": matched, "source_version": None, "attribution": scoring.ATTRIBUTION.get(source),
            "required_count": 10, "related": 0, "missing": 10, "required": [], "gaps": []}


def test_exact_titles_merge_across_sources_and_alternative_titles_do_not():
    merged = scoring.merge_duplicates([
        scored("onet:15-1252.00", "Software Developers", "onet", 38.0),
        scored("esco:1", "software developer", "esco", 41.0),
        scored("onet:15-1242.00", "Database Administrators", "onet", 10.0, "Data & AI"),
        scored("esco:2", "data engineer", "esco", 12.0, "Data & AI"),       # an O*NET alt title, not merged
        scored("onet:15-2051.00", "Data Scientists", "onet", 30.0, "Data & AI"),
        scored("esco:3", "data scientist", "esco", 20.0, "Management & Product"),
    ])
    assert len(merged) == 4
    dev = next(m for m in merged if "developer" in m["title"].lower())
    assert dev["profession_id"] == "esco:1" and dev["score"] == 41.0  # the higher score is shown
    assert [s["source"] for s in dev["sources"]] == ["onet", "esco"]
    ds = next(m for m in merged if m["title"] == "Data Scientists")
    assert ds["categories"] == ["Data & AI", "Management & Product"]  # the filter matches either


def test_ranking_is_highest_first_and_deterministic():
    items = [scored("b", "B", "onet", 50.0, matched=1), scored("a", "A", "onet", 50.0, matched=3),
             scored("c", "C", "onet", 70.0)]
    assert [r["profession_id"] for r in scoring.rank(items)] == ["c", "a", "b"]


def test_explanation_is_template_based_and_names_the_sources():
    result = scoring.score_profession(
        esco([skill("React", type="essential"), skill("Vue.js", type="essential"), skill("Excel", type="essential")],
             title="web developer"),
        {"react": {"name": "React", "source": "cv"}},
        {"vue.js": {"user_key": "react", "similarity": 0.9, "kind": "described"}},
        lambda s: (s["key"], s["name"]))
    lines = scoring.explain(result)
    assert lines == scoring.explain(result)  # deterministic
    assert lines[0] == "web developer needs 3 key skills; your match is 50%: 1 matched, 1 related and 1 missing."
    assert lines[1] == "You already have React (from your CV)."
    assert "Vue.js (close to your React, similarity 0.90)" in lines[2]
    assert lines[3] == "To close the gap, learn Excel."
    assert "ESCO lists broader competences" in lines[-1]


# ── the service (test database, stub geometry) ────────────────────────────────
@pytest.fixture
async def matching_db(db, index, stub, monkeypatch):  # noqa: F811
    monkeypatch.setattr(settings, "MUTUAL_NN_K", 10)
    await service.ensure_matching_indexes(db)
    await add_manual(db, "manual:web", "Web developer", ["React", "Vue.js", "Python", "Django", "Excel"])
    await add_manual(db, "manual:sheets", "Spreadsheet clerk", ["Excel"])
    await index.rebuild(db)
    await upsert_user_skills("u1", [{"name": "React", "source": "cv"}, {"name": "Python", "source": "manual"}],
                             embedder=stub, db=db)
    return db


async def test_scores_every_profession_with_the_credit_rule(matching_db):
    result = await service.get_matches("u1", matching_db)
    assert [r["profession_id"] for r in result["results"]] == ["manual:web", "manual:sheets"]
    web = result["results"][0]
    # React 1 + Python 1 + Vue.js 0.5 (0.90 to React) + Django 0.5 (0.80 to Python) + Excel 0 → 3 / 5
    assert web["score"] == 60.0 and (web["matched"], web["related"], web["missing"]) == (2, 2, 1)
    assert result["results"][1]["score"] == 0.0
    assert result["low_match"] is False and result["skill_count"] == 2
    assert {"profession_id": "manual:web", "gaps": ["Excel"]} in result["gaps"]  # FR7.7, for Module 6


async def test_search_related_is_asked_for_every_role_skill(matching_db, monkeypatch):
    from app.services.professions.role_index import get_role_index

    index = get_role_index()
    seen = {}
    original = index.search_related

    def spy(keys, matrix, k=50, user_names=None):
        seen["k"] = k
        return original(keys, matrix, k=k, user_names=user_names)

    monkeypatch.setattr(index, "search_related", spy)
    await service.get_matches("u1", matching_db)
    assert seen["k"] == index.snapshot.index.ntotal  # not only the top-50 neighbours


async def test_the_cache_is_used_and_invalidated(matching_db, stub):
    first = await service.get_matches("u1", matching_db)
    assert first["cached"] is False
    assert (await service.get_matches("u1", matching_db))["cached"] is True
    # a profession edit (any write to the live professions) → recomputed
    await matching_db[PROFESSIONS].update_one({"profession_id": "manual:sheets"},
                                              {"$set": {"title": "Sheets clerk", "updated_at": datetime.now(timezone.utc)}})
    again = await service.get_matches("u1", matching_db)
    assert again["cached"] is False and any(r["title"] == "Sheets clerk" for r in again["results"])
    # the user's skills change → recomputed
    await upsert_user_skills("u1", [{"name": "React", "source": "cv"}, {"name": "Python", "source": "manual"},
                                    {"name": "Excel", "source": "github"}], embedder=stub, db=matching_db)
    changed = await service.get_matches("u1", matching_db)
    by_id = {r["profession_id"]: r["score"] for r in changed["results"]}
    assert changed["cached"] is False and by_id == {"manual:sheets": 100.0, "manual:web": 80.0}
    assert await matching_db[service.CAREER_MATCHES].count_documents({"user_id": "u1"}) == 1


async def test_user_skills_are_normalised_through_todays_aliases(matching_db, stub):
    # A profile saved before "reactjs" became an alias of React keeps the stale key.
    await get_skill_vectors(["React"], stub, matching_db)
    await matching_db[USER_SKILL_PROFILES].update_one(
        {"user_id": "u1"}, {"$set": {"skills": [{"name": "reactjs", "key": "reactjs", "source": "cv"}]}})
    web = (await service.get_matches("u1", matching_db))["results"][0]
    assert web["profession_id"] == "manual:web" and web["matched"] == 1 and web["top_matched"] == ["React"]


async def test_pending_embeddings_and_missing_profiles(matching_db):
    with pytest.raises(service.NoSkills):
        await service.get_matches("nobody", matching_db)
    await matching_db[USER_SKILL_PROFILES].update_one({"user_id": "u1"}, {"$set": {"embedding_status": "pending"}})
    with pytest.raises(EmbeddingsPending):
        await service.get_matches("u1", matching_db)
    await matching_db[USER_SKILL_PROFILES].update_one({"user_id": "u1"}, {"$set": {"embedding_status": "done",
                                                                                   "model": "another/model"}})
    with pytest.raises(EmbeddingsPending):
        await service.get_matches("u1", matching_db)


async def test_low_match_note_and_details(matching_db, stub):
    await upsert_user_skills("u2", [{"name": "Excel", "source": "cv"}], embedder=stub, db=matching_db)
    result = await service.get_matches("u2", matching_db)
    assert result["results"][0]["profession_id"] == "manual:sheets" and result["low_match"] is False
    await upsert_user_skills("u3", [{"name": "Cooking", "source": "manual"}], embedder=stub, db=matching_db)
    low = await service.get_matches("u3", matching_db)
    assert low["low_match"] is True and len(low["results"]) == 2  # every profession is still listed
    detail = await service.get_match_detail("u1", "manual:web", matching_db)
    member = detail["members"][0]
    assert detail["rank"] == 1 and member["explanation"][0].startswith("Web developer needs 5 key skills")
    assert {r["name"]: r["status"] for r in member["required"]} == {
        "React": "matched", "Vue.js": "related", "Python": "matched", "Django": "related", "Excel": "missing"}
    with pytest.raises(service.ProfessionNotFound):
        await service.get_match_detail("u1", "manual:nope", matching_db)


async def test_credits_agree_with_a_brute_force_reading_of_the_rule(db, index, monkeypatch):  # noqa: F811
    """Independent check over the FULL similarity matrix: the credits from search_related(k=all)
    + the matching layer equal the rule applied pair by pair (threshold, mutual_nn, kinds)."""
    from app.services.embeddings import model as model_module
    from app.services.professions.role_index import get_role_index

    provider = get_description_provider()
    rng = np.random.default_rng(7)
    user_names = ["React", "Python", "Docker", "SQL", "Java", "Git"]           # all described
    described_roles = ["Vue.js", "Django", "Kubernetes", "Excel"]
    undescribed_roles = [f"phrase skill {i}" for i in range(16)]
    centres = rng.standard_normal((3, 5))
    table = {}
    for i, name in enumerate(user_names + described_roles + undescribed_roles):
        table[name] = centres[i % 3] + 0.35 * rng.standard_normal(5)
    stub_embedder = StubEmbedder({k: v / np.linalg.norm(v) for k, v in table.items()})
    model_module.use_embedder(stub_embedder)
    monkeypatch.setattr(settings, "EMBEDDING_MODEL", stub_embedder.model_name)
    monkeypatch.setattr(settings, "EMBEDDING_THRESHOLD_MODEL", stub_embedder.model_name)
    monkeypatch.setattr(settings, "EMBEDDING_RELATED_THRESHOLD", 0.73)
    monkeypatch.setattr(settings, "MUTUAL_NN_K", 3)
    try:
        await add_manual(db, "manual:x", "X", described_roles + undescribed_roles)
        await index.rebuild(db)
        snap = get_role_index().snapshot
        keys = [n.lower() for n in user_names]
        user_matrix = stub_embedder.embed_texts(user_names)
        pairs = get_role_index().search_related(keys, user_matrix, k=snap.index.ntotal, user_names=user_names)
        got = scoring.related_credits(pairs, {k: True for k in keys}, lambda n: provider.lookup(n) is not None)

        sims = user_matrix @ snap.matrix.T                       # every user skill × every role skill
        nn = settings.MUTUAL_NN_K
        expected = set()
        for r, role_key in enumerate(snap.keys):
            role_described = provider.lookup(snap.names[role_key]) is not None
            nearest_users = set(np.argsort(-sims[:, r])[:nn])
            for u in range(len(keys)):
                if sims[u, r] < 0.73:
                    continue
                if not role_described:
                    expected.add(role_key)                       # mixed: no mutual check
                    continue
                user_top = [snap.keys[i] for i in np.argsort(-sims[u])][:nn]
                if role_key in user_top and u in nearest_users:
                    expected.add(role_key)
        assert expected, "the geometry must produce some credits"
        assert set(got) == expected
        assert any(v["kind"] == "mixed" for v in got.values()) and any(v["kind"] == "described" for v in got.values())
    finally:
        model_module.use_embedder(None)


# ── internal routes (Part 2) ──────────────────────────────────────────────────
@pytest.fixture
def client(matching_db, monkeypatch):
    import httpx
    from fastapi import FastAPI

    from app.routes import matching_routes

    monkeypatch.setattr(settings, "INTERNAL_API_KEY", "k-match")
    app = FastAPI()
    app.include_router(matching_routes.router)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://localhost")


KEY = {"X-Internal-Key": "k-match"}
BASE = "/internal/matching/matches"


def as_user(user_id):
    return {**KEY, "X-User-Id": user_id}


async def test_list_and_detail_routes(client, caplog):
    caplog.set_level("INFO")
    async with client as c:
        listed = await c.get(BASE, headers=as_user("u1"))
        assert listed.status_code == 200
        data = listed.json()["data"]
        assert data["state"] == "ready" and data["results"][0]["profession_id"] == "manual:web"
        detail = await c.get(f"{BASE}/manual:web", headers=as_user("u1"))
        assert detail.status_code == 200 and detail.json()["data"]["members"][0]["score"] == 60.0
        assert (await c.get(BASE, headers={"X-User-Id": "u1"})).status_code == 401  # internal key required
        assert (await c.get(BASE, headers=KEY)).json()["code"] == "INVALID_USER_ID"  # X-User-Id required
    # FR7.10 / logging: the user id is hashed, skills are never logged.
    text = "\n".join(r.getMessage() for r in caplog.records)
    assert "career matches user=" in text and "results=2" in text
    assert "u1" not in text.split("user=")[1][:12] and "React" not in text and "Python" not in text


async def test_unknown_inactive_and_malformed_ids(client, matching_db):
    await matching_db[PROFESSIONS].update_one({"profession_id": "manual:sheets"}, {"$set": {"active": False}})
    async with client as c:
        for pid in ("manual:nope", "manual:sheets"):          # unknown, inactive
            res = await c.get(f"{BASE}/{pid}", headers=as_user("u1"))
            assert res.status_code == 404 and res.json() == {"success": False, "code": "PROFESSION_NOT_FOUND",
                                                             "message": "That career was not found."}
        assert (await c.get(f"{BASE}/bad id!", headers=as_user("u1"))).status_code == 404
        assert (await c.get(BASE, headers=as_user("not valid"))).json()["code"] == "INVALID_USER_ID"


async def test_no_skills_is_a_state_not_an_error(client):
    async with client as c:
        res = await c.get(BASE, headers=as_user("newuser"))
    assert res.status_code == 200 and res.json()["data"]["state"] == "no_skills"


async def test_not_ready_states_have_their_own_codes_and_retry_hints(client, matching_db, stub, monkeypatch):
    from app.services.professions import role_index as role_index_module

    async with client as c:
        await matching_db[USER_SKILL_PROFILES].update_one({"user_id": "u1"}, {"$set": {"embedding_status": "pending"}})
        res = await c.get(BASE, headers=as_user("u1"))
        assert res.status_code == 503 and res.json()["code"] == "EMBEDDINGS_PENDING"
        assert res.headers["Retry-After"] == "10" and res.json()["retry_after_seconds"] == 10
        monkeypatch.setattr(type(stub), "ready", False)
        assert (await c.get(BASE, headers=as_user("u1"))).json()["code"] == "MODEL_LOADING"
        monkeypatch.setattr(type(stub), "ready", True)
        await matching_db[USER_SKILL_PROFILES].update_one({"user_id": "u1"}, {"$set": {"embedding_status": "done"}})

        empty = role_index_module.RoleSkillIndex(None)
        monkeypatch.setattr(role_index_module, "_index", empty, raising=False)
        role_index_module.use_role_index(empty)
        res = await c.get(BASE, headers=as_user("u1"))
        assert res.status_code == 503 and res.json()["code"] == "INDEX_BUILDING"
        empty.state = role_index_module.WAITING_FOR_MODEL
        assert (await c.get(BASE, headers=as_user("u1"))).json()["code"] == "MODEL_LOADING"
        empty.state = role_index_module.NO_PROFESSIONS
        assert (await c.get(BASE, headers=as_user("u1"))).json()["code"] == "NO_PROFESSIONS"
    for body in (res.json(),):
        assert "Traceback" not in body["message"] and "index" not in body["message"].lower()
