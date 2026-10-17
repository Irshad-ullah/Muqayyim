"""09c Part 4: publish (snapshot, swap, index, checks), automatic rollback, crash recovery,
restore, retention and the CLI publish path. Test database and temporary folders only."""

import asyncio
import io
import json
import shutil
import zipfile
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI

from app.config.settings import settings
from app.services.professions.imports import publish_import
from app.services.professions.role_index import RoleSkillIndex, use_role_index
from app.services.professions.store import ESCO_SKILLS, PROFESSIONS, ensure_profession_indexes
from app.services.taxonomy import cli, jobs, pipeline, publishing, snapshots, uploads
from app.services.taxonomy.lock import TaxonomyBusy, TaxonomyLock
from tests.db_fixtures import real_db  # noqa: F401 — pytest fixture

FIXTURES = Path(__file__).parent / "fixtures"
REAL_DATA = Path(__file__).resolve().parents[1] / "app" / "data"
KEY = {"X-Internal-Key": "k-pub", "X-Admin-Id": "admin-7"}
VOLATILE = {"_id", "created_at", "updated_at"}


@pytest.fixture
async def db(real_db, tmp_path, monkeypatch):  # noqa: F811
    monkeypatch.setattr(settings, "TAXONOMY_WORK_DIR", str(tmp_path / "work"))
    monkeypatch.setattr(settings, "ROLE_INDEX_DIR", str(tmp_path / "index"))
    data = tmp_path / "data"
    data.mkdir()
    for name in snapshots.DATA_FILES:
        if (REAL_DATA / name).is_file():  # curated_roles.json exists only after a curated publish (Module 5.2)
            shutil.copy2(REAL_DATA / name, data / name)
    monkeypatch.setattr(snapshots, "DATA_DIR", data)
    index = RoleSkillIndex(tmp_path / "index")
    use_role_index(index)
    for setup in (jobs.ensure_job_indexes, pipeline.ensure_diff_indexes, snapshots.ensure_snapshot_indexes,
                  publishing.ensure_restore_indexes, ensure_profession_indexes):
        await setup(real_db)
    yield real_db
    await jobs.wait_for_background()
    await index.wait_idle()
    use_role_index(None)


@pytest.fixture
def checks(monkeypatch):
    """Fixed coverage / background results (fast); `checks["background_warning"]` can be flipped."""
    result = {"coverage": {"overall": {"distinct": 1}}, "background": {"check": {"passed": True}},
              "background_warning": False}

    async def fake(*args, **kwargs):
        return json.loads(json.dumps(result))

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


async def previewed(db, source="esco", directory=None) -> dict:
    directory = directory or FIXTURES / source
    version = "O*NET 31.0" if source == "onet" else "ESCO v1.2.1"
    job = await uploads.create_upload_job(source, version, "admin-1", [("d.zip", Upload(zip_dir(directory)))], db=db)
    await jobs.wait_for_background()
    await pipeline.start_preview(job["job_id"], db=db)
    await jobs.wait_for_background()
    job = await jobs.get_job(job["job_id"], db=db)
    assert job["status"] == jobs.PREVIEWED, job.get("error")
    return job


async def docs(db, collection) -> list:
    sort = "profession_id" if collection.startswith(PROFESSIONS) else "uri"
    return [{k: v for k, v in d.items() if k not in VOLATILE} async for d in db[collection].find({}).sort(sort, 1)]


async def state(db) -> dict:
    return {c: await docs(db, c) for c in (PROFESSIONS, ESCO_SKILLS)}


def staging_left(names) -> list:
    return [n for n in names if pipeline.is_staging_collection(n) or "__restore_" in n]


async def seed_onet(db):
    await publish_import("onet", FIXTURES / "onet", "31.0", db=db, rebuild=False)


# ── publish ───────────────────────────────────────────────────────────────────
async def test_publish_swaps_the_staged_data_in(db, checks):
    await seed_onet(db)
    before = await state(db)
    job = await previewed(db)
    staged = await docs(db, pipeline.staging_names(job["job_id"])["professions"])

    done = await publishing.start_publish(job["job_id"], actor="admin-1", db=db, wait=True)
    assert done["status"] == jobs.PUBLISHED, done.get("error")
    assert await docs(db, PROFESSIONS) == staged  # exactly the previewed data
    assert await db[ESCO_SKILLS].count_documents({}) == 9
    assert not staging_left(await db.list_collection_names())
    assert done.get("staging_dir") is None and not list(uploads.staging_root().iterdir())
    post = done["post_publish_checks"]
    assert post["state_hash_ok"] is True and post["index"]["state"] == "ready"
    assert post["fingerprint"] == await pipeline.live_fingerprint(db)
    # The snapshot holds the pre-publish state.
    record = await snapshots.get_snapshot(done["snapshot_id"], db)
    assert record["reason"] == "publish" and record["job_id"] == job["job_id"] and record["created_by"] == "admin-1"
    assert record["counts"]["professions"] == len(before[PROFESSIONS])
    assert record["source_versions"] == {"onet": ["O*NET 31.0"]}


async def test_index_lists_are_unchanged_by_publish(db, checks):
    await seed_onet(db)
    before = {c: await pipeline.index_specs(db, c) for c in (PROFESSIONS, ESCO_SKILLS)}
    job = await previewed(db)
    await publishing.start_publish(job["job_id"], db=db, wait=True)
    after = {c: await pipeline.index_specs(db, c) for c in (PROFESSIONS, ESCO_SKILLS)}
    assert after == before and after[PROFESSIONS]["profession_id_unique"]["unique"] is True
    assert after[ESCO_SKILLS]["uri_unique"]["unique"] is True


async def test_background_warning_needs_acknowledgement(db, checks):
    checks["background_warning"] = True
    job = await previewed(db)
    with pytest.raises(publishing.PublishRefused) as err:
        await publishing.start_publish(job["job_id"], db=db, wait=True)
    assert err.value.status == 422 and err.value.code == "BACKGROUND_ACK_REQUIRED"
    assert (await jobs.get_job(job["job_id"], db=db))["status"] == jobs.PREVIEWED
    done = await publishing.start_publish(job["job_id"], acknowledge=True, db=db, wait=True)
    assert done["status"] == jobs.PUBLISHED and done["background_acknowledged"] is True


async def test_live_data_changed_after_preview(db, checks):
    job = await previewed(db)
    await seed_onet(db)  # somebody else changed the live data
    with pytest.raises(publishing.PublishRefused) as err:
        await publishing.start_publish(job["job_id"], db=db, wait=True)
    assert err.value.status == 409 and err.value.code == "LIVE_DATA_CHANGED"
    await pipeline.start_preview(job["job_id"], db=db)  # re-preview, then it can be published
    await jobs.wait_for_background()
    assert (await publishing.start_publish(job["job_id"], db=db, wait=True))["status"] == jobs.PUBLISHED


async def test_concurrent_publish_is_refused(db, checks):
    first = await previewed(db, "esco")
    second = await previewed(db, "onet")
    started = asyncio.Event()
    release = asyncio.Event()

    async def slow_rebuild(*args, **kwargs):
        started.set()
        await release.wait()
        return await original(*args, **kwargs)

    index = __import__("app.services.professions.role_index", fromlist=["get_role_index"]).get_role_index()
    original = index.rebuild
    index.rebuild = slow_rebuild
    try:
        await publishing.start_publish(first["job_id"], db=db)  # background
        await started.wait()
        with pytest.raises(TaxonomyBusy):
            await publishing.start_publish(second["job_id"], db=db)
        assert (await jobs.get_job(second["job_id"], db=db))["status"] == jobs.PREVIEWED
    finally:
        release.set()
        await jobs.wait_for_background()
        index.rebuild = original
    assert (await jobs.get_job(first["job_id"], db=db))["status"] == jobs.PUBLISHED


async def test_only_previewed_jobs_can_be_published(db, checks):
    job = await uploads.create_upload_job("esco", "1.2.1", "admin-1", [("d.zip", Upload(zip_dir(FIXTURES / "esco")))], db=db)
    await jobs.wait_for_background()
    with pytest.raises(jobs.JobStateError):
        await publishing.start_publish(job["job_id"], db=db)


# ── failure and crash ─────────────────────────────────────────────────────────
async def test_failure_part_way_restores_automatically(db, checks):
    await seed_onet(db)
    index = __import__("app.services.professions.role_index", fromlist=["get_role_index"]).get_role_index()
    await index.rebuild(db)  # a live index exists, so the snapshot carries its files
    before = await state(db)
    job = await previewed(db)

    async def broken(*args, **kwargs):
        raise RuntimeError("index exploded")

    original = index.rebuild
    index.rebuild = broken  # fails AFTER the swap
    try:
        done = await publishing.start_publish(job["job_id"], db=db, wait=True)
    finally:
        index.rebuild = original
    assert done["status"] == jobs.ROLLED_BACK
    assert done["error"] == "RuntimeError (details in the service error log)"
    assert await state(db) == before
    restored = done["post_publish_checks"]["restore"]
    assert restored["index_state"] == "ready" and restored["index_files_restored"] is True
    assert restored["index_rebuilt"] is False  # the snapshot's index files were loaded, not rebuilt
    assert not staging_left(await db.list_collection_names())
    from app.services.taxonomy.lock import current_lock

    assert await current_lock(db) is None


async def test_a_rollback_that_cannot_complete_ends_failed(db, checks, monkeypatch):
    job = await previewed(db)

    async def broken_rebuild(*args, **kwargs):
        raise RuntimeError("index exploded")

    async def broken_restore(*args, **kwargs):
        raise OSError("snapshot volume gone")

    index = __import__("app.services.professions.role_index", fromlist=["get_role_index"]).get_role_index()
    monkeypatch.setattr(index, "rebuild", broken_rebuild)
    monkeypatch.setattr(snapshots, "restore_files", broken_restore)
    done = await publishing.start_publish(job["job_id"], db=db, wait=True)
    assert done["status"] == jobs.FAILED  # never reported as rolled back
    assert "restoring snapshot" in done["error"] and "also failed" in done["error"]


async def test_failure_before_the_snapshot_changes_nothing(db, checks, monkeypatch):
    await seed_onet(db)
    before = await state(db)
    job = await previewed(db)

    async def no_disk(*args, **kwargs):
        raise OSError("disk full")

    monkeypatch.setattr(snapshots, "create_snapshot", no_disk)
    done = await publishing.start_publish(job["job_id"], db=db, wait=True)
    assert done["status"] == jobs.FAILED and done.get("snapshot_id") is None
    assert await state(db) == before and not staging_left(await db.list_collection_names())


class SimulatedCrash(BaseException):
    """The process dies: nothing after this point runs (no rollback)."""


async def test_crash_between_the_two_renames_is_recovered(db, checks, monkeypatch):
    await seed_onet(db)
    before = await state(db)
    job = await previewed(db)

    async def crash():
        raise SimulatedCrash()

    monkeypatch.setattr(pipeline, "between_swaps_hook", crash)
    with pytest.raises(SimulatedCrash):
        await publishing.start_publish(job["job_id"], db=db, wait=True)
    monkeypatch.setattr(pipeline, "between_swaps_hook", lambda: asyncio.sleep(0))

    # Half-published: new professions, old ESCO skills, job still "publishing".
    assert (await jobs.get_job(job["job_id"], db=db))["status"] == jobs.PUBLISHING
    assert await docs(db, PROFESSIONS) != before[PROFESSIONS]
    assert await docs(db, ESCO_SKILLS) == before[ESCO_SKILLS]

    counts = await publishing.recover(db, at_startup=True)  # as at the next startup
    assert counts["rolled_back"] == 1
    job = await jobs.get_job(job["job_id"], db=db)
    assert job["status"] == jobs.ROLLED_BACK and "restored snapshot" in job["error"]
    assert await state(db) == before
    assert job["post_publish_checks"]["state_hash_ok"] is True
    assert not staging_left(await db.list_collection_names())


async def test_recovery_waits_while_the_publisher_holds_the_lock(db, checks):
    job = await previewed(db)
    await jobs.transition(job["job_id"], jobs.PUBLISHING, db=db)
    lock = await TaxonomyLock(f"cli:{job['job_id']}", job["job_id"], db).acquire()  # alive in another process
    try:
        assert await publishing.recover(db) == {"rolled_back": 0, "failed": 0, "skipped": 1}
        assert (await jobs.get_job(job["job_id"], db=db))["status"] == jobs.PUBLISHING
    finally:
        await lock.release()
    # Lock gone (holder died): no snapshot was taken → nothing live changed → failed.
    assert await publishing.recover(db) == {"rolled_back": 0, "failed": 1, "skipped": 0}


async def test_startup_recovery_spares_running_cli_previews(db, checks):
    service = (await jobs.create_job("onet", "O*NET 31.0", "admin-1", db=db))["job_id"]
    cli_job = (await jobs.create_job("onet", "O*NET 31.0", "cli", db=db))["job_id"]
    for job_id in (service, cli_job):
        await jobs.transition(job_id, jobs.VALIDATING, db=db)
    counts = await publishing.recover(db, at_startup=True)
    assert counts == {"rolled_back": 0, "failed": 1, "skipped": 1}
    assert (await jobs.get_job(cli_job, db=db))["status"] == jobs.VALIDATING


# ── restore ───────────────────────────────────────────────────────────────────
async def test_restore_a_snapshot(db, checks):
    await seed_onet(db)
    before = await state(db)
    job = await publishing.start_publish((await previewed(db))["job_id"], db=db, wait=True)
    after_publish = await state(db)
    assert after_publish != before

    preview_undo = await snapshots.undone_by_restore(job["snapshot_id"], db)
    assert [i["job_id"] for i in preview_undo["imports_undone"]] == [job["job_id"]]

    result = await publishing.restore(job["snapshot_id"], actor="admin-2", db=db)
    assert result["status"] == publishing.RESTORED and result["created_by"] == "admin-2"
    assert await state(db) == before
    assert result["result"]["post_restore_checks"]["state_hash_ok"] is True
    pre = await snapshots.get_snapshot(result["pre_restore_snapshot"], db)
    assert pre["reason"] == "pre-restore" and pre["created_by"] == "admin-2"
    # The restore itself can be undone.
    await publishing.restore(result["pre_restore_snapshot"], actor="admin-2", db=db)
    assert await state(db) == after_publish


async def test_restore_brings_back_data_files_and_reloads_them(db, checks):
    record = await snapshots.create_snapshot(db, reason="publish")
    aliases = snapshots.DATA_DIR / "skill_aliases.json"
    original = aliases.read_bytes()
    aliases.write_text('{"_comment": "", "canonical": {}}', encoding="utf8")
    await publishing.restore(record["snapshot_id"], db=db)
    assert aliases.read_bytes() == original


async def test_damaged_snapshot_is_refused(db, checks):
    await seed_onet(db)
    before = await state(db)
    record = await snapshots.create_snapshot(db, reason="publish")
    (Path(record["path"]) / "professions.jsonl.gz").write_bytes(b"tampered")
    result = await publishing.restore(record["snapshot_id"], db=db)
    # Verified before anything happens: failed, nothing changed, no pre-restore snapshot needed.
    assert result["status"] == publishing.RESTORE_FAILED and result["pre_restore_snapshot"] is None
    assert "professions.jsonl.gz is missing or damaged" in result["error"]
    assert await state(db) == before


async def test_restore_failing_part_way_puts_the_previous_state_back(db, checks, monkeypatch):
    await seed_onet(db)
    target = await snapshots.create_snapshot(db, reason="publish")
    await publishing.start_publish((await previewed(db))["job_id"], db=db, wait=True)
    current = await state(db)

    real_swap = snapshots.swap_in
    calls = {"n": 0}

    async def swap_then_fail(*args, **kwargs):
        calls["n"] += 1
        await real_swap(*args, **kwargs)
        if calls["n"] == 1:  # the restore of `target`; the rollback's own swap works
            raise RuntimeError("disk error after the swap")

    monkeypatch.setattr(snapshots, "swap_in", swap_then_fail)
    result = await publishing.restore(target["snapshot_id"], db=db)
    assert result["status"] == publishing.RESTORE_ROLLED_BACK
    assert result["error"] == "RuntimeError (details in the service error log)"
    assert await state(db) == current
    assert result["result"]["post_restore_checks"]["state_hash_ok"] is True


async def test_crashed_restore_is_recovered(db, checks, monkeypatch):
    await seed_onet(db)
    target = await snapshots.create_snapshot(db, reason="publish")
    await publishing.start_publish((await previewed(db))["job_id"], db=db, wait=True)
    current = await state(db)

    async def crash():
        raise SimulatedCrash()

    monkeypatch.setattr(pipeline, "between_swaps_hook", crash)
    with pytest.raises(SimulatedCrash):
        await publishing.restore(target["snapshot_id"], db=db)
    monkeypatch.setattr(pipeline, "between_swaps_hook", lambda: asyncio.sleep(0))
    crashed = (await db[publishing.RESTORES].find_one({"snapshot_id": target["snapshot_id"]}))
    assert crashed["status"] == publishing.RESTORING and await state(db) != current

    counts = await publishing.recover(db, at_startup=True)
    assert counts["rolled_back"] == 1
    assert (await publishing.get_restore(crashed["restore_id"], db))["status"] == publishing.RESTORE_ROLLED_BACK
    assert await state(db) == current


async def test_restore_needs_the_lock(db, checks):
    record = await snapshots.create_snapshot(db, reason="publish")
    lock = await TaxonomyLock("job:other", "other", db).acquire()
    try:
        with pytest.raises(TaxonomyBusy):
            await publishing.restore(record["snapshot_id"], db=db)
    finally:
        await lock.release()


async def test_retention_pools(db, checks, monkeypatch):
    monkeypatch.setattr(settings, "TAXONOMY_SNAPSHOTS_KEEP", 3)
    monkeypatch.setattr(settings, "TAXONOMY_EDIT_SNAPSHOTS_KEEP", 2)
    publish_ids = [(await snapshots.create_snapshot(db, reason="publish"))["snapshot_id"] for _ in range(5)]
    edit_ids = [(await snapshots.create_snapshot(db, reason="edit"))["snapshot_id"] for _ in range(4)]
    kept_publish = [s["snapshot_id"] for s in await snapshots.list_snapshots(db, pool="publish")]
    kept_edit = [s["snapshot_id"] for s in await snapshots.list_snapshots(db, pool="edit")]
    assert kept_publish == publish_ids[::-1][:3]  # edits never evict publish snapshots
    assert kept_edit == edit_ids[::-1][:2]
    on_disk = {p.name for p in snapshots.snapshots_root().iterdir()}
    assert on_disk == set(kept_publish) | set(kept_edit)
    assert "path" not in (await snapshots.list_snapshots(db))[0]


# ── CLI ───────────────────────────────────────────────────────────────────────
async def test_cli_publish_path(db, checks):
    job = await cli.publish_from_directory("esco", str(FIXTURES / "esco"), "1.2.1", db=db)
    assert job["status"] == jobs.PUBLISHED and job["created_by"] == "cli"
    assert await db[ESCO_SKILLS].count_documents({}) == 9


async def test_cli_refuses_a_failed_background_check(db, checks):
    checks["background_warning"] = True
    with pytest.raises(cli.BackgroundCheckFailed) as err:
        await cli.publish_from_directory("esco", str(FIXTURES / "esco"), "1.2.1", db=db)
    assert (await jobs.get_job(err.value.args[0], db=db))["status"] == jobs.CANCELLED
    assert await db[PROFESSIONS].count_documents({}) == 0
    job = await cli.publish_from_directory("esco", str(FIXTURES / "esco"), "1.2.1", db=db, acknowledge=True)
    assert job["status"] == jobs.PUBLISHED and job["background_acknowledged"] is True


async def test_ui_and_cli_publish_give_identical_live_data(db, checks):
    await seed_onet(db)
    start = await snapshots.create_snapshot(db, reason="publish")
    ui = await publishing.start_publish((await previewed(db))["job_id"], db=db, wait=True)
    ui_state = await state(db)
    await publishing.restore(start["snapshot_id"], db=db)
    via_cli = await cli.publish_from_directory("esco", str(FIXTURES / "esco"), "1.2.1", db=db)
    assert ui["status"] == via_cli["status"] == jobs.PUBLISHED
    assert await state(db) == ui_state


# ── routes ────────────────────────────────────────────────────────────────────
@pytest.fixture
def client(db, monkeypatch):
    from app.routes import taxonomy_routes

    monkeypatch.setattr(settings, "INTERNAL_API_KEY", "k-pub")
    app = FastAPI()
    app.include_router(taxonomy_routes.router)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://localhost")


async def test_publish_and_restore_routes(client, db, checks):
    checks["background_warning"] = True
    job = await previewed(db)
    url = f"/internal/admin/taxonomy/jobs/{job['job_id']}/publish"
    async with client as c:
        need_ack = await c.post(url, json={}, headers=KEY)
        assert need_ack.status_code == 422 and need_ack.json()["code"] == "BACKGROUND_ACK_REQUIRED"
        no_admin = await c.post(url, json={"acknowledge_background_warning": True}, headers={"X-Internal-Key": "k-pub"})
        assert no_admin.status_code == 400 and no_admin.json()["code"] == "ADMIN_ID_REQUIRED"
        # A spoofed actor in the body is ignored: published_by is the X-Admin-Id header.
        res = await c.post(url, json={"acknowledge_background_warning": True, "actor": "spoofed-admin"}, headers=KEY)
        assert res.status_code == 202 and res.json()["data"]["status"] == "publishing"
        await jobs.wait_for_background()
        done = (await c.get(f"/internal/admin/taxonomy/jobs/{job['job_id']}", headers=KEY)).json()["data"]
        assert done["status"] == "published" and done["published_by"] == "admin-7"
        again = await c.post(url, json={}, headers=KEY)
        assert again.status_code == 409 and again.json()["code"] == "JOB_STATE"

        listed = (await c.get("/internal/admin/taxonomy/snapshots", headers=KEY)).json()["data"]
        assert [s["snapshot_id"] for s in listed] == [done["snapshot_id"]]
        detail = (await c.get(f"/internal/admin/taxonomy/snapshots/{done['snapshot_id']}", headers=KEY)).json()["data"]
        assert detail["imports_undone"][0]["job_id"] == job["job_id"]
        assert detail["imports_undone"][0]["published_by"] == "admin-7"  # the restore dialog names the publisher
        restored = await c.post(f"/internal/admin/taxonomy/snapshots/{done['snapshot_id']}/restore",
                                json={"actor": "spoofed-admin", "created_by": "spoofed-admin"}, headers=KEY)
        assert restored.status_code == 202 and restored.json()["data"]["status"] == "restoring"
        restore_id = restored.json()["data"]["restore_id"]
        await jobs.wait_for_background()
        polled = (await c.get(f"/internal/admin/taxonomy/restores/{restore_id}", headers=KEY)).json()["data"]
        assert polled["status"] == "restored" and polled["created_by"] == "admin-7"
        assert "spoofed" not in str(polled)
        assert polled["result"]["post_restore_checks"]["state_hash_ok"] is True
        assert await db[ESCO_SKILLS].count_documents({}) == 0
        listed_restores = (await c.get("/internal/admin/taxonomy/restores", headers=KEY)).json()["data"]
        assert [r["restore_id"] for r in listed_restores] == [restore_id]
        assert (await c.get("/internal/admin/taxonomy/restores/nope", headers=KEY)).status_code == 404
        assert (await c.post("/internal/admin/taxonomy/snapshots/nope/restore", json={}, headers=KEY)).status_code == 404
        lock = await TaxonomyLock("job:x", "x", db).acquire()
        try:
            busy = await c.post(f"/internal/admin/taxonomy/snapshots/{done['snapshot_id']}/restore", json={}, headers=KEY)
            assert busy.status_code == 409 and busy.json()["code"] == "TAXONOMY_BUSY"
        finally:
            await lock.release()


async def test_sources_route(client, db, checks):
    await seed_onet(db)
    job = await previewed(db)
    await publishing.start_publish(job["job_id"], actor="admin-7", db=db, wait=True)
    async with client as c:
        res = await c.get("/internal/admin/taxonomy/sources", headers=KEY)
    data = res.json()["data"]
    assert res.status_code == 200 and res.json()["lock"] is None
    assert data["onet"]["versions"] == ["O*NET 31.0"] and data["onet"]["active"] == 2
    assert data["esco"]["versions"] == ["ESCO v1.2.1"] and data["esco"]["esco_skills"] == 9
    assert data["esco"]["last_published_job"]["job_id"] == job["job_id"]
    assert data["esco"]["last_published_job"]["created_by"] == "admin-1"
    assert "CC BY 4.0" in data["onet"]["attribution"] and "European Union" in data["esco"]["attribution"]
