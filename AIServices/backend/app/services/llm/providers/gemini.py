"""
Google Gemini adapter (12): REST models.generateContent over httpx (no SDK dependency).

  POST {LLM_BASE_URL}/models/{model}:generateContent      header x-goog-api-key: <LLM_API_KEY>
  body: systemInstruction, contents, generationConfig{maxOutputTokens, temperature, responseMimeType}
  usage: usageMetadata.promptTokenCount / candidatesTokenCount

JSON output: responseMimeType "application/json"; the expected shape is described in the prompt and
validated locally with pydantic by the client (the schema is not sent as responseSchema, which keeps
the adapter independent of the provider's schema dialect). The key is sent only in the header and is
never logged; provider error bodies are not logged either (they can echo the request).
"""

import re
from typing import Optional

import httpx

from app.services.llm.errors import ProviderError, ProviderTimeout
from app.services.llm.providers.base import LLMRequest, LLMResponse

RETRYABLE = {429, 500, 502, 503, 504}


def _retry_after(response: httpx.Response) -> Optional[float]:
    header = response.headers.get("retry-after")
    if header and header.replace(".", "", 1).isdigit():
        return float(header)
    try:
        for detail in (response.json().get("error") or {}).get("details") or []:
            delay = detail.get("retryDelay")  # google.rpc.RetryInfo, e.g. "12s"
            if delay and (m := re.match(r"^(\d+(?:\.\d+)?)s$", delay)):
                return float(m.group(1))
    except ValueError:
        pass
    return None


class GeminiProvider:
    name = "gemini"

    def __init__(self, api_key: str, model: str, base_url: str, client: Optional[httpx.AsyncClient] = None):
        self.model = model
        self._key = api_key
        self._url = f"{base_url.rstrip('/')}/models/{model}:generateContent"
        self._client = client

    def body(self, request: LLMRequest) -> dict:
        config = {"maxOutputTokens": request.max_output_tokens, "temperature": request.temperature}
        if request.json_output:
            config["responseMimeType"] = "application/json"
        return {
            "systemInstruction": {"parts": [{"text": request.system}]},
            "contents": [{"role": "user", "parts": [{"text": request.prompt}]}],
            "generationConfig": config,
        }

    async def generate(self, request: LLMRequest, timeout_s: float) -> LLMResponse:
        client = self._client or httpx.AsyncClient()
        try:
            response = await client.post(self._url, json=self.body(request), timeout=timeout_s,
                                         headers={"x-goog-api-key": self._key, "Content-Type": "application/json"})
        except httpx.TimeoutException as exc:
            raise ProviderTimeout() from exc
        except httpx.HTTPError as exc:
            raise ProviderError(0, retryable=True) from exc  # connection problems count as unavailable
        finally:
            if self._client is None:
                await client.aclose()
        if response.status_code != 200:
            raise ProviderError(response.status_code, retryable=response.status_code in RETRYABLE,
                                retry_after=_retry_after(response))
        data = response.json()
        candidate = (data.get("candidates") or [{}])[0]
        text = "".join(part.get("text", "") for part in (candidate.get("content") or {}).get("parts") or [])
        usage = data.get("usageMetadata") or {}
        return LLMResponse(text=text, input_tokens=int(usage.get("promptTokenCount") or 0),
                           output_tokens=int(usage.get("candidatesTokenCount") or 0), model=self.model,
                           raw_finish_reason=candidate.get("finishReason"))
