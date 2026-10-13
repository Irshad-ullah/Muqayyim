"""
Database Configuration
MongoDB connection and setup
"""

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo import ASCENDING, DESCENDING
from contextlib import asynccontextmanager

from app.config.settings import settings

# MongoDB connection string
MONGODB_URL = settings.MONGODB_URL
DATABASE_NAME = settings.AI_DB_NAME

# Global database instance
db_client = None
database = None


async def connect_to_mongo():
    """Connect to MongoDB"""
    global db_client, database
    db_client = AsyncIOMotorClient(MONGODB_URL)
    database = db_client[DATABASE_NAME]
    
    # Create indexes (first real round-trip: fails here if MongoDB is down)
    try:
        await create_indexes()
        print("Connected to MongoDB")
    except Exception as exc:  # noqa: BLE001
        from app.services.error_logger import log_error

        print(f"MongoDB connection/index setup failed: {exc}")
        log_error(level="critical", module="database", exc=exc)


async def close_mongo_connection():
    """Close MongoDB connection"""
    global db_client
    if db_client:
        db_client.close()
        print("Disconnected from MongoDB")


async def create_indexes():
    """Create necessary indexes for better query performance"""
    if database is None:
        return
    
    cv_collection = database["cv_parsed_data"]
    
    # Create indexes
    await cv_collection.create_index([("user_id", ASCENDING)])
    await cv_collection.create_index([("upload_date", DESCENDING)])
    await cv_collection.create_index([("parsing_status", ASCENDING)])

    await ensure_log_indexes(database)

    from app.services.embeddings.vector_store import ensure_embedding_indexes

    await ensure_embedding_indexes(database)


TTL_INDEX = "timestamp_ttl"


async def ensure_ttl_index(db, collection: str, days: int | None = None) -> int:
    """Create (or update in place via collMod) the TTL index for log retention."""
    seconds = int(days if days is not None else settings.LOG_RETENTION_DAYS) * 24 * 60 * 60
    if collection not in await db.list_collection_names():
        await db.create_collection(collection)
    indexes = await db[collection].index_information()
    current = indexes.get(TTL_INDEX)
    if current is None:
        await db[collection].create_index([("timestamp", ASCENDING)], name=TTL_INDEX, expireAfterSeconds=seconds)
    elif current.get("expireAfterSeconds") != seconds:
        await db.command({"collMod": collection, "index": {"name": TTL_INDEX, "expireAfterSeconds": seconds}})
    return seconds


async def ensure_log_indexes(db) -> None:
    logs = db["error_logs"]
    await logs.create_index([("timestamp", DESCENDING)], name="timestamp_-1")
    await logs.create_index(
        [("service", ASCENDING), ("level", ASCENDING), ("timestamp", DESCENDING)],
        name="service_1_level_1_timestamp_-1",
    )
    await ensure_ttl_index(db, "error_logs")


def get_database() -> AsyncIOMotorDatabase | None:
    """Get database instance"""
    return database


@asynccontextmanager
async def get_db_session():
    """Get database session"""
    try:
        yield database
    except Exception as e:
        print(f"Database error: {e}")
        raise
