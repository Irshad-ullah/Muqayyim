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
    DATABASE_NAME: str = os.getenv("DATABASE_NAME", "muqayyim")
    
    # File Upload Configuration
    MAX_FILE_SIZE: int = 5 * 1024 * 1024  # 5MB
    ALLOWED_EXTENSIONS: list = ["pdf", "doc", "docx"]
    UPLOAD_DIRECTORY: str = os.getenv("UPLOAD_DIRECTORY", "./uploads")
    
    # NLP Configuration
    NLP_MODEL: str = os.getenv("NLP_MODEL", "en_core_web_sm")  # spaCy model
    CONFIDENCE_THRESHOLD: float = 0.7
    
    # Authentication — must match Module 1 JWT_SECRET exactly
    JWT_SECRET: str = os.getenv("JWT_SECRET", os.getenv("SECRET_KEY", "your-secret-key-here"))
    ALGORITHM: str = "HS256"
    
    # CORS Configuration
    # Include both localhost and 127.0.0.1 since dev servers may use either.
    CORS_ORIGINS: list = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://localhost:8080",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:8080",
    ]
    
    # NOTE: model_config above replaces legacy Config class (pydantic v2)


# Create settings instance
settings = Settings()

# Ensure upload directory exists
os.makedirs(settings.UPLOAD_DIRECTORY, exist_ok=True)
