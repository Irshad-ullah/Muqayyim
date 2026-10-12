"""
CV upload/parsing errors with a stable code, returned as
{ success: false, code, message } (the platform's error shape).
"""

from fastapi.responses import JSONResponse

INVALID_FILE_TYPE_MESSAGE = "The file content does not match its extension. Upload a PDF, DOC or DOCX file."
ENCRYPTED_FILE_MESSAGE = "This file is password-protected. Remove the password, save it again and upload the new file."
DOC_UNSUPPORTED_MESSAGE = "Old .doc files could not be processed. Please save as PDF or DOCX and upload again."
NO_TEXT_FOUND_MESSAGE = (
    "No readable text was found. This may be a scanned document. Please upload a text-based PDF or DOCX."
)


class CVProcessingError(Exception):
    """A CV problem the user can fix (wrong type, encrypted, unreadable…)."""

    def __init__(self, status_code: int, code: str, message: str, log_detail: str = ""):
        super().__init__(message)
        self.status_code = status_code
        self.code = code
        self.message = message
        # Extra context for the warning log (never shown to the user).
        self.log_detail = log_detail

    def response(self, request_id: str | None = None) -> JSONResponse:
        content = {"success": False, "code": self.code, "message": self.message}
        if request_id:
            content["requestId"] = request_id
        return JSONResponse(status_code=self.status_code, content=content)


def invalid_file_type(detail: str = "", status_code: int = 400) -> CVProcessingError:
    return CVProcessingError(status_code, "INVALID_FILE_TYPE", INVALID_FILE_TYPE_MESSAGE, detail)


def encrypted_file(status_code: int = 400) -> CVProcessingError:
    return CVProcessingError(status_code, "ENCRYPTED_FILE", ENCRYPTED_FILE_MESSAGE)


def doc_unsupported(detail: str = "") -> CVProcessingError:
    return CVProcessingError(422, "DOC_UNSUPPORTED", DOC_UNSUPPORTED_MESSAGE, detail)


def no_text_found(detail: str = "") -> CVProcessingError:
    return CVProcessingError(422, "NO_TEXT_FOUND", NO_TEXT_FOUND_MESSAGE, detail)
