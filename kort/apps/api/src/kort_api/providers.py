from __future__ import annotations

import os
from pathlib import Path

from .model_client import ModelCallError, normalize_style
from .schemas import (
    ProviderProfile,
    ProviderProfileUpdate,
    ProviderSecretStatus,
    ProviderSecretUpdate,
)
from .storage import read_json, write_json


def provider_api_key(provider: ProviderProfile, secrets: dict[str, str]) -> str:
    """Saved key first, then the environment variable named by the profile."""
    return (secrets.get(provider.provider_id) or os.getenv(provider.env_key_name, "")).strip()


def provider_supports_calls(provider: ProviderProfile) -> bool:
    try:
        normalize_style(provider.api_style)
    except ModelCallError:
        return False
    return True


def provider_is_reachable(provider: ProviderProfile, secrets: dict[str, str]) -> bool:
    if not provider.enabled or not provider_supports_calls(provider):
        return False
    return provider.provider_type == "ollama" or bool(provider_api_key(provider, secrets))


def model_is_selected(provider: ProviderProfile, model: str) -> bool:
    """Disabling a listed model retires the seats that use it.

    A model the profile never listed is left to the vendor: agents are commonly bound to a legacy
    ID that the published /models list no longer shows, and refusing those silently empties the table.
    """
    chosen = (model or provider.default_model).strip()
    if not chosen:
        return False
    return all(item.id != chosen or item.enabled for item in provider.models)


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

    def create(self, provider_id: str, update: ProviderProfileUpdate) -> ProviderProfile:
        profiles = {item.provider_id: item for item in self.list_profiles()}
        if provider_id in profiles:
            raise ValueError(f"Provider {provider_id} already exists.")
        return self.upsert(provider_id, update)

    def delete_profile(self, provider_id: str) -> bool:
        profiles = self.list_profiles()
        remaining = [item for item in profiles if item.provider_id != provider_id]
        if len(remaining) == len(profiles):
            return False
        self.save_profiles(remaining)
        secrets = self._read_secrets()
        if provider_id in secrets:
            secrets.pop(provider_id)
            write_json(self.secrets_path, secrets)
        return True

    def get_saved_key(self, provider_id: str) -> str:
        return self._read_secrets().get(provider_id, "")

    def list_secret_statuses(self) -> list[ProviderSecretStatus]:
        secrets = self._read_secrets()
        return [
            ProviderSecretStatus(
                provider_id=profile.provider_id,
                configured=bool(secrets.get(profile.provider_id, "").strip()),
                env_configured=bool(os.getenv(profile.env_key_name, "").strip()),
            )
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

    def read_secrets(self) -> dict[str, str]:
        raw = read_json(self.secrets_path, default={})
        if not isinstance(raw, dict):
            return {}
        return {str(key): str(value) for key, value in raw.items() if isinstance(value, str)}

    def _read_secrets(self) -> dict[str, str]:
        return self.read_secrets()
