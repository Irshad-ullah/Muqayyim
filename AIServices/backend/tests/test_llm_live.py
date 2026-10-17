"""12: opt-in smoke test against the REAL provider (never part of the normal run).

    pytest -m llm_live tests/test_llm_live.py      (needs LLM_API_KEY in AIServices/backend/.env)

One tiny call with the smoke prompt (no user data). It uses the test database for the usage
record, the limiter and the cache, so it also counts against the project's provider limits once.
"""

import pytest
from pydantic import BaseModel

from app.config.settings import settings
from app.services.llm import client as llm_client
from app.services.llm.client import LLMClient
from app.services.llm.providers.gemini import GeminiProvider
from tests.db_fixtures import real_db  # noqa: F401 — pytest fixture

pytestmark = pytest.mark.llm_live


class Smoke(BaseModel):
    ok: bool
    word: str


async def test_live_provider_smoke(real_db):  # noqa: F811
    if not settings.LLM_API_KEY or settings.LLM_PROVIDER != "gemini":
        pytest.skip("LLM_API_KEY is not set for the Gemini provider")
    await llm_client.ensure_llm_indexes(real_db)
    client = LLMClient(GeminiProvider(settings.LLM_API_KEY, settings.LLM_MODEL, settings.LLM_BASE_URL), db=real_db)
    result = await client.generate_json("smoke", "smoke", Smoke, user_id="llm-live-smoke", max_output_tokens=64)
    assert result.data.ok is True and result.data.word.strip()
    assert result.input_tokens > 0 and result.output_tokens > 0
    print(f"\nlive smoke: model={result.model} latency={result.latency_ms} ms in={result.input_tokens} out={result.output_tokens}")
