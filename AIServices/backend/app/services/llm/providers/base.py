"""The provider-agnostic request / response and the adapter protocol (12)."""

from dataclasses import dataclass, field
from typing import Optional, Protocol


@dataclass(frozen=True)
class LLMRequest:
    system: str  # the system instruction (fixed, from a prompt file)
    prompt: str  # the user turn (instructions + delimited data blocks)
    max_output_tokens: int
    json_output: bool = False  # ask the provider for application/json
    temperature: float = 0.3


@dataclass
class LLMResponse:
    text: str
    input_tokens: int = 0
    output_tokens: int = 0
    model: str = ""
    raw_finish_reason: Optional[str] = None
    extra: dict = field(default_factory=dict)


class Provider(Protocol):
    name: str
    model: str

    async def generate(self, request: LLMRequest, timeout_s: float) -> LLMResponse:
        """One attempt. Raises ProviderError (retryable for 429 / 5xx) or ProviderTimeout."""
