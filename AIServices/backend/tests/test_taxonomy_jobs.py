"""09c Part 1: import jobs, the taxonomy lock with heartbeat, recovery and the poll routes."""

import asyncio
from datetime import datetime, timedelta, timezone

import httpx
import pytest
from fastapi import FastAPI

from app.config.settings import settings
from app.services.taxonomy import jobs
from app.services.taxonomy.heartbeat import HEARTBEATS, SERVICE_ID, beat, service_seems_running
from app.services.taxonomy.lock import LOCK_ID, LOCKS, TaxonomyBusy, TaxonomyLock, current_lock, taxonomy_lock
from tests.db_fixtures import real_db  # noqa: F401 — pytest fixture


@pytest.fixture
async def db(real_db):  # noqa: F811
    await jobs.ensure_job_indexes(real_db)
    yield real_db
    await jobs.wait_for_background()


# ── jobs ──────────────────────────────────────────────────────────────────────
async def test_create_and_get_job(db):
    job = await jobs.create_job("onet", "O*NET 31.0", "admin-1", {"files": ["occupation_data.csv"]}, db=db)
    stored = await jobs.get_job(job["job_id"], db=db)
    assert stored["status"] == jobs.UPLOADED and stored["created_by"] == "admin-1"
    assert stored["dataset_version"] == "O*NET 31.0" and stored["file_summary"] == {"files": ["occupation_data.csv"]}
    assert [e["to"] for e in stored["events"]] == [jobs.UPLOADED]
    assert "_id" not in jobs.public(stored)
    with pytest.raises(jobs.JobNotFound):
        await jobs.get_job("nope", db=db)
    with pytest.raises(ValueError):
        await jobs.create_job("linkedin", "x", "admin-1", db=db)


async def test_lifecycle_transitions(db):
    job_id = (await jobs.create_job("esco", "ESCO v1.2.1", "admin-1", db=db))["job_id"]
    for status in (jobs.VALIDATING, jobs.VALIDATED, jobs.PREVIEWING, jobs.PREVIEWED, jobs.PUBLISHING, jobs.PUBLISHED):
        job = await jobs.transition(job_id, status, note=f"to {status}", db=db)
        assert job["status"] == status and job["progress"] == {"step": status, "message": f"to {status}"}
    assert len(job["events"]) == 7
    # A published job is final.
    with pytest.raises(jobs.JobStateError) as err:
        await jobs.transition(job_id, jobs.CANCELLED, db=db)
    assert err.value.status == jobs.PUBLISHED


@pytest.mark.parametrize("start, illegal", [
    (jobs.UPLOADED, jobs.PUBLISHING),     # cannot publish without validation and preview
    (jobs.UPLOADED, jobs.PREVIEWING),
    (jobs.VALIDATED, jobs.PUBLISHING),    # cannot publish without a preview (FR12.5)
])
async def test_illegal_transitions_are_refused(db, start, illegal):
    job_id = (await jobs.create_job("onet", "O*NET 31.0", "admin-1", db=db))["job_id"]
    path = {jobs.UPLOADED: [], jobs.VALIDATED: [jobs.VALIDATING, jobs.VALIDATED]}[start]
    for status in path:
        await jobs.transition(job_id, status, db=db)
    with pytest.raises(jobs.JobStateError):
        await jobs.transition(job_id, illegal, db=db)
    assert (await jobs.get_job(job_id, db=db))["status"] == start


async def test_concurrent_transitions_only_one_wins(db):
    job_id = (await jobs.create_job("onet", "O*NET 31.0", "admin-1", db=db))["job_id"]
    results = await asyncio.gather(*[jobs.transition(job_id, jobs.VALIDATING, db=db) for _ in range(5)],
                                   return_exceptions=True)
    assert sum(1 for r in results if isinstance(r, dict)) == 1
    assert sum(1 for r in results if isinstance(r, jobs.JobStateError)) == 4


async def test_list_jobs_paginates_newest_first(db):
    ids = [(await jobs.create_job("onet" if i % 2 else "esco", "v", "admin-1", db=db))["job_id"] for i in range(5)]
    page = await jobs.list_jobs(page=1, limit=2, db=db)
    assert page["total"] == 5 and page["pages"] == 3
    assert [j["job_id"] for j in page["items"]] == [ids[4], ids[3]]
    assert "events" not in page["items"][0]
    assert (await jobs.list_jobs(source="onet", db=db))["total"] == 2


async def test_background_failure_is_recorded_without_details(db):
    job_id = (await jobs.create_job("onet", "O*NET 31.0", "admin-1", db=db))["job_id"]
    await jobs.transition(job_id, jobs.VALIDATING, db=db)

    async def boom():
        raise RuntimeError("row 17: secret,contents,of,the,file")

    await jobs.run_in_background(job_id, boom, db=db)
    job = await jobs.get_job(job_id, db=db)
    assert job["status"] == jobs.FAILED
    assert job["error"] == "RuntimeError (details in the service error log)"
    assert "secret" not in str(jobs.public(job))


async def test_dataset_errors_are_shown_verbatim(db):
    from app.services.professions.csv_io import DatasetError

    job_id = (await jobs.create_job("onet", "O*NET 31.0", "admin-1", db=db))["job_id"]
    await jobs.transition(job_id, jobs.VALIDATING, db=db)

    async def bad():
        raise DatasetError("missing file: job_titles.csv")

    await jobs.run_in_background(job_id, bad, db=db)
    assert (await jobs.get_job(job_id, db=db))["error"] == "missing file: job_titles.csv"


async def test_recovery_after_restart(db):
    running = {}
    for status, path in {
        jobs.VALIDATING: [jobs.VALIDATING],
        jobs.PREVIEWING: [jobs.VALIDATING, jobs.VALIDATED, jobs.PREVIEWING],
        jobs.PREVIEWED: [jobs.VALIDATING, jobs.VALIDATED, jobs.PREVIEWING, jobs.PREVIEWED],
    }.items():
        job_id = (await jobs.create_job("onet", "v", "admin-1", db=db))["job_id"]
        for s in path:
            await jobs.transition(job_id, s, db=db)
        running[status] = job_id
    counts = await jobs.recover_interrupted_jobs(db)
    assert counts == {"failed": 2, "publishing": 0}
    assert (await jobs.get_job(running[jobs.VALIDATING], db=db))["error"] == jobs.INTERRUPTED
    assert (await jobs.get_job(running[jobs.PREVIEWING], db=db))["status"] == jobs.FAILED
    assert (await jobs.get_job(running[jobs.PREVIEWED], db=db))["status"] == jobs.PREVIEWED  # waiting, not running


async def test_recovery_hands_publishing_jobs_to_the_handler(db):
    job_id = (await jobs.create_job("onet", "v", "admin-1", db=db))["job_id"]
    for s in (jobs.VALIDATING, jobs.VALIDATED, jobs.PREVIEWING, jobs.PREVIEWED, jobs.PUBLISHING):
        await jobs.transition(job_id, s, db=db)
    seen = []

    async def handler(job):
        seen.append(job["job_id"])

    assert await jobs.recover_interrupted_jobs(db, publishing_handler=handler) == {"failed": 0, "publishing": 1}
    assert seen == [job_id]


# ── lock ──────────────────────────────────────────────────────────────────────
async def test_lock_is_exclusive_and_released(db):
    async with taxonomy_lock("job:a", "a", db=db):
        with pytest.raises(TaxonomyBusy) as err:
            await TaxonomyLock("job:b", "b", db=db).acquire()
        assert err.value.current["owner"] == "job:a" and "holder" not in err.value.current
        assert (await current_lock(db))["job_id"] == "a"
    assert await current_lock(db) is None
    async with taxonomy_lock("job:b", "b", db=db):
        pass


async def test_lock_shows_who_holds_it(db):
    async with taxonomy_lock("edit:skill", None, db=db, actor="admin-7"):
        shown = await current_lock(db)
        assert shown["actor"] == "admin-7" and shown["owner"] == "edit:skill" and "holder" not in shown
        with pytest.raises(TaxonomyBusy) as err:
            await TaxonomyLock("job:b", "b", db=db).acquire()
        assert err.value.current["actor"] == "admin-7"


async def test_concurrent_acquire_only_one_wins(db):
    results = await asyncio.gather(*[TaxonomyLock(f"job:{i}", str(i), db=db).acquire() for i in range(5)],
                                   return_exceptions=True)
    winners = [r for r in results if isinstance(r, TaxonomyLock)]
    assert len(winners) == 1 and sum(isinstance(r, TaxonomyBusy) for r in results) == 4
    await winners[0].release()


async def test_heartbeat_renews_the_lock(db):
    lock = await TaxonomyLock("job:hb", "hb", db=db, ttl_seconds=2, heartbeat_seconds=0.2).acquire()
    try:
        first = (await db[LOCKS].find_one({"_id": LOCK_ID}))["expires_at"]
        await asyncio.sleep(0.6)
        later = (await db[LOCKS].find_one({"_id": LOCK_ID}))["expires_at"]
        assert later > first  # renewed while the job runs
        await asyncio.sleep(2.2)  # longer than the TTL: still held thanks to the heartbeat
        with pytest.raises(TaxonomyBusy):
            await TaxonomyLock("job:other", "other", db=db).acquire()
    finally:
        await lock.release()


async def test_dead_holders_lock_expires(db):
    # A process that died: its lock stays in the database but nobody renews it.
    dead = await TaxonomyLock("job:dead", "dead", db=db, ttl_seconds=1, heartbeat_seconds=60).acquire()
    dead._task.cancel()  # the process is gone: no more heartbeats
    with pytest.raises(TaxonomyBusy):
        await TaxonomyLock("job:new", "new", db=db).acquire()
    await asyncio.sleep(1.2)
    assert await current_lock(db) is None  # expired
    new = await TaxonomyLock("job:new", "new", db=db).acquire()
    assert (await current_lock(db))["owner"] == "job:new"
    # The dead holder can no longer renew or release the new holder's lock.
    assert await dead.renew() is False and dead.lost is True
    await dead.release()
    assert (await current_lock(db))["owner"] == "job:new"
    await new.release()


async def test_lock_ttl_defaults(db):
    assert settings.TAXONOMY_LOCK_TTL_SECONDS == 300 and settings.TAXONOMY_LOCK_HEARTBEAT_SECONDS == 60
    lock = await TaxonomyLock("job:d", "d", db=db).acquire()
    try:
        doc = await db[LOCKS].find_one({"_id": LOCK_ID})
        ttl = (doc["expires_at"] - doc["acquired_at"]).total_seconds()
        assert 299 <= ttl <= 301
    finally:
        await lock.release()


# ── service heartbeat ─────────────────────────────────────────────────────────
async def test_service_heartbeat(db):
    assert await service_seems_running(db) is False
    await beat(db)
    assert await service_seems_running(db) is True
    old = datetime.now(timezone.utc) - timedelta(seconds=10 * settings.SERVICE_HEARTBEAT_SECONDS)
    await db[HEARTBEATS].update_one({"_id": SERVICE_ID}, {"$set": {"at": old}})
    assert await service_seems_running(db) is False


# ── routes ────────────────────────────────────────────────────────────────────
KEY = {"X-Internal-Key": "k-tax"}


@pytest.fixture
def client(db, monkeypatch):
    from app.routes import taxonomy_routes

    monkeypatch.setattr(settings, "INTERNAL_API_KEY", "k-tax")
    app = FastAPI()
    app.include_router(taxonomy_routes.router)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://localhost")


async def test_routes(client, db):
    job_id = (await jobs.create_job("onet", "O*NET 31.0", "admin-1", db=db))["job_id"]
    async with client as c:
        assert (await c.get(f"/internal/admin/taxonomy/jobs/{job_id}")).status_code == 401
        assert (await c.get("/internal/admin/taxonomy/jobs", headers={"X-Internal-Key": "bad"})).status_code == 403
        res = await c.get(f"/internal/admin/taxonomy/jobs/{job_id}", headers=KEY)
        assert res.status_code == 200 and res.json()["data"]["status"] == "uploaded"
        missing = await c.get("/internal/admin/taxonomy/jobs/none", headers=KEY)
        assert missing.status_code == 404 and missing.json()["code"] == "NOT_FOUND"
        listed = (await c.get("/internal/admin/taxonomy/jobs", params={"status": "uploaded"}, headers=KEY)).json()
        assert listed["pagination"]["total"] == 1 and listed["data"][0]["job_id"] == job_id
        assert (await c.get("/internal/admin/taxonomy/jobs", params={"status": "bogus"}, headers=KEY)).status_code == 422
        assert (await c.get("/internal/admin/taxonomy/lock", headers=KEY)).json()["data"] is None
