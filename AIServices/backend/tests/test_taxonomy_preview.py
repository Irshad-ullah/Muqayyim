"""09c Part 3: the shared preview pipeline (stage, diff, checks), its routes and the CLI path."""

import io
import shutil
import zipfile
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI

from app.config.settings import settings
from app.services.professions.imports import publish_import
from app.services.professions.store import ESCO_SKILLS, PROFESSIONS, ensure_profession_indexes
from app.services.taxonomy import cli, jobs, pipeline, uploads
from tests.db_fixtures import real_db  # noqa: F401 — pytest fixture

FIXTURES = Path(__file__).parent / "fixtures"
KEY = {"X-Internal-Key": "k-prev"}
VOLATILE = {"_id", "created_at", "updated_at"}


@pytest.fixture
async def db(real_db, tmp_path, monkeypatch):  # noqa: F811
    monkeypatch.setattr(settings, "TAXONOMY_WORK_DIR", str(tmp_path / "work"))
    await jobs.ensure_job_indexes(real_db)
    await pipeline.ensure_diff_indexes(real_db)
    await ensure_profession_indexes(real_db)
    yield real_db
    await jobs.wait_for_background()


@pytest.fixture
def quick_checks(monkeypatch):
    """Replace the (slower) coverage + background check with a fixed result."""
    result = {"coverage": {"overall": {}}, "background": {"check": {"passed": True}}, "background_warning": False}

    async def fake(*args, **kwargs):
        return dict(result)

    monkeypatch.setattr(pipeline, "run_checks", fake)
    return result


def zip_dir(directory: Path) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(directory.glob("*.csv")):
            archive.writestr(path.name, path.read_bytes())
    return buffer.getvalue()


class Upload:
    def __init__(self, data: bytes):
        self.buffer = io.BytesIO(data)

    async def read(self, n=-1):
        return self.buffer.read(n)


async def preview_zip(db, source, directory: Path, version=None) -> dict:
    version = version or ("O*NET 31.0" if source == "onet" else "ESCO v1.2.1")
    job = await uploads.create_upload_job(source, version, "admin-1", [("data.zip", Upload(zip_dir(directory)))], db=db)
    await jobs.wait_for_background()
    await pipeline.start_preview(job["job_id"], db=db)
    await jobs.wait_for_background()
    return await jobs.get_job(job["job_id"], db=db)


async def docs(db, collection) -> list:
    return [{k: v for k, v in d.items() if k not in VOLATILE}
            async for d in db[collection].find({}).sort("profession_id" if collection.startswith(PROFESSIONS) else "uri", 1)]


# ── preview never touches the live data ──────────────────────────────────────
async def test_preview_leaves_live_data_untouched(db, quick_checks):
    await publish_import("onet", FIXTURES / "onet", "31.0", db=db, rebuild=False)
    before = {c: await docs(db, c) for c in (PROFESSIONS, ESCO_SKILLS)}
    fingerprint = await pipeline.live_fingerprint(db)

    job = await preview_zip(db, "esco", FIXTURES / "esco")
    assert job["status"] == jobs.PREVIEWED, job.get("error")
    assert {c: await docs(db, c) for c in (PROFESSIONS, ESCO_SKILLS)} == before
    assert await pipeline.live_fingerprint(db) == fingerprint == job["preview_base"]
    names = pipeline.staging_names(job["job_id"])
    staged = await docs(db, names["professions"])
    assert {d["profession_id"] for d in staged} == {d["profession_id"] for d in before[PROFESSIONS]} | {
        "esco:dev-0001", "esco:ana-0002"}
    assert await db[names["esco_skills"]].count_documents({}) == 9


async def test_staging_collections_have_the_live_indexes(db, quick_checks):
    job = await preview_zip(db, "onet", FIXTURES / "onet")
    names = pipeline.staging_names(job["job_id"])
    for live, staged in ((PROFESSIONS, names["professions"]), (ESCO_SKILLS, names["esco_skills"])):
        live_specs = await pipeline.index_specs(db, live)
        assert live_specs and await pipeline.index_specs(db, staged) == live_specs
    unique = (await pipeline.index_specs(db, names["professions"]))["profession_id_unique"]
    assert unique["unique"] is True


# ── diff ──────────────────────────────────────────────────────────────────────
async def test_diff_for_a_first_import(db, quick_checks):
    job = await preview_zip(db, "esco", FIXTURES / "esco")
    summary = job["diff_summary"]
    assert summary["counts"]["professions_added"] == 1  # ana-0002 has 2 skills → stored inactive
    assert summary["counts"]["professions_removed"] == 0 and summary["counts"]["links_removed"] == 0
    assert summary["counts"]["links_added"] == 6
    assert summary["active_professions"] == {"live": 0, "staged": 1}
    assert summary["categories"] == {"Development": {"live": 0, "staged": 1}}
    undescribed = {s["name"] for s in summary["samples"]["new_undescribed_skills"]}
    assert "use software design patterns" in undescribed and "Python" not in undescribed
    assert summary["written"]["inserted"] == 2 and summary["import_stats"]["occupations_kept"] == 2


async def test_diff_added_removed_changed_and_links(db, quick_checks, tmp_path):
    await publish_import("onet", FIXTURES / "onet", "31.0", db=db, rebuild=False)
    changed = tmp_path / "onet"
    shutil.copytree(FIXTURES / "onet", changed)
    text = (changed / "occupation_data.csv").read_text(encoding="utf-8-sig")
    assert "15-1252.00,Software Developers," in text
    text = text.replace("15-1252.00,Software Developers,", "15-1252.00,Software Engineers,")
    text = "\n".join(line for line in text.splitlines() if not line.startswith("15-2051.00"))
    (changed / "occupation_data.csv").write_text(text + "\n", encoding="utf8")

    job = await preview_zip(db, "onet", changed)
    summary = job["diff_summary"]
    assert summary["counts"]["professions_removed"] == 1
    assert summary["samples"]["professions_removed"][0]["profession_id"] == "onet:15-2051.00"
    changed_items = (await pipeline.diff_page(job["job_id"], "professions_changed", 1, 50, db=db))["items"]
    title_change = next(i for i in changed_items if i["profession_id"] == "onet:15-1252.00")
    assert title_change["changes"]["title"] == {"from": "Software Developers", "to": "Software Engineers"}
    assert title_change["kept_admin_override"] == []
    removed_links = await pipeline.diff_page(job["job_id"], "links_removed", 1, 50, db=db)
    assert removed_links["total"] == 6 and {i["profession_id"] for i in removed_links["items"]} == {"onet:15-2051.00"}


async def test_diff_shows_kept_admin_override(db, quick_checks):
    await publish_import("onet", FIXTURES / "onet", "31.0", db=db, rebuild=False)
    await db[PROFESSIONS].update_one({"profession_id": "onet:15-1252.00"},
                                     {"$set": {"title": "Coders", "title_set_by_admin": True}})
    job = await preview_zip(db, "onet", FIXTURES / "onet")
    item = next(i for i in job["diff_summary"]["samples"]["professions_changed"] if i["profession_id"] == "onet:15-1252.00")
    assert item["kept_admin_override"] == ["title"] and item["changes"] == {}
    assert job["diff_summary"]["kept_admin_overrides"] == 1
    staged = await db[pipeline.staging_names(job["job_id"])["professions"]].find_one({"profession_id": "onet:15-1252.00"})
    assert staged["title"] == "Coders"


async def test_diff_detail_pagination(db, quick_checks):
    job = await preview_zip(db, "esco", FIXTURES / "esco")
    first = await pipeline.diff_page(job["job_id"], "links_added", page=1, limit=4, db=db)
    second = await pipeline.diff_page(job["job_id"], "links_added", page=2, limit=4, db=db)
    assert first["total"] == 6 and first["pages"] == 2
    assert len(first["items"]) == 4 and len(second["items"]) == 2
    assert {i["key"] for i in first["items"]}.isdisjoint({i["key"] for i in second["items"]})


# ── checks ────────────────────────────────────────────────────────────────────
async def test_real_checks_run_on_the_staged_data(db):
    job = await preview_zip(db, "onet", FIXTURES / "onet")
    checks = job["checks"]
    assert job["status"] == jobs.PREVIEWED
    assert checks["coverage"]["coverage"]["overall"]["distinct"] == 12  # staged: 2 active O*NET professions
    assert checks["coverage_live"]["coverage"]["overall"]["distinct"] == 0  # nothing live yet
    background = checks["background"]
    assert "check" in background and set(background["rates"]) == {"web", "chef"}
    assert isinstance(checks["background_warning"], bool)
    # The staged index was built in the job's staging directory, never the live index directory.
    assert (Path(job["staging_dir"]) / "index" / "role_skills.faiss").is_file()


async def test_failed_background_check_sets_the_warning(db, monkeypatch):
    credit = pipeline._load_eval("background_credit_rate")

    async def failing(**kwargs):
        return {"check": {"passed": False, "chef_pooled_pct": 9.0, "web_pooled_pct": 10.0},
                "profiles": {p: {"pooled_related_pct": 1, "median_profession_related_pct": 1, "related_by_kind": {}}
                             for p in ("web", "chef")}, "role_skills": 3}

    monkeypatch.setattr(credit, "run", failing)
    original = pipeline._load_eval
    monkeypatch.setattr(pipeline, "_load_eval", lambda name: credit if name == "background_credit_rate" else original(name))
    job = await preview_zip(db, "onet", FIXTURES / "onet")
    assert job["checks"]["background_warning"] is True
    assert job["checks"]["background"]["check"]["passed"] is False
    assert job["background_acknowledged"] is False


async def test_unavailable_background_check_is_a_warning(db, monkeypatch):
    credit = pipeline._load_eval("background_credit_rate")

    async def unavailable(**kwargs):
        raise credit.CheckUnavailable("No role-skill index (no active professions?)")

    monkeypatch.setattr(credit, "run", unavailable)
    original = pipeline._load_eval
    monkeypatch.setattr(pipeline, "_load_eval", lambda name: credit if name == "background_credit_rate" else original(name))
    job = await preview_zip(db, "onet", FIXTURES / "onet")
    assert job["status"] == jobs.PREVIEWED
    assert job["checks"]["background_warning"] is True
    assert job["checks"]["background"]["error"].startswith("No role-skill index")


# ── lifecycle ─────────────────────────────────────────────────────────────────
async def test_failed_preview_cleans_up(db, quick_checks, monkeypatch):
    async def broken(*args, **kwargs):
        raise RuntimeError("boom")

    monkeypatch.setattr(pipeline, "diff", broken)
    job = await preview_zip(db, "onet", FIXTURES / "onet")
    assert job["status"] == jobs.FAILED and job["error"] == "RuntimeError (details in the service error log)"
    assert not [n for n in await db.list_collection_names() if pipeline.is_staging_collection(n)]
    assert job.get("staging_dir") is None and not list(uploads.staging_root().iterdir())


async def test_cancel_drops_staged_data(db, quick_checks):
    job = await preview_zip(db, "onet", FIXTURES / "onet")
    assert await db[pipeline.DIFFS].count_documents({"job_id": job["job_id"]}) > 0
    await uploads.cancel_job(job["job_id"], db=db)
    assert not [n for n in await db.list_collection_names() if pipeline.is_staging_collection(n)]
    assert await db[pipeline.DIFFS].count_documents({"job_id": job["job_id"]}) == 0


async def test_cleanup_drops_orphan_staging_collections(db):
    await db.create_collection(f"{PROFESSIONS}{pipeline.STAGING_PREFIX}deadbeef")
    await db.create_collection(f"{ESCO_SKILLS}{pipeline.STAGING_PREFIX}deadbeef")
    counts = await uploads.cleanup_staging(db)
    assert counts["staging_collections_dropped"] == 1
    assert not [n for n in await db.list_collection_names() if pipeline.is_staging_collection(n)]


async def test_re_preview_and_state_rules(db, quick_checks):
    job = await preview_zip(db, "onet", FIXTURES / "onet")
    await pipeline.start_preview(job["job_id"], db=db)  # previewed → previewing again is allowed
    await jobs.wait_for_background()
    assert (await jobs.get_job(job["job_id"], db=db))["status"] == jobs.PREVIEWED
    await uploads.cancel_job(job["job_id"], db=db)
    with pytest.raises(jobs.JobStateError):
        await pipeline.start_preview(job["job_id"], db=db)


# ── the UI path and the CLI path give the same result ────────────────────────
async def test_ui_and_cli_paths_give_identical_results(db, quick_checks):
    await publish_import("onet", FIXTURES / "onet", "31.0", db=db, rebuild=False)
    ui = await preview_zip(db, "esco", FIXTURES / "esco")
    cli_job = await cli.preview_from_directory("esco", str(FIXTURES / "esco"), "1.2.1", db=db)
    assert cli_job["status"] == jobs.PREVIEWED and cli_job["created_by"] == "cli"
    assert ui["dataset_version"] == cli_job["dataset_version"] == "ESCO v1.2.1"
    assert ui["diff_summary"] == cli_job["diff_summary"]
    ui_names, cli_names = pipeline.staging_names(ui["job_id"]), pipeline.staging_names(cli_job["job_id"])
    for kind in ("professions", "esco_skills"):
        assert await docs(db, ui_names[kind]) == await docs(db, cli_names[kind])
    assert ui["file_summary"]["validated_files"] == cli_job["file_summary"]["validated_files"]


# ── routes ────────────────────────────────────────────────────────────────────
@pytest.fixture
def client(db, monkeypatch):
    from app.routes import taxonomy_routes

    monkeypatch.setattr(settings, "INTERNAL_API_KEY", "k-prev")
    app = FastAPI()
    app.include_router(taxonomy_routes.router)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://localhost")


async def test_preview_routes(client, db, quick_checks):
    job = await uploads.create_upload_job("onet", "31.0", "admin-1",
                                          [("d.zip", Upload(zip_dir(FIXTURES / "onet")))], db=db)
    async with client as c:
        early = await c.get(f"/internal/admin/taxonomy/jobs/{job['job_id']}/diff", params={"section": "links_added"},
                            headers=KEY)
        assert early.status_code == 409 and early.json()["code"] == "NO_PREVIEW"
        await jobs.wait_for_background()
        res = await c.post(f"/internal/admin/taxonomy/jobs/{job['job_id']}/preview", headers=KEY)
        assert res.status_code == 202 and res.json()["data"]["status"] == "previewing"
        await jobs.wait_for_background()
        polled = (await c.get(f"/internal/admin/taxonomy/jobs/{job['job_id']}", headers=KEY)).json()["data"]
        assert polled["status"] == "previewed" and polled["diff_summary"]["counts"]["links_added"] == 13
        page = (await c.get(f"/internal/admin/taxonomy/jobs/{job['job_id']}/diff",
                            params={"section": "links_added", "limit": 5}, headers=KEY)).json()
        assert page["pagination"]["total"] == 13 and len(page["data"]) == 5
        bad = await c.get(f"/internal/admin/taxonomy/jobs/{job['job_id']}/diff", params={"section": "x"}, headers=KEY)
        assert bad.status_code == 422
        assert (await c.post("/internal/admin/taxonomy/jobs/none/preview", headers=KEY)).status_code == 404
        await c.post(f"/internal/admin/taxonomy/jobs/{job['job_id']}/cancel", headers=KEY)
        again = await c.post(f"/internal/admin/taxonomy/jobs/{job['job_id']}/preview", headers=KEY)
        assert again.status_code == 409 and again.json()["job_status"] == "cancelled"
