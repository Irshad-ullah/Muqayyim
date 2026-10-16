"""09c Part 9: the command-line importers (scripts/import_onet.py / import_esco.py through
scripts/_profession_cli.py) and the service's periodic recovery and clean-up loops.
The service functions underneath are tested in test_taxonomy_publish.py / _preview.py; these
tests cover the script layer: flags, exit codes, messages and what is left behind.
Test database and temporary folders only; the embedding model is not loaded."""

import argparse
import asyncio
import importlib.util
import os
import sys
from pathlib import Path

import pytest

from app.services.professions.store import ESCO_SKILLS, PROFESSIONS
from app.services.taxonomy import jobs, pipeline, publishing, uploads
from tests.db_fixtures import real_db  # noqa: F401 — pytest fixture
from tests.test_taxonomy_publish import FIXTURES, checks, db  # noqa: F401 — pytest fixtures

SCRIPT = Path(__file__).resolve().parents[2] / "scripts" / "_profession_cli.py"


@pytest.fixture
def script(monkeypatch):
    """The shared CLI module (it changes into the backend folder on import; restored after)."""
    cwd = os.getcwd()
    spec = importlib.util.spec_from_file_location("profession_cli_under_test", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    os.chdir(cwd)

    async def no_model(db):
        return None

    monkeypatch.setattr(module, "load_model", no_model)
    monkeypatch.setattr(module, "service_seems_running", lambda db: _false())
    return module


async def _false():
    return False


def args(**overrides) -> argparse.Namespace:
    values = {"dry_run": False, "data_dir": str(FIXTURES / "esco"), "version": "1.2.1", "actor": "cli",
              "i_understand_background_check": False}
    return argparse.Namespace(**{**values, **overrides})


async def staging_left(db) -> list:
    return [n for n in await db.list_collection_names() if pipeline.is_staging_collection(n)]


async def only_job(db) -> dict:
    found = [j async for j in db[jobs.JOBS].find({})]
    assert len(found) == 1
    return found[0]


async def test_dry_run_writes_nothing_live_and_cancels_its_job(script, db, checks, capsys):  # noqa: F811
    assert await script.dry_run("esco", args(dry_run=True), db) == 0
    job = await only_job(db)
    assert job["created_by"] == "cli" and job["status"] == jobs.CANCELLED
    assert await db[PROFESSIONS].count_documents({}) == 0 and await db[ESCO_SKILLS].count_documents({}) == 0
    assert await staging_left(db) == []  # the staged data went with the cancel
    out = capsys.readouterr().out
    assert '"status": "previewed"' in out and '"diff_summary"' in out  # the report shows the preview


async def test_dry_run_reports_a_failed_validation(script, db, checks, tmp_path, capsys):  # noqa: F811
    partial = tmp_path / "esco"
    partial.mkdir()
    (partial / "occupations_en.csv").write_bytes((FIXTURES / "esco" / "occupations_en.csv").read_bytes())
    assert await script.dry_run("esco", args(dry_run=True, data_dir=str(partial)), db) == 1
    err = capsys.readouterr().err
    assert "Dry run failed: Missing required file(s)" in err and "skills_en.csv" in err


async def test_publish_refuses_a_failed_background_check_without_the_flag(script, db, checks, capsys):  # noqa: F811
    checks["background_warning"] = True
    assert await script.publish("esco", args(), db) == 1
    assert "--i-understand-background-check" in capsys.readouterr().err
    assert (await only_job(db))["status"] == jobs.CANCELLED
    assert await db[PROFESSIONS].count_documents({}) == 0


async def test_publish_with_the_flag_publishes_and_records_the_acknowledgement(script, db, checks, capsys):  # noqa: F811
    checks["background_warning"] = True
    assert await script.publish("esco", args(i_understand_background_check=True), db) == 0
    job = await only_job(db)
    assert job["status"] == jobs.PUBLISHED and job["background_acknowledged"] is True and job["created_by"] == "cli"
    assert job["snapshot_id"]  # a snapshot was taken first, as for an admin publish
    assert await db[ESCO_SKILLS].count_documents({}) == 9
    assert "out of date" not in capsys.readouterr().err  # no running service


async def test_publish_warns_when_the_service_is_running(script, db, checks, capsys, monkeypatch):  # noqa: F811
    async def running(db):
        return True

    monkeypatch.setattr(script, "service_seems_running", running)
    assert await script.publish("esco", args(), db) == 0
    assert "in-memory index is now out of date" in capsys.readouterr().err


async def test_publish_refused_while_the_lock_is_held(script, db, checks, capsys):  # noqa: F811
    from app.services.taxonomy.lock import TaxonomyLock

    lock = await TaxonomyLock("job:other", "other", db, actor="admin-1").acquire()
    try:
        assert await script.publish("esco", args(), db) == 1
    finally:
        await lock.release()
    assert "Refused:" in capsys.readouterr().err
    assert await db[PROFESSIONS].count_documents({}) == 0


def test_command_line_flags_reach_the_run(script, monkeypatch):
    seen = {}

    async def fake_run(source, parsed):
        seen.update(source=source, args=parsed)
        return 0

    monkeypatch.setattr(script, "run", fake_run)
    monkeypatch.setattr(sys, "argv", ["import_esco.py", "--dry-run", "--data-dir", "x", "--version", "v",
                                      "--i-understand-background-check"])
    with pytest.raises(SystemExit) as exit_:
        script.main("esco", "doc")
    assert exit_.value.code == 0
    parsed = seen["args"]
    assert seen["source"] == "esco" and parsed.dry_run and parsed.i_understand_background_check
    assert (parsed.data_dir, parsed.version, parsed.actor) == ("x", "v", "cli")


# ── the service's periodic loops ──────────────────────────────────────────────
async def _calls_until(loop_coro, counter: list, n: int) -> None:
    task = asyncio.create_task(loop_coro)
    try:
        for _ in range(200):
            if len(counter) >= n:
                return
            await asyncio.sleep(0.01)
        raise AssertionError(f"loop ran {len(counter)} times, expected {n}")
    finally:
        task.cancel()


async def test_recovery_loop_runs_periodically_and_survives_a_failure(monkeypatch):
    """Recovery every TAXONOMY_RECOVERY_INTERVAL_SECONDS rescues a publish whose process died
    while the service keeps running (e.g. a CLI publish); one failed round must not stop it."""
    calls = []

    async def recover(db=None):
        calls.append(1)
        if len(calls) == 1:
            raise RuntimeError("database blip")

    monkeypatch.setattr(publishing, "recover", recover)
    await _calls_until(publishing.run_recovery(None, interval=0.01), calls, 3)


async def test_cleanup_loop_runs_periodically_and_survives_a_failure(monkeypatch):
    calls = []

    async def cleanup(db=None):
        calls.append(1)
        if len(calls) == 1:
            raise OSError("folder in use")

    monkeypatch.setattr(uploads, "cleanup_staging", cleanup)
    await _calls_until(uploads.run_cleanup(None, interval=0.01), calls, 3)
