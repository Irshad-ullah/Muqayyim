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
    # mode only: lowest similarity with >= 95% precision (benchmark v2,
    # docs/evaluation/embedding-benchmark-2026-10-14/).
    EMBEDDING_RELATED_THRESHOLD: float = float(os.getenv("EMBEDDING_RELATED_THRESHOLD", "0.73"))
    EMBEDDING_THRESHOLD_MODEL: str = os.getenv("EMBEDDING_THRESHOLD_MODEL", "BAAI/bge-small-en-v1.5")
    EMBEDDING_THRESHOLD_TEXT_MODE: str = os.getenv("EMBEDDING_THRESHOLD_TEXT_MODE", "description")

    # Profession database (ESCO + O*NET) and the FAISS role-skill index (Module 5/10).
    # Comma-separated lists. PROFESSION_SOURCES selects which sources are active in the index.
    PROFESSION_SOURCES: str = os.getenv("PROFESSION_SOURCES", "onet,esco,curated,manual")
    PROFESSION_DATA_DIR: str = os.getenv("PROFESSION_DATA_DIR", "../data/raw")
    ONET_SOC_PREFIXES: str = os.getenv("ONET_SOC_PREFIXES", "15-12,15-2051")
    ONET_SOC_EXCLUDE: str = os.getenv("ONET_SOC_EXCLUDE", "15-1299.00")
    ONET_SKILLS_CAP: int = int(os.getenv("ONET_SKILLS_CAP", "30"))
    ONET_VERSION: str = os.getenv("ONET_VERSION", "31.0")
    # 3522, not 352: ISCO 3521 (broadcasting and audio-visual technicians) is not an IT role (Module 5, FR7.2).
    ESCO_ISCO_PREFIXES: str = os.getenv("ESCO_ISCO_PREFIXES", "251,252,351,3522,2166")
    ESCO_VERSION: str = os.getenv("ESCO_VERSION", "1.2.1")
    # ESCO skill descriptions as embedding text: off until ESCO-style text is benchmarked.
    ESCO_DESCRIPTIONS_ENABLED: bool = os.getenv("ESCO_DESCRIPTIONS_ENABLED", "false").lower() == "true"
    ROLE_INDEX_DIR: str = os.getenv("ROLE_INDEX_DIR", "../data/index")
    MUTUAL_NN_K: int = int(os.getenv("MUTUAL_NN_K", "10"))
    # Load/rebuild the role-skill index at startup (off in unit tests).
    ROLE_INDEX_AUTOLOAD: bool = os.getenv("ROLE_INDEX_AUTOLOAD", "true").lower() != "false"

    # Admin taxonomy jobs (09c, Module 10 FE-4). The taxonomy lock is renewed by a
    # heartbeat while a job runs; a lock whose holder died expires after the TTL.
    TAXONOMY_LOCK_TTL_SECONDS: int = int(os.getenv("TAXONOMY_LOCK_TTL_SECONDS", "300"))
    TAXONOMY_LOCK_HEARTBEAT_SECONDS: int = int(os.getenv("TAXONOMY_LOCK_HEARTBEAT_SECONDS", "60"))
    # The running AI service records a heartbeat so offline tools (CLI imports) can tell it is up.
    SERVICE_HEARTBEAT_SECONDS: int = int(os.getenv("SERVICE_HEARTBEAT_SECONDS", "60"))
    SERVICE_HEARTBEAT_ENABLED: bool = os.getenv("SERVICE_HEARTBEAT_ENABLED", "true").lower() != "false"
    # Staging and snapshots live OUTSIDE the repository (default ~/.muqayyim/taxonomy).
    TAXONOMY_WORK_DIR: str = os.getenv("TAXONOMY_WORK_DIR", "")
    # Upload limits (09c Part 2; measured against the real ESCO v1.2.1 ZIP: 9.6 MB
    # compressed, 49.4 MB uncompressed, 19 entries).
    TAXONOMY_MAX_UPLOAD_MB: int = int(os.getenv("TAXONOMY_MAX_UPLOAD_MB", "100"))
    TAXONOMY_MAX_UNZIPPED_MB: int = int(os.getenv("TAXONOMY_MAX_UNZIPPED_MB", "500"))
    TAXONOMY_MAX_ZIP_ENTRIES: int = int(os.getenv("TAXONOMY_MAX_ZIP_ENTRIES", "500"))
    # Staging files of unfinished jobs are deleted after this many hours (job → cancelled).
    TAXONOMY_STAGING_TTL_HOURS: int = int(os.getenv("TAXONOMY_STAGING_TTL_HOURS", "24"))
    TAXONOMY_CLEANUP_INTERVAL_SECONDS: int = int(os.getenv("TAXONOMY_CLEANUP_INTERVAL_SECONDS", "3600"))
    # Snapshot retention: publish / restore pool and direct-edit pool (09c Part 4).
    TAXONOMY_SNAPSHOTS_KEEP: int = int(os.getenv("TAXONOMY_SNAPSHOTS_KEEP", "5"))
    TAXONOMY_EDIT_SNAPSHOTS_KEEP: int = int(os.getenv("TAXONOMY_EDIT_SNAPSHOTS_KEEP", "10"))
    # How often a crashed publish (job left in "publishing", lock expired) is looked for.
    TAXONOMY_RECOVERY_INTERVAL_SECONDS: int = int(os.getenv("TAXONOMY_RECOVERY_INTERVAL_SECONDS", "60"))
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

    # ── LLM (12): one shared client in AIServices (app/services/llm). The key is never logged. ──
    # Off unless enabled AND (for a real provider) a key is set; features then degrade gracefully.
    LLM_ENABLED: bool = os.getenv("LLM_ENABLED", "false").lower() == "true"
    LLM_PROVIDER: str = os.getenv("LLM_PROVIDER", "gemini")  # gemini | fake
    LLM_MODEL: str = os.getenv("LLM_MODEL", "gemini-3.5-flash-lite")  # or gemini-3.8-flash
    LLM_API_KEY: str = os.getenv("LLM_API_KEY", "")
    LLM_BASE_URL: str = os.getenv("LLM_BASE_URL", "https://generativelanguage.googleapis.com/v1beta")
    LLM_TIMEOUT_S: float = float(os.getenv("LLM_TIMEOUT_S", "15"))  # PER-3: AI content within 15 s
    LLM_MAX_OUTPUT_TOKENS: int = int(os.getenv("LLM_MAX_OUTPUT_TOKENS", "1024"))
    LLM_MAX_RETRIES: int = int(os.getenv("LLM_MAX_RETRIES", "2"))  # on 429 / 5xx only
    # The provider's limits for this project (Google applies them per project; daily reset at midnight
    # Pacific). The global limiter allows LLM_LIMIT_FRACTION of them.
    LLM_RPM: int = int(os.getenv("LLM_RPM", "5"))
    LLM_TPM: int = int(os.getenv("LLM_TPM", "100000"))
    LLM_RPD: int = int(os.getenv("LLM_RPD", "100"))
    LLM_LIMIT_FRACTION: float = float(os.getenv("LLM_LIMIT_FRACTION", "0.8"))
    LLM_USER_DAILY_QUOTA: int = int(os.getenv("LLM_USER_DAILY_QUOTA", "20"))
    LLM_CACHE_TTL_DAYS: int = int(os.getenv("LLM_CACHE_TTL_DAYS", "7"))

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
