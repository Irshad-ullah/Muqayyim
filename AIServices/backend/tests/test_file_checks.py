"""
Stage 1 checks (Business Rule 1): magic bytes must match the extension,
encrypted files are refused, scanned/empty documents fail clearly, and .doc
goes through LibreOffice (or fails with DOC_UNSUPPORTED).
"""

import shutil
import subprocess
from contextlib import contextmanager
from pathlib import Path

import pytest

from app.services import doc_converter, error_logger
from app.services import cv_parser
from app.services.doc_converter import DocConversionError
from app.services.file_signature import detect_type
from tests.parse_env import make_env, record, statuses, upload, upload_and_parse
from tests.cv_fixtures import (
    PNG_BYTES,
    SAMPLE_CV_LINES,
    make_docx,
    make_encrypted_pdf,
    make_fake_doc,
    make_image_only_pdf,
    make_pdf,
)


@pytest.fixture
def env(monkeypatch, tmp_path):
    return make_env(monkeypatch, tmp_path)


# ── Magic bytes ──────────────────────────────────────────────────────────────
def test_detect_type():
    assert detect_type(make_pdf(["x"])) == "pdf"
    assert detect_type(make_docx(["x"])) == "docx"
    assert detect_type(make_fake_doc()) == "doc"
    assert detect_type(PNG_BYTES) == "unknown"
    assert detect_type(b"PK\x03\x04 not really a zip") == "unknown"


@pytest.mark.parametrize(
    "name, data",
    [
        ("cv.pdf", PNG_BYTES),            # renamed image
        ("cv.pdf", make_docx(["Hello"])),  # real DOCX with a .pdf extension
        ("cv.docx", make_pdf(["Hello"])),  # PDF named .docx
        ("cv.doc", make_docx(["Hello"])),  # DOCX named .doc
        ("cv.docx", PNG_BYTES),
    ],
    ids=["png-as-pdf", "docx-as-pdf", "pdf-as-docx", "docx-as-doc", "png-as-docx"],
)
def test_content_must_match_extension(env, name, data):
    res = upload(env, name, data)
    assert res.status_code == 400
    assert res.json() == {
        "success": False,
        "code": "INVALID_FILE_TYPE",
        "message": "The file content does not match its extension. Upload a PDF, DOC or DOCX file.",
    }
    assert statuses(env["notify"]) == []
    assert list(Path(env["dir"]).iterdir()) == []  # nothing stored


@pytest.mark.parametrize(
    "name, data",
    [("cv.pdf", make_pdf(SAMPLE_CV_LINES)), ("cv.docx", make_docx(SAMPLE_CV_LINES)), ("cv.doc", make_fake_doc())],
    ids=["pdf", "docx", "doc"],
)
def test_valid_files_are_accepted(env, name, data):
    res = upload(env, name, data)
    assert res.status_code == 200
    assert statuses(env["notify"]) == ["uploaded"]


def test_encrypted_pdf_is_refused(env):
    res = upload(env, "cv.pdf", make_encrypted_pdf())
    assert res.status_code == 400
    assert res.json()["code"] == "ENCRYPTED_FILE"


def test_encrypted_office_file_is_refused(env):
    data = bytes.fromhex("D0CF11E0A1B11AE1") + b"\x00" * 100 + "EncryptedPackage".encode("utf-16-le")
    res = upload(env, "cv.docx", data)
    assert res.status_code == 400
    assert res.json()["code"] == "ENCRYPTED_FILE"


def test_size_limit_still_applies(env):
    res = upload(env, "cv.pdf", b"%PDF-1.4\n" + b"0" * (5 * 1024 * 1024))
    assert res.status_code == 400


# ── Scanned / empty documents ────────────────────────────────────────────────
@pytest.mark.parametrize(
    "name, data",
    [("scan.pdf", make_image_only_pdf()), ("short.pdf", make_pdf(["Ali", "Lahore"])), ("empty.docx", make_docx([""]))],
    ids=["image-only-pdf", "too-little-text", "empty-docx"],
)
def test_no_text_found(env, name, data):
    res = upload_and_parse(env, name, data)
    assert res.status_code == 422
    body = res.json()
    assert body["code"] == "NO_TEXT_FOUND"
    assert body["message"] == (
        "No readable text was found. This may be a scanned document. Please upload a text-based PDF or DOCX."
    )
    assert statuses(env["notify"]) == ["uploaded", "processing", "failed"]
    assert record(env)["parsing_status"] == "failed"


# ── .doc via LibreOffice ─────────────────────────────────────────────────────
def test_doc_without_libreoffice_is_doc_unsupported(env, monkeypatch):
    monkeypatch.setattr(doc_converter, "find_soffice", lambda: None)
    calls = []
    real_log = error_logger.log_error
    monkeypatch.setattr(
        "app.routes.cv_routes.log_error", lambda **kw: calls.append(kw) or real_log(**{**kw, "dedupe_key": kw.get("dedupe_key")})
    )
    error_logger.reset_dedupe()

    for _ in range(2):
        res = upload_and_parse(env, "old.doc", make_fake_doc())
        assert res.status_code == 422
        assert res.json() == {
            "success": False,
            "code": "DOC_UNSUPPORTED",
            "message": "Old .doc files could not be processed. Please save as PDF or DOCX and upload again.",
        }
    assert record(env)["parsing_status"] == "failed"
    assert statuses(env["notify"])[-2:] == ["processing", "failed"]
    assert all(c["level"] == "warning" for c in calls)
    missing = [c for c in calls if c.get("error_type") == "LIBREOFFICE_MISSING"]
    assert len(missing) == 2 and all(c["dedupe_key"] == "libreoffice-missing" and c["dedupe_seconds"] == 60 for c in missing)


def test_doc_conversion_failure_is_doc_unsupported(env, monkeypatch):
    @contextmanager
    def broken(path):
        raise DocConversionError("conversion timed out after 30s")
        yield  # pragma: no cover

    monkeypatch.setattr(cv_parser, "converted_docx", broken)
    res = upload_and_parse(env, "old.doc", make_fake_doc())
    assert res.status_code == 422 and res.json()["code"] == "DOC_UNSUPPORTED"


def test_doc_is_parsed_through_the_docx_path(env, monkeypatch, tmp_path):
    converted = tmp_path / "converted.docx"
    converted.write_bytes(make_docx(SAMPLE_CV_LINES))
    seen = {}

    @contextmanager
    def fake_conversion(path):
        seen["source"] = path
        yield str(converted)

    monkeypatch.setattr(cv_parser, "converted_docx", fake_conversion)
    res = upload_and_parse(env, "old.doc", make_fake_doc())
    assert res.status_code == 200, res.text
    assert seen["source"].endswith(".doc")
    data = res.json()["parsed_data"]
    assert data["experience"][0]["company"] == "Systems Ltd"
    assert statuses(env["notify"]) == ["uploaded", "processing", "parsed"]


def test_find_soffice_prefers_libreoffice_path(monkeypatch, tmp_path):
    exe = tmp_path / "soffice.exe"
    exe.write_bytes(b"")
    monkeypatch.setattr(doc_converter.settings, "LIBREOFFICE_PATH", str(exe))
    assert doc_converter.find_soffice() == str(exe)
    monkeypatch.setattr(doc_converter.settings, "LIBREOFFICE_PATH", str(tmp_path / "missing.exe"))
    monkeypatch.setattr(doc_converter.shutil, "which", lambda name: None)
    monkeypatch.setattr(doc_converter, "COMMON_PATHS", [])
    assert doc_converter.find_soffice() is None


def test_conversion_temp_directory_is_removed(monkeypatch, tmp_path):
    used = {}

    def fake_run(command, **kwargs):
        outdir = Path(command[command.index("--outdir") + 1])
        used["dir"] = outdir
        (outdir / "input.docx").write_bytes(make_docx(["x"]))
        return subprocess.CompletedProcess(command, 0)

    monkeypatch.setattr(doc_converter, "find_soffice", lambda: "soffice")
    monkeypatch.setattr(doc_converter.subprocess, "run", fake_run)
    source = tmp_path / "a.doc"
    source.write_bytes(make_fake_doc())
    with doc_converter.converted_docx(str(source)) as path:
        assert Path(path).is_file()
    assert not used["dir"].exists()


@pytest.mark.skipif(doc_converter.find_soffice() is None, reason="LibreOffice is not installed")
def test_real_doc_parses_with_libreoffice(env, tmp_path):
    # Make a genuine .doc from a DOCX with LibreOffice itself.
    source = tmp_path / "cv.docx"
    source.write_bytes(make_docx(SAMPLE_CV_LINES))
    subprocess.run(
        [doc_converter.find_soffice(), "--headless", "--convert-to", "doc", "--outdir", str(tmp_path), str(source)],
        check=True,
        timeout=60,
        capture_output=True,
    )
    res = upload_and_parse(env, "cv.doc", (tmp_path / "cv.doc").read_bytes())
    assert res.status_code == 200, res.text
    assert res.json()["parsed_data"]["certifications"]
