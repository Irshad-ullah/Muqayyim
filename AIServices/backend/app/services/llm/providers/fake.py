"""
Fake LLM adapter (12) for tests and offline development: no network, deterministic.

- `script`: a list of steps consumed in order; each step is a string (the answer), an LLMResponse,
  an exception instance to raise (ProviderError / ProviderTimeout), or a callable(request) -> answer.
- With no script left, it answers deterministically: JSON requests get `default_json`, text
  requests get "FAKE: <first 40 characters of the prompt>".
- Every request is recorded in `requests`, so tests can check exactly what would have been sent.
"""

import json
from typing import Any, Callable, List, Optional

from app.services.llm.providers.base import LLMRequest, LLMResponse


class FakeProvider:
    name = "fake"

    def __init__(self, script: Optional[List[Any]] = None, model: str = "fake-llm", default_json: Optional[dict] = None):
        self.model = model
        self.script = list(script or [])
        self.default_json = default_json if default_json is not None else {"text": "fake answer"}
        self.requests: List[LLMRequest] = []

    def push(self, *steps: Any) -> "FakeProvider":
        self.script.extend(steps)
        return self

    async def generate(self, request: LLMRequest, timeout_s: float) -> LLMResponse:
        self.requests.append(request)
        step = self.script.pop(0) if self.script else None
        if isinstance(step, BaseException):
            raise step
        if callable(step) and not isinstance(step, (str, LLMResponse)):
            step = step(request)
        if isinstance(step, LLMResponse):
            return step
        if step is None:
            step = json.dumps(self.default_json) if request.json_output else f"FAKE: {request.prompt[:40]}"
        tokens = lambda s: max(1, len(s) // 4)  # noqa: E731 — a rough, deterministic count
        return LLMResponse(text=str(step), input_tokens=tokens(request.system + request.prompt),
                           output_tokens=tokens(str(step)), model=self.model)

    @property
    def sent_text(self) -> str:
        """Everything that would have left the service (system + prompts), for privacy assertions."""
        return "\n".join(r.system + "\n" + r.prompt for r in self.requests)


def responder(fn: Callable[[LLMRequest], str]) -> Callable[[LLMRequest], str]:
    """Marks a function as a scripted step (readability in tests)."""
    return fn
