"""
The CLI importers' side of the shared pipeline (09c). A CLI run is an ordinary
import job with created_by = "cli": the dataset folder's files go through the
same upload, validation and preview code as an admin upload, so both paths give
the same result for the same input. CLI jobs get no AdminLog entry (CoreServices
is not involved); the job record is their audit trail.
"""

import asyncio
from pathlib import Path
from typing import Optional

from app.services.professions.imports import default_data_dir, default_version
from app.services.taxonomy import jobs, pipeline, uploads

CLI_ACTOR = "cli"


class LocalFile:
    """An async-readable local file, like an uploaded file part."""

    def __init__(self, path: Path):
        self.handle = open(path, "rb")

    async def read(self, n: int = -1) -> bytes:
        return await asyncio.to_thread(self.handle.read, n)

    def close(self) -> None:
        self.handle.close()


async def create_job_from_directory(source: str, data_dir: Optional[str] = None, version: Optional[str] = None,
                                    db=None, actor: str = CLI_ACTOR) -> dict:
    """Upload the expected files of `data_dir` as individual parts → the job (validation started)."""
    directory = Path(data_dir) if data_dir else default_data_dir(source)
    version = version or default_version(source)
    files = [LocalFile(p) for p in sorted(directory.glob("*.csv")) if uploads.expected_name(source, p.name)]
    try:
        return await uploads.create_upload_job(source, version, actor, [(f.handle.name, f) for f in files], db=db)
    finally:
        for f in files:
            f.close()


async def preview_from_directory(source: str, data_dir: Optional[str] = None, version: Optional[str] = None,
                                 db=None, actor: str = CLI_ACTOR) -> dict:
    """Upload → validate → preview, waiting for each step. → the job (validated-failed or previewed)."""
    job = await create_job_from_directory(source, data_dir, version, db, actor)
    await jobs.wait_for_background()
    job = await jobs.get_job(job["job_id"], db=db)
    if job["status"] != jobs.VALIDATED:
        return job
    await pipeline.start_preview(job["job_id"], db=db)
    await jobs.wait_for_background()
    return await jobs.get_job(job["job_id"], db=db)
