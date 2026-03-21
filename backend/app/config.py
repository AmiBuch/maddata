from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Load .env from backend/; fall back to .env.example if .env doesn't exist
_BACKEND_DIR = Path(__file__).resolve().parent.parent
# Yelp activities: backend/app/yelpdata/chicago_sample.json (JSON lines)
_APP_DIR = Path(__file__).resolve().parent
YELP_DATA_PATH: Path = _APP_DIR / "yelpdata" / "chicago_sample.json"
_ENV_PATH = _BACKEND_DIR / ".env"
_ENV_EXAMPLE_PATH = _BACKEND_DIR / ".env.example"
_ENV_FILE = _ENV_PATH if _ENV_PATH.exists() else _ENV_EXAMPLE_PATH


class Settings(BaseSettings):
    anthropic_api_key: str = ""
    airnow_api_key: str = ""
    news_api_key: str = ""
    openweather_api_key: str = ""
    google_api_key: str = ""
    gemini_api_key: str = ""  # GEMINI_API_KEY in .env — for AI activity recommendations
    frontend_url: str = "http://localhost:3000"

    model_config = SettingsConfigDict(
        env_file=_ENV_FILE,
        env_file_encoding="utf-8",
        extra="ignore",
    )


settings = Settings()
