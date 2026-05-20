from __future__ import annotations

import os
from pathlib import Path
from urllib.parse import urlparse

from .schemas import (
    ProviderConnectivityRequest,
    ProviderConnectivityResponse,
    ProviderProfile,
    ProviderProfileUpdate,
    ProviderSecretStatus,
    ProviderSecretUpdate,
)
from .storage import read_json, write_json


class ProviderStore:
    def __init__(self, path: Path, secrets_path: Path) -> None:
        self.path = path
        self.secrets_path = secrets_path

    def list_profiles(self) -> list[ProviderProfile]:
        raw = read_json(self.path, default=[])
        return [ProviderProfile.model_validate(item) for item in raw]

    def get_profile(self, provider_id: str) -> ProviderProfile | None:
        return {item.provider_id: item for item in self.list_profiles()}.get(provider_id)

    def save_profiles(self, profiles: list[ProviderProfile]) -> None:
        write_json(self.path, [profile.model_dump(mode="json") for profile in profiles])

    def upsert(self, provider_id: str, update: ProviderProfileUpdate) -> ProviderProfile:
        profiles = {item.provider_id: item for item in self.list_profiles()}
        profiles[provider_id] = ProviderProfile(provider_id=provider_id, **update.model_dump())
        ordered = sorted(profiles.values(), key=lambda item: item.provider_id)
        self.save_profiles(ordered)
        return profiles[provider_id]

    def list_secret_statuses(self) -> list[ProviderSecretStatus]:
        secrets = self._read_secrets()
        return [
            ProviderSecretStatus(provider_id=profile.provider_id, configured=bool(secrets.get(profile.provider_id)))
            for profile in self.list_profiles()
        ]

    def save_secret(self, provider_id: str, update: ProviderSecretUpdate) -> ProviderSecretStatus:
        profiles = {item.provider_id: item for item in self.list_profiles()}
        if provider_id not in profiles:
            return ProviderSecretStatus(provider_id=provider_id, configured=False)

        secrets = self._read_secrets()
        secrets[provider_id] = update.api_key
        write_json(self.secrets_path, secrets)
        return ProviderSecretStatus(provider_id=provider_id, configured=True)

    def test_connectivity(
        self, provider_id: str, request: ProviderConnectivityRequest
    ) -> ProviderConnectivityResponse:
        profiles = {item.provider_id: item for item in self.list_profiles()}
        profile = profiles.get(provider_id)

        if profile is None:
            return ProviderConnectivityResponse(
                provider_id=provider_id,
                ok=False,
                status="not_found",
                message="Provider profile was not found.",
            )

        if not profile.enabled:
            return ProviderConnectivityResponse(
                provider_id=provider_id,
                ok=False,
                status="disabled",
                message="Provider profile is disabled.",
            )

        parsed = urlparse(profile.base_url)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            return ProviderConnectivityResponse(
                provider_id=provider_id,
                ok=False,
                status="invalid_base_url",
                message="Provider base_url must be an absolute http(s) URL.",
            )

        has_request_key = bool(request.api_key and request.api_key.strip())
        has_saved_key = bool(self._read_secrets().get(provider_id, "").strip())
        has_env_key = bool(os.getenv(profile.env_key_name, "").strip())
        if not has_request_key and not has_saved_key and not has_env_key and profile.provider_type != "ollama":
            return ProviderConnectivityResponse(
                provider_id=provider_id,
                ok=False,
                status="missing_key",
                message=f"No API key was supplied and {profile.env_key_name} is empty.",
            )

        if has_request_key:
            source = "temporary input"
        elif has_saved_key:
            source = "saved local key"
        else:
            source = f"environment variable {profile.env_key_name}"

        if profile.provider_type == "ollama" and not has_request_key and not has_saved_key and not has_env_key:
            source = "local Ollama without API key"

        return ProviderConnectivityResponse(
            provider_id=provider_id,
            ok=True,
            status="ready",
            message=f"Profile is ready for {profile.default_model} using {source}.",
        )

    def read_secrets(self) -> dict[str, str]:
        raw = read_json(self.secrets_path, default={})
        if not isinstance(raw, dict):
            return {}
        return {str(key): str(value) for key, value in raw.items() if isinstance(value, str)}

    def _read_secrets(self) -> dict[str, str]:
        return self.read_secrets()
