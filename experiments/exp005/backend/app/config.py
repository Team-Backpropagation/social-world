"""환경변수 읽기는 설정 경계에서만 합니다. 도메인 규칙은 환경을 읽지 않습니다."""

from pathlib import Path
from typing import Literal

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_prefix="IEUM_", env_file=Path(__file__).resolve().parents[1] / ".env",
        env_file_encoding="utf-8", extra="ignore",
    )
    mode: Literal["demo", "live"] = "demo"
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    timeout_seconds: float = Field(default=15, ge=1, le=60)
    session_ttl_seconds: int = Field(default=1800, ge=60, le=3600)
