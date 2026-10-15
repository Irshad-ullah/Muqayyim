"""09c Part 2: upload, staging, ZIP safety, validation, cancel and cleanup."""

import io
import os
import stat
import time
import zipfile
from pathlib import Path

import httpx
import pytest
from fastapi import FastAPI

from app.config.settings import settings
from app.services.taxonomy import jobs, uploads
from tests.db_fixtures import real_db  # noqa: F401 — pytest fixture

FIXTURES = Path(__file__).parent / "fixtures"
ONET_FILES = ["occupation_data.csv", "job_titles.csv", "software_skills.csv"]
KEY = {"X-Internal-Key": "k-up"}


@pytest.fixture
async def db(real_db, tmp_path, monkeypatch):  # noqa: F811
    monkeypatch.setattr(settings, "TAXONOMY_WORK_DIR", str(tmp_path / "work"))
    await jobs.ensure_job_indexes(real_db)
    yield real_db
    await jobs.wait_for_background()


def make_zip(entries, folder=""):
    """entries: {name: bytes}; returns the ZIP bytes."""
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, data in entries.items():
            archive.writestr(folder + name, data)
    return buffer.getvalue()


def onet_entries(**overrides):
    entries = {name: (FIXTURES / "onet" / name).read_bytes() for name in ONET_FILES}
    entries.update(overrides)
    return entries


def esco_entries():
    return {p.name: p.read_bytes() for p in (FIXTURES / "esco").glob("*.csv")}


class Upload:
    """An async-readable stand-in for an uploaded file."""

    def __init__(self, data: bytes):
        self.buffer = io.BytesIO(data)

    async def read(self, n=-1):
        return self.buffer.read(n)


async def upload_job(db, source, data, name="dataset.zip", version=None):
    version = version or ("O*NET 31.0" if source == "onet" else "ESCO v1.2.1")
    job = await uploads.create_upload_job(source, version, "admin-1", [(name, Upload(data))], db=db)
    await jobs.wait_for_background()
    return await jobs.get_job(job["job_id"], db=db)


def staging_dirs():
    root = uploads.staging_root()
    return [p for p in root.iterdir() if p.is_dir()]


# ── accepted uploads ──────────────────────────────────────────────────────────
async def test_onet_zip_is_staged_and_validated(db):
    job = await upload_job(db, "onet", make_zip(onet_entries(**{"README.txt": b"x", "Abilities.csv": b"a,b\n1,2\n"})))
    assert job["status"] == jobs.VALIDATED, job.get("validation_errors")
    summary = job["file_summary"]
    assert summary["mode"] == "zip" and summary["zip_entries"] == 5
    assert set(summary["files"]) == set(ONET_FILES)
    # Extra files are skipped, not rejected; only counted (names are not kept).
    assert summary["ignored_count"] == 2 and "ignored" not in summary
    assert "Abilities" not in str(job) and "README" not in str(job)
    assert summary["validated_files"]["occupation_data.csv"]["rows"] == 5
    # Staged inside the work dir (outside the repo), only the expected files.
    staged = Path(job["staging_dir"])
    assert staged.parent == uploads.staging_root() and len(staged.name) == 32
    assert sorted(p.name for p in staged.iterdir()) == sorted(ONET_FILES)
    assert "staging_dir" not in jobs.public(job)


async def test_zip_with_a_top_level_folder(db):
    job = await upload_job(db, "esco", make_zip(esco_entries(), folder="ESCO dataset - v1.2.1/"))
    assert job["status"] == jobs.VALIDATED, job.get("validation_errors")
    # ESCO names are staged with "_en" whatever the upload used.
    assert set(job["file_summary"]["files"]) == {
        "occupations_en.csv", "skills_en.csv", "occupationSkillRelations_en.csv", "digitalSkillsCollection_en.csv"}


async def test_esco_digital_collection_is_optional(db):
    entries = {k: v for k, v in esco_entries().items() if not k.startswith("digital")}
    job = await upload_job(db, "esco", make_zip(entries))
    assert job["status"] == jobs.VALIDATED
    assert job["file_summary"]["validated_files"]["_notes"] == {"optional_missing": ["digitalSkillsCollection"]}


async def test_individual_csv_files(db):
    files = [(name, Upload((FIXTURES / "onet" / name).read_bytes())) for name in ONET_FILES]
    files.append(("notes.txt", Upload(b"ignored")))
    job = await uploads.create_upload_job("onet", "31.0", "admin-1", files, db=db)
    await jobs.wait_for_background()
    job = await jobs.get_job(job["job_id"], db=db)
    assert job["status"] == jobs.VALIDATED and job["file_summary"]["mode"] == "files"
    assert job["dataset_version"] == "O*NET 31.0" and job["file_summary"]["ignored_count"] == 1


@pytest.mark.parametrize("source, typed, label", [
    ("onet", "31.0", "O*NET 31.0"), ("onet", "o*net 31.0", "O*NET 31.0"),
    ("esco", "1.2.1", "ESCO v1.2.1"), ("esco", "ESCO v1.2.1", "ESCO v1.2.1"), ("esco", "v1.2", "ESCO v1.2"),
])
def test_version_labels(source, typed, label):
    assert uploads.version_label(source, typed)[0] == label


@pytest.mark.parametrize("source, typed", [("onet", "latest"), ("esco", "1.2.1; drop"), ("onet", "")])
def test_bad_version_labels(source, typed):
    with pytest.raises(uploads.UploadRejected):
        uploads.version_label(source, typed)


# ── validation failures (stored in the job) ──────────────────────────────────
async def test_missing_file_and_wrong_columns(db):
    entries = onet_entries()
    del entries["job_titles.csv"]
    entries["software_skills.csv"] = b"O*NET-SOC Code,Example\n15-1252.00,Python\n"
    job = await upload_job(db, "onet", make_zip(entries))
    assert job["status"] == jobs.FAILED and job["error"] == "Validation failed"
    errors = job["validation_errors"]
    assert errors[0] == ("Missing required file(s): job_titles.csv. O*NET needs occupation_data.csv, "
                         "job_titles.csv, software_skills.csv.")
    assert any(e.startswith("software_skills.csv: missing column(s)") for e in errors)
    assert job.get("staging_dir") is None and staging_dirs() == []  # deleted on failure


async def test_wrong_source_files(db):
    job = await upload_job(db, "esco", make_zip(onet_entries()))  # O*NET files uploaded as ESCO
    assert job["status"] == jobs.FAILED
    assert job["file_summary"]["files"] == {} and job["file_summary"]["ignored_count"] == 3
    assert job["validation_errors"] == [
        "Missing required file(s): occupations_en.csv, skills_en.csv, occupationSkillRelations_en.csv. "
        "ESCO needs occupations_en.csv, skills_en.csv, occupationSkillRelations_en.csv "
        "(optional: digitalSkillsCollection_en.csv)."]


async def test_missing_file_errors_name_only_the_required_files(db):
    entries = {k: v for k, v in esco_entries().items() if not k.startswith(("skills", "occupationSkill"))}
    job = await upload_job(db, "esco", make_zip(entries))
    assert job["validation_errors"] == [
        "Missing required file(s): skills_en.csv, occupationSkillRelations_en.csv. ESCO needs occupations_en.csv, "
        "skills_en.csv, occupationSkillRelations_en.csv (optional: digitalSkillsCollection_en.csv)."]
    assert "staging" not in str(job["validation_errors"]) and ".muqayyim" not in str(job["validation_errors"])


async def test_only_required_files_are_extracted(db):
    job = await upload_job(db, "onet", make_zip(onet_entries(**{"Abilities.csv": b"a,b\n1,2\n", "Skills.csv": b"s\n1\n"})))
    assert sorted(p.name for p in Path(job["staging_dir"]).iterdir()) == sorted(ONET_FILES)


async def test_not_utf8_and_empty_files(db):
    entries = onet_entries(**{"occupation_data.csv": "O*NET-SOC Code,Title,Description\n15-1252.00,Caf\xe9,x\n".encode("latin-1"),
                              "job_titles.csv": b"O*NET-SOC Code,Title,Job Title,Short Title,Source(s)\n"})
    job = await upload_job(db, "onet", make_zip(entries))
    errors = job["validation_errors"]
    assert job["status"] == jobs.FAILED
    assert any(e.startswith("occupation_data.csv: not UTF-8") for e in errors)
    assert "job_titles.csv: no data rows" in errors
    assert "Caf" not in str(errors)  # no file contents in the errors


# ── rejected uploads (unsafe / too large): failed job + 413 / 422 ────────────
def zip_with_info(info: zipfile.ZipInfo, data: bytes = b"x") -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, content in onet_entries().items():
            archive.writestr(name, content)
        archive.writestr(info, data)
    return buffer.getvalue()


@pytest.mark.parametrize("name", ["../evil.csv", "data/../../evil.csv", "/etc/evil.csv", "C:/evil.csv",
                                  "..\\evil.csv", "C:\\Windows\\evil.csv"])
async def test_zip_slip_is_rejected(db, name):
    with pytest.raises(uploads.UploadRejected) as err:
        await upload_job(db, "onet", zip_with_info(zipfile.ZipInfo(name)))
    assert err.value.code == "ZIP_UNSAFE" and err.value.status == 422
    job = await jobs.get_job(err.value.job_id, db=db)
    assert job["status"] == jobs.FAILED and "unsafe ZIP entries" in job["validation_errors"][0]
    assert staging_dirs() == []
    assert not (uploads.work_dir() / "evil.csv").exists() and not (uploads.staging_root() / "evil.csv").exists()


async def test_symlink_entry_is_rejected(db):
    info = zipfile.ZipInfo("link.csv")
    info.external_attr = (stat.S_IFLNK | 0o777) << 16
    with pytest.raises(uploads.UploadRejected) as err:
        await upload_job(db, "onet", zip_with_info(info, b"/etc/passwd"))
    assert err.value.code == "ZIP_UNSAFE" and "symbolic link" in err.value.errors[0]


async def test_zip_bomb_is_rejected(db, monkeypatch):
    monkeypatch.setattr(settings, "TAXONOMY_MAX_UNZIPPED_MB", 1)
    bomb = make_zip(onet_entries(**{"filler.bin": b"\0" * (3 * 1024 * 1024)}))  # tiny compressed, 3 MB expanded
    assert len(bomb) < 100_000
    with pytest.raises(uploads.UploadRejected) as err:
        await upload_job(db, "onet", bomb)
    assert err.value.code == "ZIP_TOO_LARGE" and err.value.status == 413
    assert staging_dirs() == []


async def test_too_many_entries(db, monkeypatch):
    monkeypatch.setattr(settings, "TAXONOMY_MAX_ZIP_ENTRIES", 5)
    entries = onet_entries(**{f"extra{i}.txt": b"x" for i in range(5)})
    with pytest.raises(uploads.UploadRejected) as err:
        await upload_job(db, "onet", make_zip(entries))
    assert err.value.code == "ZIP_TOO_MANY_ENTRIES"


async def test_duplicate_expected_file(db):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        for name, data in onet_entries().items():
            archive.writestr(name, data)
        archive.writestr("copy/occupation_data.csv", onet_entries()["occupation_data.csv"])
    with pytest.raises(uploads.UploadRejected) as err:
        await upload_job(db, "onet", buffer.getvalue())
    assert err.value.code == "ZIP_DUPLICATE"


async def test_upload_size_limit_while_copying(db, monkeypatch):
    monkeypatch.setattr(settings, "TAXONOMY_MAX_UPLOAD_MB", 1)
    with pytest.raises(uploads.UploadRejected) as err:
        await upload_job(db, "onet", os.urandom(1024 * 1024 + 10))
    assert err.value.status == 413 and err.value.code == "UPLOAD_TOO_LARGE"
    assert staging_dirs() == []


async def test_not_a_zip(db):
    with pytest.raises(uploads.UploadRejected) as err:
        await upload_job(db, "onet", b"this is not a zip")
    assert "not a valid ZIP" in err.value.errors[0]


async def test_zip_and_csv_together_rejected(db):
    with pytest.raises(uploads.UploadRejected):
        await uploads.create_upload_job("onet", "31.0", "admin-1",
                                        [("a.zip", Upload(b"")), ("occupation_data.csv", Upload(b""))], db=db)


# ── cancel and cleanup ────────────────────────────────────────────────────────
async def test_cancel_deletes_staging(db):
    job = await upload_job(db, "onet", make_zip(onet_entries()))
    assert staging_dirs()
    cancelled = await uploads.cancel_job(job["job_id"], db=db)
    assert cancelled["status"] == jobs.CANCELLED and staging_dirs() == []
    with pytest.raises(jobs.JobStateError):
        await uploads.cancel_job(job["job_id"], db=db)


async def test_cleanup(db):
    fresh = await upload_job(db, "onet", make_zip(onet_entries()))
    old = await upload_job(db, "onet", make_zip(onet_entries()))
    finished = await upload_job(db, "onet", make_zip(onet_entries()))
    # A finished job whose directory is still there (e.g. a crash before deleting it).
    await db[jobs.JOBS].update_one({"job_id": finished["job_id"]}, {"$set": {"status": jobs.PUBLISHED}})
    orphan = uploads.staging_root() / ("f" * 32)
    orphan.mkdir()
    day_ago = time.time() - 25 * 3600
    for path in (Path(old["staging_dir"]), orphan):
        os.utime(path, (day_ago, day_ago))

    counts = await uploads.cleanup_staging(db)
    assert counts == {"removed": 3, "expired_jobs": 1, "staging_collections_dropped": 0}
    assert [p.name for p in staging_dirs()] == [Path(fresh["staging_dir"]).name]
    expired = await jobs.get_job(old["job_id"], db=db)
    assert expired["status"] == jobs.CANCELLED and "Expired after 24 h" in expired["progress"]["message"]
    assert (await jobs.get_job(fresh["job_id"], db=db))["status"] == jobs.VALIDATED


async def test_cleanup_never_touches_running_jobs(db):
    job = await upload_job(db, "onet", make_zip(onet_entries()))
    await db[jobs.JOBS].update_one({"job_id": job["job_id"]}, {"$set": {"status": jobs.PREVIEWING}})
    day_ago = time.time() - 25 * 3600
    os.utime(job["staging_dir"], (day_ago, day_ago))
    assert (await uploads.cleanup_staging(db))["removed"] == 0
    assert Path(job["staging_dir"]).is_dir()


def test_remove_staging_only_inside_the_root(tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "TAXONOMY_WORK_DIR", str(tmp_path / "work"))
    outside = tmp_path / "precious"
    outside.mkdir()
    assert uploads.remove_staging(str(outside)) is False and outside.is_dir()
    assert uploads.remove_staging(str(uploads.staging_root())) is False


# ── routes ────────────────────────────────────────────────────────────────────
@pytest.fixture
def client(db, monkeypatch):
    from app.routes import taxonomy_routes

    monkeypatch.setattr(settings, "INTERNAL_API_KEY", "k-up")
    app = FastAPI()
    app.include_router(taxonomy_routes.router)
    return httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://localhost")


async def test_upload_route(client, db):
    async with client as c:
        res = await c.post("/internal/admin/taxonomy/jobs", headers=KEY,
                           data={"source": "onet", "dataset_version": "O*NET 31.0", "created_by": "admin-9"},
                           files={"files": ("db_31_0_csv.zip", make_zip(onet_entries()), "application/zip")})
        assert res.status_code == 202, res.text
        job_id = res.json()["data"]["job_id"]
        await jobs.wait_for_background()
        polled = (await c.get(f"/internal/admin/taxonomy/jobs/{job_id}", headers=KEY)).json()["data"]
        assert polled["status"] == "validated" and polled["created_by"] == "admin-9"

        bad = await c.post("/internal/admin/taxonomy/jobs", headers=KEY, data={"source": "onet", "dataset_version": "31.0"},
                           files={"files": ("x.zip", zip_with_info(zipfile.ZipInfo("../evil.csv")), "application/zip")})
        assert bad.status_code == 422 and bad.json()["code"] == "ZIP_UNSAFE" and bad.json()["job_id"]

        cancel = await c.post(f"/internal/admin/taxonomy/jobs/{job_id}/cancel", headers=KEY)
        assert cancel.status_code == 200 and cancel.json()["data"]["status"] == "cancelled"
        again = await c.post(f"/internal/admin/taxonomy/jobs/{job_id}/cancel", headers=KEY)
        assert again.status_code == 409 and again.json()["code"] == "JOB_STATE"


async def test_upload_route_size_limit(client, db, monkeypatch):
    monkeypatch.setattr(settings, "TAXONOMY_MAX_UPLOAD_MB", 1)
    async with client as c:
        res = await c.post("/internal/admin/taxonomy/jobs", headers=KEY, data={"source": "onet", "dataset_version": "31.0"},
                           files={"files": ("big.zip", os.urandom(2 * 1024 * 1024 + 10), "application/zip")})
        assert res.status_code == 413 and res.json()["code"] == "UPLOAD_TOO_LARGE"
        assert await db[jobs.JOBS].count_documents({}) == 0  # refused before reading the body
