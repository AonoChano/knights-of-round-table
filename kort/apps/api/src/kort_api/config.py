from __future__ import annotations

from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "KORT API"
    app_env: str = "development"
    runtime_root: Path = Field(default=Path(__file__).resolve().parents[4] / "runtime")
    data_root: Path = Field(default=Path(__file__).resolve().parents[4] / "runtime" / "data")
    providers_file: Path = Field(
        default=Path(__file__).resolve().parents[4] / "runtime" / "providers" / "profiles.json"
    )
    conversation_db: Path = Field(
        default=Path(__file__).resolve().parents[4] / "runtime" / "data" / "conversations.json"
    )
    secrets_file: Path = Field(
        default=Path(__file__).resolve().parents[4] / "runtime" / "data" / "provider-secrets.local.json"
    )
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3000", "http://127.0.0.1:3000"])


settings = Settings()
