import json
from pathlib import Path

import pytest

import kort_api.app as app_module
from kort_api.agents import AgentLoader
from kort_api.conversations import ConversationStore, VisibleConversationService
from kort_api.memory import MemoryStore
from kort_api.providers import ProviderStore

SEED_PROFILE = {
    "provider_id": "deepseek",
    "label": "DeepSeek",
    "provider_type": "deepseek",
    "base_url": "https://api.deepseek.com",
    "api_style": "openai",
    "default_model": "deepseek-chat",
    "env_key_name": "DEEPSEEK_API_KEY",
    "enabled": True,
    "capabilities": ["chat", "reasoning"],
}


@pytest.fixture(autouse=True)
def isolated_app_stores(tmp_path: Path) -> None:
    """Keep API tests away from the developer's local runtime data."""
    runtime_root = tmp_path / "runtime"
    providers_root = tmp_path / "providers"
    data_root = tmp_path / "data"
    providers_root.mkdir(parents=True)
    data_root.mkdir(parents=True)

    profiles_file = providers_root / "profiles.json"
    secrets_file = data_root / "provider-secrets.local.json"
    conversations_path = data_root / "conversations.json"

    profiles_file.write_text(
        json.dumps([SEED_PROFILE], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    app_module.provider_store = ProviderStore(profiles_file, secrets_file)
    app_module.agent_loader = AgentLoader(runtime_root)
    app_module.memory_store = MemoryStore(runtime_root, auto_dream=False)
    app_module.conversation_service = VisibleConversationService(
        ConversationStore(conversations_path),
        app_module.memory_store,
    )
