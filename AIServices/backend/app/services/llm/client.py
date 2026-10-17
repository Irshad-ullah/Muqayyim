"""
The one shared LLM client of the project (12). Features call:

    result = await get_llm_client().generate_text(feature, prompt_name, user_id=…, values={…})
    result = await get_llm_client().generate_json(feature, prompt_name, Schema, user_id=…, values={…})

`values` fill the prompt file's placeholders; untrusted data must be passed through
`prompts.data_block(...)` (minimised, delimited). The system instruction is always
prompts/system_base.txt.

Per call: enabled? → cache → per-user quota and global limits → provider (timeout LLM_TIMEOUT_S;
up to LLM_MAX_RETRIES retries with exponential backoff + jitter on 429 / 5xx only, honouring the
provider's retry delay) → for JSON: parse + validate with the pydantic schema, one corrective
retry, then LLMInvalidOutput → usage record → cache. Every failure is an LLMError with a safe
message; nothing else escapes. Logs: feature, a 12-character user hash, status, tokens, latency.
"""

import asyncio
import json
import logging
import random
import re
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Optional, Type

from pydantic import BaseModel, ValidationError

from app.config.database import get_database
from app.config.settings import settings
from app.services.llm import cache, limits, usage
from app.services.llm.errors import (
    LLMDisabled, LLMError, LLMInvalidOutput, LLMRateLimited, LLMTimeout, LLMUnavailable, ProviderError, ProviderTimeout,
)
from app.services.llm.prompts import load
from app.services.llm.providers.base import LLMRequest, Provider

logger = logging.getLogger(__name__)
MAX_BACKOFF_S = 8.0
MAX_RETRY_WAIT_S = 20.0  # a provider asking to wait longer is reported as rate limited instead


@dataclass
class LLMResult:
    text: str
    data: Any = None  # the validated schema instance for generate_json
    cached: bool = False
    input_tokens: int = 0
    output_tokens: int = 0
    latency_ms: int = 0
    attempts: int = 0
    model: str = ""
    prompt_ref: str = ""


def _strip_fences(text: str) -> str:
    match = re.match(r"^\s*```(?:json)?\s*(.*?)\s*```\s*$", text, flags=re.S)
    return match.group(1) if match else text.strip()


def parse_json(text: str, schema: Type[BaseModel]) -> BaseModel:
    """Raises ValueError (not JSON) or ValidationError (wrong shape)."""
    return schema.model_validate(json.loads(_strip_fences(text)))


def build_provider() -> Optional[Provider]:
    """The configured provider, or None when the LLM is off (disabled, or a real provider without a key)."""
    if not settings.LLM_ENABLED:
        return None
    if settings.LLM_PROVIDER == "fake":
        from app.services.llm.providers.fake import FakeProvider

        return FakeProvider(model="fake-llm")
    if settings.LLM_PROVIDER == "gemini" and settings.LLM_API_KEY:
        from app.services.llm.providers.gemini import GeminiProvider

        return GeminiProvider(settings.LLM_API_KEY, settings.LLM_MODEL, settings.LLM_BASE_URL)
    return None


class LLMClient:
    def __init__(self, provider: Optional[Provider] = None, db=None,
                 sleep: Callable[[float], Any] = asyncio.sleep, jitter: Callable[[], float] = random.random,
                 clock: Optional[Callable[[], datetime]] = None):
        self.provider = provider
        self._db = db
        self._sleep = sleep
        self._jitter = jitter
        self._clock = clock or (lambda: datetime.now(timezone.utc))  # tests pin the minute / day

    @property
    def db(self):
        return self._db if self._db is not None else get_database()

    @property
    def enabled(self) -> bool:
        return self.provider is not None

    def status(self) -> dict:
        return {"enabled": self.enabled, "provider": getattr(self.provider, "name", settings.LLM_PROVIDER),
                "model": getattr(self.provider, "model", settings.LLM_MODEL),
                "configured": {"LLM_ENABLED": settings.LLM_ENABLED, "api_key_set": bool(settings.LLM_API_KEY)}}

    # ── public API ────────────────────────────────────────────────────────────
    async def generate_text(self, feature: str, prompt_name: str, *, user_id: Optional[str],
                            values: Optional[dict] = None, max_output_tokens: Optional[int] = None,
                            temperature: float = 0.3) -> LLMResult:
        return await self._run(feature, prompt_name, user_id, values or {}, None, max_output_tokens, temperature)

    async def generate_json(self, feature: str, prompt_name: str, schema: Type[BaseModel], *, user_id: Optional[str],
                            values: Optional[dict] = None, max_output_tokens: Optional[int] = None,
                            temperature: float = 0.2) -> LLMResult:
        return await self._run(feature, prompt_name, user_id, values or {}, schema, max_output_tokens, temperature)

    # ── internals ─────────────────────────────────────────────────────────────
    async def _record(self, feature, user, prompt_ref, status, attempts=0, input_tokens=0, output_tokens=0, latency_ms=0):
        provider = getattr(self.provider, "name", settings.LLM_PROVIDER)
        model = getattr(self.provider, "model", settings.LLM_MODEL)
        try:
            await usage.record(self.db, feature=feature, user=user, provider=provider, model=model, prompt_ref=prompt_ref,
                               status=status, attempts=attempts, input_tokens=input_tokens, output_tokens=output_tokens,
                               latency_ms=latency_ms)
        except Exception:  # noqa: BLE001 — usage bookkeeping never breaks a feature
            logger.warning("llm usage record failed feature=%s", feature)
        logger.info("llm feature=%s user=%s status=%s attempts=%d in=%d out=%d ms=%d", feature, user[:12], status,
                    attempts, input_tokens, output_tokens, latency_ms)

    def _backoff(self, attempt: int, retry_after: Optional[float]) -> float:
        base = min(MAX_BACKOFF_S, 2.0 ** attempt) + self._jitter() * 0.5
        return max(base, retry_after or 0.0)

    async def _call(self, request: LLMRequest, feature: str, user: str, prompt_ref: str, state: dict):
        """One provider call with retries (429 / 5xx only). Every attempt takes a global request slot."""
        for attempt in range(settings.LLM_MAX_RETRIES + 1):
            if state["attempts"] > 0:  # the first slot was taken with the user's quota
                taken = await limits.acquire(self.db, None, self._estimate(request), self._clock())
                state["taken"].append(taken)
            state["attempts"] += 1
            try:
                return await self.provider.generate(request, settings.LLM_TIMEOUT_S)
            except ProviderTimeout:
                raise LLMTimeout()
            except ProviderError as exc:
                last = attempt == settings.LLM_MAX_RETRIES
                if not exc.retryable or last:
                    if exc.status == 429:
                        raise LLMRateLimited(retry_after=int(exc.retry_after or 60))
                    raise LLMUnavailable()
                wait = self._backoff(attempt, exc.retry_after)
                if wait > MAX_RETRY_WAIT_S:
                    raise LLMRateLimited(retry_after=int(wait))
                await self._sleep(wait)

    @staticmethod
    def _estimate(request: LLMRequest) -> int:
        return (len(request.system) + len(request.prompt)) // 4 + request.max_output_tokens

    async def _run(self, feature, prompt_name, user_id, values, schema, max_output_tokens, temperature) -> LLMResult:
        template = load(prompt_name)
        user = cache.user_ref(user_id)
        if not self.enabled:
            await self._record(feature, user, template.ref, "disabled")
            raise LLMDisabled()
        system = load("system_base").template
        prompt = template.render(**values)
        if schema is not None:
            prompt += ("\nReturn only one JSON object that matches this JSON Schema (no prose, no code fences):\n"
                       + json.dumps(schema.model_json_schema(), ensure_ascii=False))
        model = getattr(self.provider, "model", "")
        key = cache.cache_key(user, feature, template.ref, model, system, prompt, "json" if schema else "text")
        hit = await cache.get(self.db, key)
        if hit is not None:
            data = parse_json(hit, schema) if schema is not None else None
            await self._record(feature, user, template.ref, "cached")
            return LLMResult(text=hit, data=data, cached=True, model=model, prompt_ref=template.ref)

        request = LLMRequest(system=system, prompt=prompt, json_output=schema is not None, temperature=temperature,
                             max_output_tokens=max_output_tokens or settings.LLM_MAX_OUTPUT_TOKENS)
        state = {"attempts": 0, "taken": []}
        started = time.perf_counter()
        tokens_in = tokens_out = 0
        try:
            first = await limits.acquire(self.db, user, self._estimate(request), self._clock())
            state["taken"].append(first)
            response = await self._call(request, feature, user, template.ref, state)
            tokens_in, tokens_out = response.input_tokens, response.output_tokens
            text, data = response.text, None
            if schema is not None:
                try:
                    data = parse_json(text, schema)
                except (ValueError, ValidationError) as exc:
                    problem = "not valid JSON" if not isinstance(exc, ValidationError) else \
                        f"JSON that does not match the schema ({exc.error_count()} problem(s))"
                    retry = LLMRequest(system=system, json_output=True, temperature=temperature,
                                       max_output_tokens=request.max_output_tokens,
                                       prompt=prompt + f"\n\nYour previous answer was {problem}. Return only the JSON object.")
                    response = await self._call(retry, feature, user, template.ref, state)
                    tokens_in += response.input_tokens
                    tokens_out += response.output_tokens
                    text = response.text
                    try:
                        data = parse_json(text, schema)
                    except (ValueError, ValidationError):
                        raise LLMInvalidOutput()
        except LLMError as exc:
            status = {"LLM_RATE_LIMITED": "rate_limited", "LLM_QUOTA_EXCEEDED": "quota_exceeded", "LLM_TIMEOUT": "timeout",
                      "LLM_INVALID_OUTPUT": "invalid_output"}.get(exc.code, "unavailable")
            await self._record(feature, user, template.ref, status, state["attempts"], tokens_in, tokens_out,
                               round((time.perf_counter() - started) * 1000))
            raise
        latency = round((time.perf_counter() - started) * 1000)
        if state["taken"]:
            await limits.adjust_tokens(self.db, state["taken"][0], tokens_in + tokens_out)
        await cache.put(self.db, key, user, feature, text)
        await self._record(feature, user, template.ref, "ok", state["attempts"], tokens_in, tokens_out, latency)
        return LLMResult(text=text, data=data, input_tokens=tokens_in, output_tokens=tokens_out, latency_ms=latency,
                         attempts=state["attempts"], model=response.model or model, prompt_ref=template.ref)


_client: Optional[LLMClient] = None


def get_llm_client() -> LLMClient:
    global _client
    if _client is None:
        _client = LLMClient(build_provider())
    return _client


def use_llm_client(client: Optional[LLMClient]) -> None:
    """Tests (and the service at startup) set the client; None rebuilds it from settings next time."""
    global _client
    _client = client


async def ensure_llm_indexes(db) -> None:
    await limits.ensure_limit_indexes(db)
    await cache.ensure_cache_indexes(db)
    await usage.ensure_usage_indexes(db)


async def delete_user_data(user_id: str, db=None) -> dict:
    """Consent withdrawn or account deleted: remove the user's cached LLM outputs. (Usage records
    hold no content and only a hash; quota counters are kept so a withdrawal cannot reset the quota.)"""
    db = db if db is not None else get_database()
    return {"cache_entries_deleted": await cache.delete_user(db, cache.user_ref(user_id))}
