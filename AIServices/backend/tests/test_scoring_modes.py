"""Module 5.2: scoring modes (systemconfigs matching.related_credit, sent by Core as X-Related-Credit).

Off (default): credit 1.0 for an exact key, an alias or an any-of alternative, 0 otherwise; related pairs (same FAISS
index, same 0.73 / mutual-NN rule) come back only as hints on that role's missing rows. On: the 0.5 rule, unchanged.
Also: hints are scoped to the role, the explanation no longer mentions related credit when the mode is off, and the
career-match cache key follows the mode and the published curated dataset."""

from app.services.embeddings.normalise import normalise_skill
from app.services.matching import scoring, service
from app.services.professions.role_skills import current_skill
from app.services.taxonomy import snapshots
from tests.db_fixtures import real_db  # noqa: F401 — pytest fixture
from tests.test_matching import (  # noqa: F401 — fixtures
    KEY, client, db, index, matching_db, stub)


# The shared fixture: "Web developer" needs React, Vue.js, Python, Django, Excel; user u1 has React and Python;
# the stub embedder puts Vue.js 0.90 from React and Django 0.80 from Python (related in the 0.5 rule).

async def test_mode_on_keeps_the_half_credit(matching_db):
    web = (await service.get_matches("u1", matching_db, related_credit=True))["results"][0]
    assert web["score"] == 60.0 and (web["matched"], web["related"], web["missing"]) == (2, 2, 1)


async def test_mode_off_gives_exact_alias_and_alternative_credit_only_with_hints(matching_db):
    listed = await service.get_matches("u1", matching_db)
    assert listed["scoring_mode"] == "exact"
    web = listed["results"][0]
    assert web["profession_id"] == "manual:web" and web["score"] == 40.0  # React + Python of 5
    assert (web["matched"], web["related"], web["missing"]) == (2, 0, 3)
    detail = await service.get_match_detail("u1", "manual:web", matching_db)
    member = detail["members"][0]
    rows = {r["name"]: r for r in member["required"]}
    assert rows["Vue.js"]["status"] == "missing" and rows["Vue.js"]["related_hint"]["skill"] == "React"
    assert rows["Django"]["status"] == "missing" and rows["Django"]["related_hint"]["skill"] == "Python"
    assert rows["Vue.js"]["credit"] == 0.0 and "related_hint" not in rows["React"]  # a held row never carries a hint
    assert "related_hint" not in rows["Excel"]
    assert {h["role_skill"] for h in member["related_hints"]} == {"Vue.js", "Django"}
    assert detail["scoring_mode"] == "exact" and "related_hints" not in detail  # no cross-role hint list
    text = " ".join(member["explanation"])
    assert "related" not in text.lower() and "2 matched and 3 missing" in text


def test_hints_are_scoped_to_the_role_and_any_of_alternatives_give_full_credit():
    owned = {normalise_skill(n)[0]: {"name": normalise_skill(n)[1], "source": "manual"} for n in ("Angular", "Python")}
    group = {"name": "React", "key": "react", "type": "essential", "source": "any_of", "label": "React / Angular",
             "phrase": "React / Angular", "alternatives": [{"name": "React", "key": "react"}, {"name": "Angular", "key": "angular"}]}
    front = {"profession_id": "curated:front", "title": "Frontend Developer", "source": "curated",
             "skills": [group, {"name": "Vue.js", "key": "vue.js", "type": "essential"}]}
    data = {"profession_id": "curated:data", "title": "Data Engineer", "source": "curated",
            "skills": [{"name": "Python", "key": "python", "type": "essential"}, {"name": "SQL", "key": "sql", "type": "essential"}]}
    related = {"vue.js": {"user_key": "angular", "similarity": 0.85, "kind": "described"}}
    scored_front = scoring.attach_related_hints(scoring.score_profession(front, owned, {}, current_skill), related, owned)
    scored_data = scoring.attach_related_hints(scoring.score_profession(data, owned, {}, current_skill), related, owned)
    rows = {r["key"]: r for r in scored_front["required"]}
    assert rows["react"]["status"] == "matched" and rows["react"]["credit"] == 1.0 and rows["react"]["via"]["name"] == "Angular"
    assert rows["vue.js"]["credit"] == 0.0 and rows["vue.js"]["related_hint"]["skill"] == "Angular"
    assert [h["role_skill"] for h in scored_front["related_hints"]] == ["Vue.js"]
    assert scored_data["related_hints"] == []  # the Vue.js pair never reaches another role
    assert scored_front["score"] == 50.0 and scored_data["score"] == 50.0


async def test_routes_read_the_mode_header(client):
    async with client as c:
        off = await c.get("/internal/matching/matches", headers={**KEY, "X-User-Id": "u1"})
        on = await c.get("/internal/matching/matches", headers={**KEY, "X-User-Id": "u1", "X-Related-Credit": "true"})
        detail = await c.get("/internal/matching/matches/manual:web", headers={**KEY, "X-User-Id": "u1"})
    assert off.json()["data"]["scoring_mode"] == "exact" and off.json()["data"]["results"][0]["score"] == 40.0
    assert on.json()["data"]["scoring_mode"] == "related" and on.json()["data"]["results"][0]["score"] == 60.0
    assert detail.json()["data"]["scoring_mode"] == "exact"


async def test_the_cache_follows_the_mode_and_the_curated_dataset(matching_db, tmp_path, monkeypatch):
    monkeypatch.setattr(snapshots, "DATA_DIR", tmp_path)
    first = await service.get_matches("u1", matching_db)
    assert (await service.get_matches("u1", matching_db))["cached"] is True
    switched = await service.get_matches("u1", matching_db, related_credit=True)
    assert switched["cached"] is False and switched["results"][0]["score"] == 60.0
    back = await service.get_matches("u1", matching_db)
    assert back["cached"] is False and back["results"][0]["score"] == first["results"][0]["score"]
    (tmp_path / "curated_roles.json").write_text('{"version": "1.0.0", "roles": []}', encoding="utf8")
    assert (await service.get_matches("u1", matching_db))["cached"] is False  # a new curated dataset → recomputed
    assert (await service.get_matches("u1", matching_db))["cached"] is True
