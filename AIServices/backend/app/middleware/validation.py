"""
Request validation errors in the platform's standard shape (same as CoreServices):

    422 { success: false, code: "VALIDATION_ERROR", message, errors: [{ field, message }] }

`field` uses JS-style paths ("verified_data.experience[1].title"). Submitted
values are never echoed back (FastAPI's default response includes them).
A body that is not valid JSON → 400 INVALID_JSON, as in CoreServices.
"""

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

_LOCATIONS = {"body", "query", "path", "header", "cookie"}


def field_path(loc) -> str:
    parts = list(loc)
    if parts and parts[0] in _LOCATIONS:
        parts = parts[1:]
    path = ""
    for part in parts:
        if isinstance(part, int):
            path += f"[{part}]"
        else:
            path += f".{part}" if path else str(part)
    return path or "body"


def _message(error: dict) -> str:
    msg = str(error.get("msg", "Invalid value"))
    return msg[len("Value error, "):] if msg.startswith("Value error, ") else msg


def format_validation_errors(errors) -> list:
    out, seen = [], set()
    for error in errors:
        item = {"field": field_path(error.get("loc", ())), "message": _message(error)}
        key = (item["field"], item["message"])
        if key not in seen:
            seen.add(key)
            out.append(item)
    return out


def validation_error_response(errors: list, request_id: str | None = None) -> JSONResponse:
    """422 VALIDATION_ERROR for rule checks done in a route (same body as below)."""
    first = errors[0] if errors else {"field": "body", "message": "Invalid request"}
    more = f" (and {len(errors) - 1} more)" if len(errors) > 1 else ""
    content = {
        "success": False,
        "code": "VALIDATION_ERROR",
        "message": f"{first['field']}: {first['message']}{more}",
        "errors": errors,
    }
    if request_id:
        content["requestId"] = request_id
    return JSONResponse(status_code=422, content=content)


async def _validation_error_handler(request: Request, exc: RequestValidationError):
    raw = exc.errors()
    request_id = getattr(request.state, "request_id", None)
    if any(e.get("type") == "json_invalid" for e in raw):
        content = {"success": False, "code": "INVALID_JSON", "message": "Request body is not valid JSON."}
        status_code = 400
    else:
        errors = format_validation_errors(raw)
        first = errors[0] if errors else {"field": "body", "message": "Invalid request"}
        more = f" (and {len(errors) - 1} more)" if len(errors) > 1 else ""
        content = {
            "success": False,
            "code": "VALIDATION_ERROR",
            "message": f"{first['field']}: {first['message']}{more}",
            "errors": errors,
        }
        status_code = 422
    if request_id:
        content["requestId"] = request_id
    return JSONResponse(status_code=status_code, content=content)


def register_validation_error_handler(app: FastAPI) -> None:
    app.add_exception_handler(RequestValidationError, _validation_error_handler)
