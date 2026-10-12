"""
Legacy Word (.doc) → .docx conversion with LibreOffice headless (Table 4.2).

soffice is found via, in order:
  1. LIBREOFFICE_PATH (if it points to an existing file)
  2. `soffice` / `libreoffice` on PATH
  3. common install locations on Windows, Linux and macOS
Each conversion runs in a fresh temporary directory with its own LibreOffice
profile (so an already-open LibreOffice cannot block it), is limited to
DOC_CONVERT_TIMEOUT_SECONDS, and the directory is always removed afterwards.
"""

import glob
import logging
import os
import shutil
import subprocess
import tempfile
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator, Optional

from app.config.settings import settings

logger = logging.getLogger(__name__)

COMMON_PATHS = [
    r"C:\Program Files\LibreOffice\program\soffice.exe",
    r"C:\Program Files (x86)\LibreOffice\program\soffice.exe",
    "/usr/bin/soffice",
    "/usr/local/bin/soffice",
    "/usr/lib/libreoffice/program/soffice",
    "/opt/libreoffice*/program/soffice",
    "/snap/bin/libreoffice",
    "/Applications/LibreOffice.app/Contents/MacOS/soffice",
]


class DocConversionError(Exception):
    """Conversion was not possible. `missing` is True when LibreOffice isn't installed."""

    def __init__(self, reason: str, missing: bool = False):
        super().__init__(reason)
        self.reason = reason
        self.missing = missing


def find_soffice() -> Optional[str]:
    configured = (settings.LIBREOFFICE_PATH or "").strip().strip('"')
    if configured:
        if os.path.isfile(configured):
            return configured
        logger.warning("LIBREOFFICE_PATH is set but does not exist: %s", configured)
    for name in ("soffice", "libreoffice"):
        found = shutil.which(name)
        if found:
            return found
    for pattern in COMMON_PATHS:
        for candidate in sorted(glob.glob(pattern)) if "*" in pattern else [pattern]:
            if os.path.isfile(candidate):
                return candidate
    return None


@contextmanager
def converted_docx(doc_path: str) -> Iterator[str]:
    """Yields the path of a .docx converted from `doc_path`; cleans up on exit."""
    soffice = find_soffice()
    if not soffice:
        raise DocConversionError("LibreOffice (soffice) not found", missing=True)

    with tempfile.TemporaryDirectory(prefix="muqayyim-doc-") as tmp:
        source = Path(tmp) / "input.doc"
        shutil.copyfile(doc_path, source)
        profile_uri = (Path(tmp) / "lo-profile").as_uri()
        command = [
            soffice,
            "--headless",
            "--norestore",
            "--nologo",
            f"-env:UserInstallation={profile_uri}",
            "--convert-to",
            "docx",
            "--outdir",
            tmp,
            str(source),
        ]
        try:
            result = subprocess.run(
                command,
                capture_output=True,
                timeout=settings.DOC_CONVERT_TIMEOUT_SECONDS,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise DocConversionError(f"conversion timed out after {settings.DOC_CONVERT_TIMEOUT_SECONDS}s") from exc
        except OSError as exc:
            raise DocConversionError(f"could not start LibreOffice: {type(exc).__name__}") from exc

        output = Path(tmp) / "input.docx"
        if result.returncode != 0 or not output.is_file() or output.stat().st_size == 0:
            raise DocConversionError(f"conversion failed (exit code {result.returncode})")
        yield str(output)
