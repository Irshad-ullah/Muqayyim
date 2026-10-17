"""Module 5.2: the curated roles as a taxonomy import source (validate → preview / diff → publish with snapshot →
post-checks → rollback, restore; the published dataset file in snapshots) and ESCO retirement through the pipeline
(deactivation with the retired reason, upload refused, re-enabling by restoring the pre-retirement snapshot).
Test database and temporary folders only."""

import copy
import io
import json
from pathlib import Path

import pytest

from app.services.professions import curated
from app.services.professions.store import PROFESSIONS
from app.services.taxonomy import jobs, pipeline, publishing, retirement, snapshots, uploads
from tests.db_fixtures import real_db  # noqa: F401 — pytest fixture
from tests.test_taxonomy_publish import checks, db, previewed  # noqa: F401 — fixtures and helpers

FIXTURE = Path(__file__).parent / "fixtures" / "curated" / "modern_roles_v1.json"


class Upload:
    def __init__(self, data: bytes):
        self.buffer = io.BytesIO(data)

    async def read(self, n=-1):
        return self.buffer.read(n)


def dataset(**changes) -> dict:
    doc = json.loads(FIXTURE.read_text(encoding="utf8"))
    for key, value in changes.items():
        doc[key] = value
    return doc


async def upload(db, doc, version="1.0.0") -> dict:
    job = await uploads.create_upload_job("curated", version, "admin-1",
                                          [("modern_roles_v1.json", Upload(json.dumps(doc).encode()))], db=db)
    await jobs.wait_for_background()
    return await jobs.get_job(job["job_id"], db)


async def preview(db, job) -> dict:
    await pipeline.start_preview(job["job_id"], db=db)
    await jobs.wait_for_background()
    return await jobs.get_job(job["job_id"], db)


# ── validation ────────────────────────────────────────────────────────────────
def test_the_validator_rules():
    good = dataset()
    errors, _ = curated.validate(good)
    assert errors == []
    bad = copy.deepcopy(good)
    role = bad["roles"][0]
    role["required_skills"][0]["any_of"] = ["use programming languages"]
    role["required_skills"][1]["any_of"] = ["Klingon Script"]
    role["required_skills"][2]["evidence"] = []
    role["related_onet_code"] = "15-1254"
    bad["roles"][1]["title"] = "Frontend Developer"
    bad["roles"][1]["required_skills"] = bad["roles"][1]["required_skills"][:7]
    text = " | ".join(curated.validate(bad)[0])
    for expected in ("vague phrase 'use programming languages'", "'Klingon Script' is not in the skill list", "has no evidence",
                     "bad related_onet_code", "duplicate title Frontend Developer", "7 requirements (need 8-15)"):
        assert expected in text, expected
    weak = copy.deepcopy(good)
    for q in weak["roles"][1]["required_skills"]:
        q["importance"] = "optional"
    weak["roles"][1]["required_skills"][0]["importance"] = "essential"
    assert curated.validate(weak)[1] == ["data-engineer: fewer than 3 essential requirements (weak evidence; review)"]


async def test_an_invalid_dataset_fails_validation(db):
    bad = dataset()
    bad["roles"][0]["required_skills"][0]["any_of"] = ["Klingon Script"]
    job = await upload(db, bad)
    assert job["status"] == jobs.FAILED and any("Klingon Script" in e for e in job["validation_errors"])
    mislabelled = await upload(db, dataset(), version="2.0.0")
    assert mislabelled["status"] == jobs.FAILED
    assert "the upload was labelled 'curated v2.0.0'" in mislabelled["validation_errors"][0]
    with pytest.raises(uploads.UploadRejected):
        await uploads.create_upload_job("curated", "not a version", "admin-1", [("x.json", Upload(b"{}"))], db=db)


# ── preview, publish, rollback, restore ───────────────────────────────────────
async def test_preview_and_publish(db, checks):
    job = await upload(db, dataset())
    assert job["status"] == jobs.VALIDATED and job["dataset_version"] == "curated v1.0.0"
    job = await preview(db, job)
    assert job["status"] == jobs.PREVIEWED
    added = {i["profession_id"] for i in (await pipeline.diff_page(job["job_id"], "professions_added", db=db))["items"]}
    assert added == {"curated:frontend-developer", "curated:data-engineer"}
    assert await db[PROFESSIONS].count_documents({"source": "curated"}) == 0  # preview writes nothing live
    done = await publishing.start_publish(job["job_id"], db=db, wait=True)
    assert done["status"] == jobs.PUBLISHED and done["snapshot_id"]
    front = await db[PROFESSIONS].find_one({"profession_id": "curated:frontend-developer"})
    assert front["active"] and front["source_version"] == "curated v1.0.0" and front["source"] == "curated"
    group = next(s for s in front["skills"] if s.get("alternatives"))
    assert group["name"] == "React" and [a["name"] for a in group["alternatives"]] == ["React", "Angular"]
    assert group["label"] == "React / Angular" and group["source"] == curated.GROUP_SOURCE
    assert (snapshots.DATA_DIR / curated.FILE_NAME).is_file()  # the published dataset of record
    assert snapshots.curated_dataset_hash() != "none"


async def test_a_failed_publish_rolls_back_and_leaves_no_dataset_file(db, checks):
    from app.services.professions.role_index import get_role_index

    job = await preview(db, await upload(db, dataset()))
    index = get_role_index()

    async def broken(*args, **kwargs):
        raise RuntimeError("index exploded")

    original = index.rebuild
    index.rebuild = broken
    try:
        done = await publishing.start_publish(job["job_id"], db=db, wait=True)
    finally:
        index.rebuild = original
    assert done["status"] == jobs.ROLLED_BACK
    assert await db[PROFESSIONS].count_documents({"source": "curated"}) == 0
    assert not (snapshots.DATA_DIR / curated.FILE_NAME).exists()  # the restore removed it again


async def test_restore_undoes_the_import_and_snapshots_carry_the_dataset_file(db, checks):
    done = await publishing.start_publish((await preview(db, await upload(db, dataset())))["job_id"], db=db, wait=True)
    after = await snapshots.create_snapshot(db, reason="publish")
    manifest = json.loads((Path(after["path"]) / "manifest.json").read_text(encoding="utf8"))
    assert f"data/{curated.FILE_NAME}" in manifest
    result = await publishing.restore(done["snapshot_id"], actor="admin-2", db=db)
    assert result["status"] == publishing.RESTORED
    assert await db[PROFESSIONS].count_documents({"source": "curated"}) == 0
    assert not (snapshots.DATA_DIR / curated.FILE_NAME).exists()
    await publishing.restore(after["snapshot_id"], actor="admin-2", db=db)
    assert await db[PROFESSIONS].count_documents({"source": "curated", "active": True}) == 2
    assert (snapshots.DATA_DIR / curated.FILE_NAME).is_file()


async def test_cli_imports_the_curated_folder(db, checks, tmp_path):
    from app.services.taxonomy import cli

    folder = tmp_path / "curated"
    folder.mkdir()
    (folder / "modern_roles_v1.json").write_text(FIXTURE.read_text(encoding="utf8"), encoding="utf8")
    (folder / "README.md").write_text("ignored", encoding="utf8")
    job = await cli.publish_from_directory("curated", str(folder), "1.0.0", db=db)
    assert job["status"] == jobs.PUBLISHED and job["created_by"] == "cli"
    assert await db[PROFESSIONS].count_documents({"source": "curated", "active": True}) == 2


# ── ESCO retirement ───────────────────────────────────────────────────────────
async def test_esco_retirement_and_re_enabling_by_restore(db, checks):
    # O*NET stays active after the retirement (an index with no professions at all would fail the publish).
    await publishing.start_publish((await previewed(db, "onet"))["job_id"], db=db, wait=True)
    await publishing.start_publish((await previewed(db, "esco"))["job_id"], db=db, wait=True)
    active_before = await db[PROFESSIONS].count_documents({"source": "esco", "active": True})
    assert active_before > 0 and not await retirement.source_retired("esco", db)

    job = await retirement.create_retirement_job("esco", "admin-1", db)
    assert job["status"] == jobs.VALIDATED and job["kind"] == "retire"
    job = await preview(db, job)
    assert job["status"] == jobs.PREVIEWED and job["diff_summary"]["counts"]["professions_removed"] == active_before
    assert await db[PROFESSIONS].count_documents({"source": "esco", "active": True}) == active_before  # nothing live yet
    done = await publishing.start_publish(job["job_id"], db=db, wait=True)
    assert done["status"] == jobs.PUBLISHED and done["snapshot_id"], (done.get("error"), done.get("post_publish_checks"))

    assert await db[PROFESSIONS].count_documents({"source": "esco", "active": True}) == 0
    reasons = await db[PROFESSIONS].distinct("inactive_reason", {"source": "esco"})
    assert retirement.RETIRED_REASON in reasons
    assert await db["esco_skills"].count_documents({}) > 0  # kept, dormant
    assert await retirement.source_retired("esco", db)
    with pytest.raises(uploads.UploadRejected) as refused:
        await uploads.create_upload_job("esco", "ESCO v1.2.1", "admin-1", [("x.zip", Upload(b""))], db=db)
    assert refused.value.code == "SOURCE_RETIRED" and refused.value.status == 409
    assert "restore the snapshot taken before the retirement" in refused.value.errors[0]
    assert (await retirement.retirement_snapshot("esco", db))["snapshot_id"] == done["snapshot_id"]
    with pytest.raises(retirement.RetirementRefused):
        await retirement.create_retirement_job("esco", "admin-1", db)

    restored = await publishing.restore(done["snapshot_id"], actor="admin-1", db=db)  # = re-enabling ESCO
    assert restored["status"] == publishing.RESTORED
    assert await db[PROFESSIONS].count_documents({"source": "esco", "active": True}) == active_before
    assert not await retirement.source_retired("esco", db)
