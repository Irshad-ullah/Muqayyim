"""LLM errors (12). Every failure a feature can see is one of these, with a safe message for the
user and an HTTP status for the route. Provider details (status codes, bodies) never reach users."""

from typing import Optional


class LLMError(Exception):
    status = 503
    code = "LLM_UNAVAILABLE"
    message = "AI assistance is temporarily unavailable. Please try again later."

    def __init__(self, message: Optional[str] = None, retry_after: Optional[int] = None):
        self.safe_message = message or self.message
        self.retry_after = retry_after
        super().__init__(self.safe_message)


class LLMDisabled(LLMError):
    status, code = 503, "LLM_DISABLED"
    message = "AI assistance is turned off."


class LLMUnavailable(LLMError):
    status, code = 503, "LLM_UNAVAILABLE"


class LLMTimeout(LLMError):
    status, code = 504, "LLM_TIMEOUT"
    message = "AI assistance took too long to respond. Please try again."


class LLMRateLimited(LLMError):
    status, code = 429, "LLM_RATE_LIMITED"
    message = "AI assistance is busy right now. Please try again shortly."


class LLMQuotaExceeded(LLMError):
    status, code = 429, "LLM_QUOTA_EXCEEDED"
    message = "You have used today's AI assistance limit. It resets at midnight (US Pacific time)."


class LLMInvalidOutput(LLMError):
    status, code = 502, "LLM_INVALID_OUTPUT"
    message = "AI assistance returned an unusable answer. Please try again."


class ProviderError(Exception):
    """Raised by a provider adapter: `retryable` for 429 / 5xx, with the provider's retry delay."""

    def __init__(self, status: int, retryable: bool, retry_after: Optional[float] = None):
        self.status = status
        self.retryable = retryable
        self.retry_after = retry_after
        super().__init__(f"provider status {status}")


class ProviderTimeout(Exception):
    """The provider did not answer within LLM_TIMEOUT_S (not retried)."""
