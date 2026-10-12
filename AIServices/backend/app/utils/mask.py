"""
Masking for anything written to the error log (same rules as CoreServices).
Never log request bodies, headers or file contents — callers pass only error
messages, stacks and small detail dicts, which are cleaned here.
"""

import re
from typing import Any

SENSITIVE_KEY = re.compile(r"pass(word)?|token|secret|authorization|api[-_]?key|internal[-_]?key|cookie", re.I)
REDACTED = "[REDACTED]"
MAX_MESSAGE = 1000
MAX_STACK = 4000

_STRING_RULES = [
    # JWTs and other three-segment base64url tokens
    (re.compile(r"\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+"), "[REDACTED_JWT]"),
    (re.compile(r"\b[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b"), "[REDACTED_JWT]"),
    # Authorization header values
    (re.compile(r"\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+", re.I), r"\1 [REDACTED]"),
    # Credentials inside URLs: scheme://user:password@host
    (re.compile(r"\b([a-z][a-z0-9+.-]*://[^\s:/@]+:)[^\s@/]+@", re.I), r"\1" + REDACTED + "@"),
    # key=value / key: value pairs for sensitive keys
    (
        re.compile(
            r"\b(pass(?:word)?|pwd|token|secret|api[-_]?key|internal[-_]?key|authorization|cookie)(\s*[=:]\s*)(\"[^\"]*\"|'[^']*'|[^\s,;&]+)",
            re.I,
        ),
        r"\1\2" + REDACTED,
    ),
]


def mask_string(value: Any) -> Any:
    if not isinstance(value, str):
        return value
    for pattern, replacement in _STRING_RULES:
        value = pattern.sub(replacement, value)
    return value


def truncate(value: str | None, limit: int) -> str | None:
    if value is None:
        return None
    return value if len(value) <= limit else value[: limit - 1] + "…"


def mask_deep(value: Any, depth: int = 0) -> Any:
    """Copy with sensitive keys redacted and strings masked (depth-limited)."""
    if depth > 8:
        return "[Truncated]"
    if isinstance(value, str):
        return mask_string(value)
    if isinstance(value, dict):
        return {
            k: (REDACTED if SENSITIVE_KEY.search(str(k)) else mask_deep(v, depth + 1))
            for k, v in list(value.items())[:100]
        }
    if isinstance(value, (list, tuple)):
        return [mask_deep(v, depth + 1) for v in list(value)[:50]]
    return value


def mask_message(message: Any) -> str:
    return truncate(mask_string(str(message if message is not None else "")), MAX_MESSAGE) or ""


def mask_stack(stack: str | None) -> str | None:
    return truncate(mask_string(stack), MAX_STACK) if stack else None
