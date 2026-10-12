"""A real, throwaway MongoDB database (ai_db_test) bound to the test's event loop."""

import asyncio

import pytest
from motor.motor_asyncio import AsyncIOMotorClient

from app.config import database as database_module
from app.config.settings import settings
from app.services import error_logger

TEST_DB = "ai_db_test"


@pytest.fixture
async def real_db(monkeypatch):
    client = AsyncIOMotorClient(settings.MONGODB_URL, serverSelectionTimeoutMS=3000)
    db = client[TEST_DB]
    await client.drop_database(TEST_DB)
    monkeypatch.setattr(database_module, "database", db)
    error_logger.reset_dedupe()
    yield db
    await flush_logs()
    await client.drop_database(TEST_DB)
    client.close()


async def flush_logs() -> None:
    """Wait for fire-and-forget log writes started by the code under test."""
    for _ in range(50):
        pending = [t for t in list(error_logger._pending) if not t.done()]
        if not pending:
            return
        await asyncio.gather(*pending, return_exceptions=True)
