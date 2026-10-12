"""
File signature ("magic bytes") checks for uploaded CVs (Business Rule 1).

The extension and the detected content type must agree:
  PDF   %PDF-                      (within the first 1 KB, as PDF readers allow)
  DOCX  ZIP (PK\\x03\\x04) containing word/document.xml
  DOC   OLE2 compound file D0 CF 11 E0 A1 B1 1A E1 with a WordDocument stream
Password-protected files are reported separately (ENCRYPTED_FILE): an
encrypted PDF that cannot be opened with an empty password, or an OLE2
container holding an EncryptedPackage (how Office encrypts .docx).
"""

import io
import logging
import zipfile

from app.services.cv_errors import encrypted_file, invalid_file_type

logger = logging.getLogger(__name__)

PDF_MAGIC = b"%PDF-"
ZIP_MAGIC = b"PK\x03\x04"
OLE2_MAGIC = bytes.fromhex("D0CF11E0A1B11AE1")
# Stream names inside OLE2 directories are UTF-16LE.
_ENCRYPTED_PACKAGE = "EncryptedPackage".encode("utf-16-le")
_WORD_DOCUMENT = "WordDocument".encode("utf-16-le")

PDF, DOCX, DOC, ENCRYPTED_OFFICE, UNKNOWN = "pdf", "docx", "doc", "encrypted-office", "unknown"


def detect_type(data: bytes) -> str:
    """Content type from the bytes alone: pdf | docx | doc | encrypted-office | unknown."""
    if not data:
        return UNKNOWN
    if PDF_MAGIC in data[:1024]:
        return PDF
    if data.startswith(ZIP_MAGIC):
        try:
            with zipfile.ZipFile(io.BytesIO(data)) as archive:
                return DOCX if "word/document.xml" in archive.namelist() else UNKNOWN
        except zipfile.BadZipFile:
            return UNKNOWN
    if data.startswith(OLE2_MAGIC):
        if _ENCRYPTED_PACKAGE in data:
            return ENCRYPTED_OFFICE
        return DOC if _WORD_DOCUMENT in data else UNKNOWN
    return UNKNOWN


def is_encrypted_pdf(data: bytes) -> bool:
    """True when the PDF is encrypted and an empty password does not open it."""
    try:
        import PyPDF2

        reader = PyPDF2.PdfReader(io.BytesIO(data))
        if not reader.is_encrypted:
            return False
        try:
            return not reader.decrypt("")
        except Exception:  # unsupported cipher etc.: treat as protected
            return True
    except Exception as exc:  # unreadable PDFs are handled by text extraction
        logger.info("PDF encryption check skipped: %s", type(exc).__name__)
        return False


def verify_file(data: bytes, extension: str, status_code: int = 400) -> str:
    """
    Raise CVProcessingError unless the content matches the extension.
    Returns the detected type. 400 at upload; 422 when a stored file fails
    at parse time (the CV status then becomes failed).
    """
    ext = (extension or "").lower()
    detected = detect_type(data)
    if detected == ENCRYPTED_OFFICE and ext in (DOC, DOCX):
        raise encrypted_file(status_code)
    if detected != ext:
        raise invalid_file_type(f"extension .{ext}, content {detected}", status_code)
    if detected == PDF and is_encrypted_pdf(data):
        raise encrypted_file(status_code)
    return detected
