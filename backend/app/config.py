"""
Aptus Backend Configuration
Central application settings managed via Pydantic BaseSettings.
Supports environment variable overrides and .env loading.
"""

import os
from pathlib import Path
from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Core platform configuration for Aptus screening service."""
    PROJECT_NAME: str = "Aptus — AI Candidate Screening System"
    API_V1_STR: str = "/api"
    
    # Google Gemini LLM
    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "AIzaSyCJOlZqGEOSqLd_LKlG3qO4UD6Cc39_Ndk")
    GEMINI_MODEL: str = "gemini-2.0-flash-exp"
    
    # Groq STT (free tier)
    GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
    
    # Google Cloud TTS (free tier standard voice)
    GOOGLE_CLOUD_CREDENTIALS: str = os.getenv("GOOGLE_CLOUD_CREDENTIALS", "")
    
    # Database (Async SQLite / PostgreSQL)
    DATABASE_URL: str = "sqlite+aiosqlite:///./screening.db"
    
    # Filesystem Paths
    BASE_DIR: Path = Path(__file__).resolve().parent.parent.parent
    DATA_DIR: Path = BASE_DIR / "data"
    CORPUS_DIR: Path = DATA_DIR / "corpus"
    INDEX_DIR: Path = DATA_DIR / "indexes"
    
    # Embeddings & FAISS Vector Search
    EMBEDDING_MODEL_NAME: str = "all-MiniLM-L6-v2"
    CHUNK_SIZE: int = 600
    CHUNK_OVERLAP: int = 90
    TOP_K_CHUNKS: int = 3
    
    # Interview Flow Rules
    MAX_QUESTIONS_PER_SESSION: int = 6
    TOPICS_TARGET_DEPTH: int = 1
    
    # Supported Technical Roles
    ROLES: List[str] = [
        "AI/ML Engineer",
        "Data Science / Applied ML",
        "Backend Engineer"
    ]
    
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore"
    )


settings = Settings()

# Ensure runtime directories exist
settings.CORPUS_DIR.mkdir(parents=True, exist_ok=True)
settings.INDEX_DIR.mkdir(parents=True, exist_ok=True)
