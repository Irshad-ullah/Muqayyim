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
DATABASE_NAME = settings.DATABASE_NAME

# Global database instance
db_client = None
database = None


async def connect_to_mongo():
    """Connect to MongoDB"""
    global db_client, database
    db_client = AsyncIOMotorClient(MONGODB_URL)
    database = db_client[DATABASE_NAME]
    
    # Create indexes
    await create_indexes()
    print("Connected to MongoDB")


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
