import asyncio
from collections.abc import AsyncIterator, Iterator

import pytest

from kort_api.model_client import ModelCallError, OpenAICompatibleClient
from kort_api.orchestration import (
    _enabled_candidates,
    _produce_final_answer,
    _stream_final_answer,
    run_solo_thinking_stream,
)
from kort_api.schemas import AgentDefinition, ProviderProfile

REASON = "Model call failed with HTTP 401: Authorization Required"


def _provider(provider_id: str, **overrides) -> dict:
    base = {
        "provider_id": provider_id,
        "label": provider_id.title(),
        "provider_type": "deepseek",
        "base_url": "https://api.deepseek.com",
        "api_style": "openai",
        "default_model": "deepseek-chat",
        "env_key_name": f"KORT_TEST_{provider_id.upper()}_KEY",
        "enabled": True,
    }
    return ProviderProfile(**{**base, **overrides}).model_dump(mode="json")


def _agent(name: str, role: str, provider_id: str, **overrides) -> dict:
    base = {
        "name": name,
        "nickname": name,
        "role": role,
        "provider_profile": provider_id,
        "model": "deepseek-chat",
        "system_prompt": f"You are {name}.",
    }
    return AgentDefinition(**{**base, **overrides}).model_dump(mode="json")


def _state(**overrides) -> dict:
    base = {
        "question": "What is the value of a round table?",
        # The synthesizer is preferred first, so a rejected key there used to end the answer.
        "agents": [
            _agent("synthesizer-main", "synthesizer", "anthropic"),
            _agent("research-lead", "expert", "deepseek"),
        ],
        "providers": [_provider("anthropic"), _provider("deepseek")],
        "secrets": {"anthropic": "sk-rejected", "deepseek": "sk-accepted"},
        "stage_summaries": [],
    }
    return {**base, **overrides}


def _reject_anthropic(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_chat(self, *, provider: ProviderProfile, **_kwargs) -> str:
        if provider.provider_id == "anthropic":
            raise ModelCallError(REASON)
        return f"answer from {provider.provider_id}"

    monkeypatch.setattr(OpenAICompatibleClient, "chat", fake_chat)


def test_candidate_list_keeps_every_reachable_provider() -> None:
    state = _state()
    candidates = _enabled_candidates(state["agents"], state["providers"], state["secrets"])
    assert [provider["provider_id"] for _, provider in candidates] == ["anthropic", "deepseek"]


def test_candidate_list_skips_disabled_and_keyless_providers(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("KORT_TEST_DEEPSEEK_KEY", raising=False)
    state = _state(
        providers=[_provider("anthropic"), _provider("deepseek", enabled=False)],
        secrets={"anthropic": "sk-rejected"},
    )
    candidates = _enabled_candidates(state["agents"], state["providers"], state["secrets"])
    assert [provider["provider_id"] for _, provider in candidates] == ["anthropic"]


def test_final_answer_falls_back_to_the_next_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    _reject_anthropic(monkeypatch)
    result = _produce_final_answer(_state())
    assert result["final_answer_text"] == "answer from deepseek"


def test_final_answer_names_every_rejected_provider(monkeypatch: pytest.MonkeyPatch) -> None:
    def fake_chat(self, *, provider: ProviderProfile, **_kwargs) -> str:
        raise ModelCallError(REASON)

    monkeypatch.setattr(OpenAICompatibleClient, "chat", fake_chat)
    body = _produce_final_answer(_state())["final_answer_text"]
    assert "anthropic" in body and "deepseek" in body
    assert "401" in body


def test_streamed_final_answer_falls_back_without_repeating_output(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_stream_chat(self, *, provider: ProviderProfile, **_kwargs) -> Iterator[str]:
        if provider.provider_id == "anthropic":
            raise ModelCallError(REASON)
        yield f"answer from {provider.provider_id}"

    monkeypatch.setattr(OpenAICompatibleClient, "stream_chat", fake_stream_chat)
    assert "".join(_stream_final_answer(_state())) == "answer from deepseek"


def test_streamed_final_answer_never_restarts_a_half_finished_stream(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    def fake_stream_chat(self, *, provider: ProviderProfile, **_kwargs) -> Iterator[str]:
        if provider.provider_id == "anthropic":
            yield "partial answer"
            raise ModelCallError("connection reset")
        yield "second answer"

    monkeypatch.setattr(OpenAICompatibleClient, "stream_chat", fake_stream_chat)
    chunks = list(_stream_final_answer(_state()))
    assert chunks[0] == "partial answer"
    assert "second answer" not in "".join(chunks)
    assert "connection reset" in chunks[-1]


def test_solo_thinking_stream_falls_back(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_thinking_stream(
        self, *, provider: ProviderProfile, **_kwargs
    ) -> AsyncIterator[dict[str, str]]:
        if provider.provider_id == "anthropic":
            raise ModelCallError(REASON)
        yield {"type": "answer", "text": "solo answer"}

    monkeypatch.setattr(OpenAICompatibleClient, "stream_model_with_thinking", fake_thinking_stream)

    async def collect() -> list[str]:
        state = _state()
        return [
            event
            async for event in run_solo_thinking_stream(
                state["question"],
                [AgentDefinition(**agent) for agent in state["agents"]],
                [ProviderProfile(**provider) for provider in state["providers"]],
                state["secrets"],
            )
        ]

    events = asyncio.run(collect())
    body = "".join(events)
    assert "solo answer" in body
    assert "401" not in body
