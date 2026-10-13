"""
Settings and Environment Configuration
"""

import os
from dotenv import load_dotenv
from pydantic_settings import BaseSettings, SettingsConfigDict

# Load environment variables from .env file
load_dotenv()


class Settings(BaseSettings):
    """Application settings"""

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=True, extra="ignore")
    
    # API Configuration
    API_TITLE: str = "MUQAYYIM - CV Parsing Module"
    API_VERSION: str = "1.0.0"
    DEBUG: bool = os.getenv("DEBUG", "False") == "True"
    
    # Server Configuration
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", 8000))
    
    # Database Configuration
    MONGODB_URL: str = os.getenv("MONGODB_URL", "mongodb://localhost:27017")
    # Database-per-service: AIServices owns ai_db only (CoreServices uses core_db).
    AI_DB_NAME: str = os.getenv("AI_DB_NAME", os.getenv("DATABASE_NAME", "ai_db"))
    
    # File Upload Configuration
    MAX_FILE_SIZE: int = 5 * 1024 * 1024  # 5MB
    ALLOWED_EXTENSIONS: list = ["pdf", "doc", "docx"]
    UPLOAD_DIRECTORY: str = os.getenv("UPLOAD_DIRECTORY", "./uploads")
    # Legacy .doc support: LibreOffice headless converts .doc to .docx.
    # Empty = auto-detect (PATH, then common install locations).
    LIBREOFFICE_PATH: str = os.getenv("LIBREOFFICE_PATH", "")
    DOC_CONVERT_TIMEOUT_SECONDS: int = int(os.getenv("DOC_CONVERT_TIMEOUT_SECONDS", "30"))
    
    # NLP Configuration
    NLP_MODEL: str = os.getenv("NLP_MODEL", "en_core_web_sm")  # spaCy model
    CONFIDENCE_THRESHOLD: float = 0.7

    # Skill embeddings (Module 2 FE-4/FE-5). The model loads in the background
    # at startup; after the first download it is read from EMBEDDING_CACHE_DIR
    # and works fully offline.
    EMBEDDING_MODEL: str = os.getenv("EMBEDDING_MODEL", "BAAI/bge-small-en-v1.5")
    # What is embedded per skill: "description" = "Name: description" when a
    # curated description exists (else the name); "name" = the bare name.
    EMBEDDING_TEXT_MODE: str = os.getenv("EMBEDDING_TEXT_MODE", "description")
    # Related-skill threshold for future matching, measured for this model + text
    # mode only (docs/evaluation/embedding-benchmark-2026-10-13/).
    EMBEDDING_RELATED_THRESHOLD: float = float(os.getenv("EMBEDDING_RELATED_THRESHOLD", "0.72"))
    EMBEDDING_THRESHOLD_MODEL: str = os.getenv("EMBEDDING_THRESHOLD_MODEL", "BAAI/bge-small-en-v1.5")
    EMBEDDING_THRESHOLD_TEXT_MODE: str = os.getenv("EMBEDDING_THRESHOLD_TEXT_MODE", "description")
    EMBEDDING_CACHE_DIR: str = os.getenv("EMBEDDING_CACHE_DIR", "./models")
    EMBEDDING_AUTOLOAD: bool = os.getenv("EMBEDDING_AUTOLOAD", "true").lower() != "false"
    EMBEDDING_WORKER_INTERVAL_SECONDS: int = int(os.getenv("EMBEDDING_WORKER_INTERVAL_SECONDS", "30"))
    
    # Authentication — must match Module 1 JWT_SECRET exactly
    JWT_SECRET: str = os.getenv("JWT_SECRET", os.getenv("SECRET_KEY", "your-secret-key-here"))
    ALGORITHM: str = "HS256"

    # Service-to-service (internal REST). The key must match CoreServices.
    CORE_SERVICE_URL: str = os.getenv("CORE_SERVICE_URL", "http://localhost:3000")
    INTERNAL_API_KEY: str = os.getenv("INTERNAL_API_KEY", "")

    # How long a user's auth state from CoreServices is cached (seconds).
    # Suspensions/password changes reach this service within this window.
    AUTH_CACHE_TTL_SECONDS: int = int(os.getenv("AUTH_CACHE_TTL_SECONDS", "30"))
    
    # Error-log retention (TTL index on error_logs.timestamp), in days.
    LOG_RETENTION_DAYS: int = int(os.getenv("LOG_RETENTION_DAYS", "30"))

    # CORS Configuration
    # Include both localhost and 127.0.0.1 since dev servers may use either.
    CORS_ORIGINS: list = [
        "http://localhost:3000",
        "http://localhost:5174",
        "http://localhost:8080",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5174",
        "http://127.0.0.1:8080",
    ]
    
    # NOTE: model_config above replaces legacy Config class (pydantic v2)


# Create settings instance
settings = Settings()

# Ensure upload directory exists
os.makedirs(settings.UPLOAD_DIRECTORY, exist_ok=True)
