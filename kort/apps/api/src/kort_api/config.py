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
    log_level: str = "INFO"
    slow_request_ms: int = 1000
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
    memory_budget_tokens: int = 320
    memory_auto_dream: bool = True
    memory_dream_min_episodes: int = 6
    memory_dream_min_hours: int = 24
    agent_max_rounds: int = 6
    agent_max_tool_calls: int = 8
    agent_max_searches: int = 5
    agent_max_fetches: int = 4
    agent_max_seconds: int = 180
    agent_tool_timeout_seconds: int = 30
    agent_max_result_chars: int = 6000
    web_search_max_results: int = 8
    web_fetch_max_chars: int = 4000
    cors_origins: list[str] = Field(
        default_factory=lambda: [
            "http://localhost:3000",
            "http://localhost:3001",
            "http://127.0.0.1:3000",
            "http://127.0.0.1:3001",
        ]
    )


settings = Settings()
