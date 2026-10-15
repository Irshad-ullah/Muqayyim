"""09c Part 5: direct edits — profession overrides and reset, skill taxonomy edits.
Only temporary copies of the data files are used (the session guard in conftest fails
the run if a real app/data file changes)."""

import hashlib
import json
import shutil
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI

from app.config.settings import settings
from app.services.embeddings import descriptions as descriptions_module
from app.services.embeddings import normalise
from app.services.professions import cleaning
from app.services.professions.crud import ProfessionError, create_profession
from app.services.professions.imports import publish_import
from app.services.professions.role_index import RoleSkillIndex, get_role_index, use_role_index
from app.services.professions.store import PROFESSIONS, ensure_profession_indexes
from app.services.taxonomy import editing, jobs, skills_editor, snapshots
from app.services.taxonomy.lock import TaxonomyBusy, TaxonomyLock
from tests.db_fixtures import real_db  # noqa: F401 — pytest fixture

FIXTURES = Path(__file__).parent / "fixtures"
REAL_DATA = Path(__file__).resolve().parents[1] / "app" / "data"
KEY = {"X-Internal-Key": "k-edit"}
DEV = "onet:15-1252.00"


@pytest.fixture
def data_copies(tmp_path):
    """Every reader and writer of the data files points at temporary copies."""
    data = tmp_path / "data"
    shutil.copytree(REAL_DATA, data)
    patches = [(snapshots, "DATA_DIR", data), (descriptions_module, "CURATED_FILE", data / "skill_descriptions.json"),
               (normalise, "ALIASES_FILE", data / "skill_aliases.json"),
               (cleaning, "NAME_MAP_FILE", data / "onet_name_map.json"),
               (cleaning, "ESCO_MAP_FILE", data / "esco_name_map.json")]
    saved = [(obj, name, getattr(obj, name)) for obj, name, _ in patches]
    for obj, name, value in patches:
        setattr(obj, name, value)
    snapshots.reload_taxonomy_files()
    yield data
    for obj, name, value in saved:
        setattr(obj, name, value)
    snapshots.reload_taxonomy_files()  # caches rebuilt from the real files for later tests


@pytest.fixture
async def db(real_db, data_copies, tmp_path, monkeypatch):  # noqa: F811
    monkeypatch.setattr(settings, "TAXONOMY_WORK_DIR", str(tmp_path / "work"))
    monkeypatch.setattr(settings, "ROLE_INDEX_DIR", str(tmp_path / "index"))
    index = RoleSkillIndex(tmp_path / "index")
    use_role_index(index)
    await jobs.ensure_job_indexes(real_db)
    await snapshots.ensure_snapshot_indexes(real_db)
    await ensure_profession_indexes(real_db)
    await publish_import("onet", FIXTURES / "onet", "31.0", db=real_db, rebuild=False)
    await index.rebuild(real_db)
    yield real_db
    await jobs.wait_for_background()
    await index.wait_idle()
    use_role_index(None)


def sha(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def file_hashes(data: Path) -> dict:
    return {name: sha(data / name) for name in snapshots.DATA_FILES}


async def edit_snapshots(db) -> int:
    return await db[snapshots.SNAPSHOTS].count_documents({"pool": "edit"})


def non_seed_role_skill() -> str:
    seed = skills_editor.seed()
    names = [get_role_index().snapshot.names[k] for k in get_role_index().snapshot.keys]
    curated = json.loads(descriptions_module.CURATED_FILE.read_text(encoding="utf8"))
    return next(n for n in names if n in curated and n not in seed)


# ── professions: override, re-import, reset ──────────────────────────────────
async def test_override_survives_reimport_and_resets_to_dataset(db):
    result = await editing.edit_profession(DEV, {"title": "Software Engineers", "description": "Build software."},
                                           "admin-1", db)
    doc = result["result"]
    assert doc["title"] == "Software Engineers" and doc["title_set_by_admin"] and doc["description_set_by_admin"]
    assert doc["dataset_values"]["title"] == "Software Developers"
    assert result["snapshot_id"] and await edit_snapshots(db) == 1

    await publish_import("onet", FIXTURES / "onet", "31.0", db=db, rebuild=False)  # re-import keeps the override
    stored = await db[PROFESSIONS].find_one({"profession_id": DEV})
    assert stored["title"] == "Software Engineers" and stored["dataset_values"]["title"] == "Software Developers"

    reset = (await editing.reset_profession(DEV, ["title"], "admin-1", db))["result"]
    assert reset["title"] == "Software Developers" and reset["reset_fields"] == ["title"]
    assert "title_set_by_admin" not in reset and reset["description_set_by_admin"] is True
    reset_all = (await editing.reset_profession(DEV, None, "admin-1", db))["result"]
    assert reset_all["description"].startswith("Research, design") and "dataset_values" not in reset_all \
        or reset_all.get("dataset_values") == {}
    assert await edit_snapshots(db) == 3


async def test_deactivate_and_reactivate(db):
    await editing.edit_profession(DEV, {"active": False}, "admin-1", db)
    assert "java" not in get_role_index().snapshot.position  # only Software Developers has Java
    assert (await db[PROFESSIONS].find_one({"profession_id": DEV}))["disabled_by_admin"] is True
    await editing.reset_profession(DEV, ["active"], "admin-1", db)
    assert "java" in get_role_index().snapshot.position


async def test_refused_edits_leave_no_snapshot(db):
    manual = await create_profession({"title": "Platform Engineer", "category": "Other",
                                      "skills": [{"name": n} for n in ("Go", "Linux", "Docker", "AWS", "Terraform")]},
                                     db=db)
    with pytest.raises(ProfessionError) as err:
        await editing.reset_profession(manual["profession_id"], None, "admin-1", db)
    assert err.value.code == "NO_DATASET_VALUE"
    with pytest.raises(ProfessionError) as err:
        await editing.reset_profession(DEV, None, "admin-1", db)
    assert err.value.code == "NO_OVERRIDE"
    with pytest.raises(ProfessionError) as err:
        await editing.edit_profession(DEV, {"category": "Cooking"}, "admin-1", db)
    assert err.value.status == 400
    assert await edit_snapshots(db) == 0


# ── skills ────────────────────────────────────────────────────────────────────
async def test_description_edit_re_embeds_only_that_skill(db, fake_embedder, data_copies):
    name = non_seed_role_skill()
    fake_embedder.calls.clear()
    text = "Edited description used only by the automated tests for the skill editor"
    result = await skills_editor.save({"name": name, "description": text}, False, "admin-1", db)
    assert fake_embedder.embedded_texts == [f"{name}: {text}"]  # one skill, nothing else
    assert result["result"]["re_embedded"] == [name] and result["result"]["skill"]["description"] == text
    assert json.loads((data_copies / "skill_descriptions.json").read_text(encoding="utf8"))[name] == text
    assert result["index"]["state"] == "ready"
    assert descriptions_module.get_description_provider().lookup(name).description == text  # caches reloaded


async def test_seed_descriptions_are_read_only(db, data_copies):
    seed_name = next(iter(skills_editor.seed()))
    before = file_hashes(data_copies)
    with pytest.raises(editing.EditRefused) as err:
        await skills_editor.save({"name": seed_name, "description": "Changed seed text that is long enough to pass"},
                                 False, "admin-1", db)
    assert err.value.status == 409 and err.value.code == "SEED_READ_ONLY"
    assert file_hashes(data_copies) == before and await edit_snapshots(db) == 0
    # The seed skill's category is not embedding text and can be edited.
    category = skills_editor.get_skill(seed_name)["category"]
    others = [c for c in skills_editor.list_skills()["categories"] if c != category]
    result = await skills_editor.save({"name": seed_name, "category": others[0]}, False, "admin-1", db)
    assert result["result"]["skill"]["category"] == others[0] and result["result"]["re_embedded"] == []


async def test_alias_edit_and_collision(db, data_copies):
    name = non_seed_role_skill()
    result = await skills_editor.save({"name": name, "aliases": ["Edited Alias For Tests"]}, False, "admin-1", db)
    assert "edited alias for tests" in result["result"]["skill"]["aliases"]
    assert normalise.normalise_skill("Edited alias for tests")[1] == name  # alias table reloaded
    with pytest.raises(editing.EditRefused) as err:
        await skills_editor.save({"name": name, "aliases": ["python"]}, False, "admin-1", db)
    assert err.value.code == "SKILL_INVALID" and any("already belongs to 'Python'" in e for e in err.value.errors)


async def test_create_skill_and_validation(db, data_copies):
    before = file_hashes(data_copies)
    category = skills_editor.list_skills()["categories"][0]
    dry = skills_editor.validate({"name": "Frobnicator", "description": "Too short"}, create=True)
    assert dry["valid"] is False and any("A new skill needs a category" in e for e in dry["errors"])
    assert any("words" in e for e in dry["errors"])  # checker rule: 8-20 words
    assert file_hashes(data_copies) == before  # a dry run writes nothing
    bad_category = skills_editor.validate({"name": "Frobnicator", "description": "x " * 10, "category": "Cooking"}, True)
    assert any("Unknown category" in e for e in bad_category["errors"])
    with pytest.raises(editing.EditRefused) as err:
        await skills_editor.save({"name": "Python", "description": "x " * 10, "category": category}, True, "a", db)
    assert err.value.code == "SKILL_EXISTS"
    created = await skills_editor.save({"name": "Frobnicator", "category": category,
                                        "description": "Test-only tool for frobnicating widgets in automated test suites"},
                                       True, "admin-1", db)
    assert created["result"]["skill"]["name"] == "Frobnicator" and created["result"]["re_embedded"] == ["Frobnicator"]
    assert json.loads((data_copies / "skill_categories.json").read_text(encoding="utf8"))["Frobnicator"] == category


async def test_files_keep_their_format(db, data_copies):
    name = non_seed_role_skill()
    original = (data_copies / "skill_aliases.json").read_bytes()
    await skills_editor.save({"name": name, "aliases": ["Format Check Alias"]}, False, "admin-1", db)
    edited = (data_copies / "skill_aliases.json").read_bytes()
    assert (b"\r\n" in original) == (b"\r\n" in edited)
    changed = [line for line in edited.splitlines() if line not in original.splitlines()]
    assert len(changed) <= 2 and b"format check alias" in b"".join(changed)  # one-line-per-skill layout kept


# ── undo, busy, failure ───────────────────────────────────────────────────────
async def test_restoring_the_edit_snapshot_undoes_the_edits(db, data_copies):
    before_files = file_hashes(data_copies)
    before_hash = get_role_index().snapshot.meta["state_hash"]
    first = await editing.edit_profession(DEV, {"title": "Coders"}, "admin-1", db)
    name = non_seed_role_skill()
    await skills_editor.save({"name": name, "description": "Another edited description for the undo test only"},
                             False, "admin-1", db)
    assert file_hashes(data_copies) != before_files
    from app.services.taxonomy import publishing

    restored = await publishing.restore(first["snapshot_id"], "admin-1", db)
    assert restored["status"] == "restored"
    assert file_hashes(data_copies) == before_files
    assert get_role_index().snapshot.meta["state_hash"] == before_hash
    assert (await db[PROFESSIONS].find_one({"profession_id": DEV}))["title"] == "Software Developers"


async def test_edits_need_the_lock(db):
    lock = await TaxonomyLock("job:publishing", "x", db).acquire()
    try:
        with pytest.raises(TaxonomyBusy):
            await editing.edit_profession(DEV, {"title": "Coders"}, "admin-1", db)
    finally:
        await lock.release()
    assert await edit_snapshots(db) == 0


async def test_failed_edit_is_undone(db, data_copies, monkeypatch):
    before = file_hashes(data_copies)
    index = get_role_index()

    async def broken(*args, **kwargs):
        raise RuntimeError("index exploded")

    monkeypatch.setattr(index, "rebuild", broken)
    with pytest.raises(editing.EditFailed) as err:
        await skills_editor.save({"name": non_seed_role_skill(),
                                  "description": "A description that will be rolled back by the failure test"},
                                 False, "admin-1", db)
    assert err.value.rolled_back is True
    assert file_hashes(data_copies) == before


# ── routes ────────────────────────────────────────────────────────────────────
@pytest.fixture
def client(db, monkeypatch):
    from app.routes import taxonomy_routes

    monkeypatch.setattr(settings, "INTERNAL_API_KEY", "k-edit")
    app = FastAPI()
    app.include_router(taxonomy_routes.router)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://localhost")


async def test_edit_routes(client, db):
    base = "/internal/admin/taxonomy"
    seed_name = next(iter(skills_editor.seed()))
    async with client as c:
        listed = (await c.get(f"{base}/professions", params={"search": "software"}, headers=KEY)).json()
        assert listed["pagination"]["total"] >= 1
        res = await c.patch(f"{base}/professions/{DEV}", json={"title": "Coders", "actor": "admin-3"}, headers=KEY)
        assert res.status_code == 200 and res.json()["data"]["result"]["title"] == "Coders"
        assert res.json()["data"]["snapshot_id"]
        assert (await c.patch(f"{base}/professions/{DEV}", json={}, headers=KEY)).status_code == 422
        assert (await c.patch(f"{base}/professions/nope", json={"title": "Xx"}, headers=KEY)).status_code == 404
        reset = await c.post(f"{base}/professions/{DEV}/reset", json={"fields": ["title"]}, headers=KEY)
        assert reset.status_code == 200 and reset.json()["data"]["result"]["title"] == "Software Developers"

        skills = (await c.get(f"{base}/skills", params={"search": seed_name.lower(), "limit": 200}, headers=KEY)).json()
        row = next(r for r in skills["data"] if r["name"] == seed_name)
        assert row["seed"] is True and skills["categories"]
        seed_edit = await c.put(f"{base}/skills/{seed_name}",
                                json={"description": "A changed seed description, long enough to pass checks"}, headers=KEY)
        assert seed_edit.status_code == 409 and seed_edit.json()["code"] == "SEED_READ_ONLY"
        dry = (await c.post(f"{base}/skills/validate", json={"name": "Frobnicator", "create": True}, headers=KEY)).json()
        assert dry["data"]["valid"] is False
        invalid = await c.post(f"{base}/skills", json={"name": "Frobnicator", "description": "Short"}, headers=KEY)
        assert invalid.status_code == 422 and invalid.json()["code"] == "SKILL_INVALID" and invalid.json()["errors"]
        assert (await c.get(f"{base}/skills/NoSuchSkill", headers=KEY)).status_code == 404
