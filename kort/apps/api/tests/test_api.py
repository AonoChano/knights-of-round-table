import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

import kort_api.app as app_module
import kort_api.orchestration as orchestration
from kort_api.agents import AgentLoader
from kort_api.conversations import ConversationJob, ConversationStore, VisibleConversationService
from kort_api.providers import ProviderStore
from kort_api.request_router import RouteDecision, route_request
from kort_api.schemas import (
    CANCELLED_ROUND_LIMITATION,
    ConversationRecord,
    ConversationRequest,
    ConversationRound,
    FinalAnswer,
)


client = TestClient(app_module.app)


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
        json.dumps(
            [
                {
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
            ],
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    app_module.provider_store = ProviderStore(profiles_file, secrets_file)
    app_module.agent_loader = AgentLoader(runtime_root)
    app_module.conversation_service = VisibleConversationService(ConversationStore(conversations_path))


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

_AGENT_BASE: dict = {
    "nickname": "Test Agent",
    "role": "expert",
    "provider_profile": "deepseek",
    "model": "deepseek-chat",
    "system_prompt": "You are a helpful test agent.",
}


def _make_agent_name(prefix: str = "test-agent") -> str:
    """Generate a unique agent name with a letter suffix (name pattern: ^[a-z-]+$)."""
    _make_agent_name._counter += 1  # type: ignore[attr-defined]
    n = _make_agent_name._counter  # type: ignore[attr-defined]
    suffix = ""
    while True:
        suffix = chr(ord("a") + (n - 1) % 26) + suffix
        n = (n - 1) // 26
        if n <= 0:
            break
    return f"{prefix}-{suffix}"


_make_agent_name._counter = 0  # type: ignore[attr-defined]


def _create(name: str) -> dict:
    """Create a test agent and return the parsed JSON body."""
    payload = {**_AGENT_BASE, "name": name}
    resp = client.post("/api/agents", json=payload)
    assert resp.status_code == 201, f"Create helper failed: {resp.status_code} {resp.text}"
    return resp.json()


def _delete(name: str) -> None:
    """Best-effort delete of a test agent."""
    client.delete(f"/api/agents/{name}")


def _clear_test_secret(provider_id: str) -> None:
    path = app_module.provider_store.secrets_path
    if not path.exists():
        return

    data = json.loads(path.read_text(encoding="utf-8"))
    if isinstance(data, dict) and provider_id in data:
        data.pop(provider_id)
        path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _event_names(stream_text: str) -> list[str]:
    return [
        line.removeprefix("event:").strip()
        for line in stream_text.splitlines()
        if line.startswith("event:")
    ]


# ---------------------------------------------------------------------------
# existing tests
# ---------------------------------------------------------------------------


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_developer_runtime_reports_safe_metadata() -> None:
    response = client.get("/api/developer/runtime")
    payload = response.json()

    assert response.status_code == 200
    assert "conversation_store_path" in payload
    assert isinstance(payload["conversation_count"], int)
    assert "secret-test-key" not in response.text


def test_api_stores_are_isolated_from_local_runtime(tmp_path: Path) -> None:
    root = tmp_path.resolve()

    assert app_module.provider_store.path.resolve().is_relative_to(root)
    assert app_module.provider_store.secrets_path.resolve().is_relative_to(root)
    assert app_module.agent_loader.agents_root.resolve().is_relative_to(root)
    assert app_module.agent_loader.skills_root.resolve().is_relative_to(root)
    assert app_module.conversation_service.store.path.resolve().is_relative_to(root)


def test_developer_log_level_can_be_updated() -> None:
    response = client.put("/api/developer/log-level", json={"level": "DEBUG"})
    assert response.status_code == 200
    assert response.json() == {"level": "DEBUG"}

    response = client.put("/api/developer/log-level", json={"level": "INFO"})
    assert response.status_code == 200
    assert response.json() == {"level": "INFO"}


def test_visible_conversation_payload_hides_internal_discussion() -> None:
    response = client.post("/api/conversations/stream", json={"question": "How should I structure the MVP?", "level": "off"})

    assert response.status_code == 200
    assert "raw_discussion" not in response.text
    assert "discussion_transcript" not in response.text
    assert "event: conversation_complete" in response.text


def test_request_router_directs_simple_auto_prompt() -> None:
    decision = route_request(ConversationRequest(question="你好", level="auto"))

    assert decision.kind == "direct"
    assert decision.reason_code == "auto_trivial"


def test_request_router_respects_explicit_panel_and_deep_think() -> None:
    low = route_request(ConversationRequest(question="你好", level="low"))
    deep = route_request(ConversationRequest(question="你好", level="off", deep_think=True))
    substantive_auto = route_request(ConversationRequest(question="SQL 注入怎么防?", level="auto"))

    assert low.kind == "panel"
    assert low.max_rounds == 2
    assert deep.kind == "solo_thinking"
    assert substantive_auto.kind == "panel"


def test_auto_greeting_stream_uses_direct_route_without_thinking_events(monkeypatch) -> None:
    def fake_direct_stream(**_kwargs):
        yield 'event: final_delta\ndata: {"delta": "你好，我在。"}\n\n'

    monkeypatch.setattr("kort_api.conversations.run_direct_answer_stream", fake_direct_stream)

    response = client.post("/api/conversations/stream", json={"question": "你好", "level": "auto"})
    events = _event_names(response.text)

    assert response.status_code == 200
    assert "conversation_start" in events
    assert "final_delta" in events
    assert "conversation_complete" in events
    assert "talking_active" not in events
    assert "thinking_active" not in events
    assert "summary_start" not in events
    assert "summary_complete" not in events
    assert "thinking_complete" not in events


def test_auto_small_talk_can_be_directed_by_classifier(monkeypatch) -> None:
    def fake_classifier(**_kwargs):
        return RouteDecision(kind="direct", reason_code="auto_classifier_direct")

    def fake_direct_stream(**_kwargs):
        yield 'event: final_delta\ndata: {"delta": "我很好，你呢？"}\n\n'

    monkeypatch.setattr("kort_api.conversations.classify_auto_route", fake_classifier)
    monkeypatch.setattr("kort_api.conversations.run_direct_answer_stream", fake_direct_stream)

    response = client.post("/api/conversations/stream", json={"question": "你今天好吗？", "level": "auto"})
    events = _event_names(response.text)

    assert response.status_code == 200
    assert "final_delta" in events
    assert "conversation_complete" in events
    assert "talking_active" not in events
    assert "summary_complete" not in events
    assert "thinking_complete" not in events


def test_explicit_low_level_keeps_panel_route(monkeypatch) -> None:
    seen: dict[str, int] = {}

    def fake_discussion_stream(**kwargs):
        seen["max_rounds"] = kwargs["max_rounds"]
        yield "event: talking_active\ndata: {}\n\n"
        yield "event: thinking_complete\ndata: {}\n\n"
        yield 'event: final_delta\ndata: {"delta": "panel answer"}\n\n'

    monkeypatch.setattr("kort_api.conversations.run_discussion_stream", fake_discussion_stream)

    response = client.post("/api/conversations/stream", json={"question": "你好", "level": "low"})
    events = _event_names(response.text)

    assert response.status_code == 200
    assert seen["max_rounds"] == 2
    assert "talking_active" in events
    assert "thinking_complete" in events


def test_deep_think_off_level_uses_solo_route(monkeypatch) -> None:
    client.put("/api/providers/deepseek/secret", json={"api_key": "secret-test-key"})
    _create(_make_agent_name("solo-agent"))

    async def fake_solo_stream(**_kwargs):
        yield "event: thinking_active\ndata: {}\n\n"
        yield "event: thinking_complete\ndata: {\"elapsed_ms\": 12}\n\n"
        yield 'event: final_delta\ndata: {"delta": "solo answer"}\n\n'

    def fail_discussion_stream(**_kwargs):
        raise AssertionError("deep_think with level=off must not run panel discussion")

    monkeypatch.setattr("kort_api.conversations.run_solo_thinking_stream", fake_solo_stream)
    monkeypatch.setattr("kort_api.conversations.run_discussion_stream", fail_discussion_stream)

    response = client.post(
        "/api/conversations/stream",
        json={"question": "主线？", "level": "off", "deep_think": True},
    )
    events = _event_names(response.text)

    assert response.status_code == 200
    assert "delegation_complete" in events
    assert "thinking_active" in events
    assert "talking_active" not in events
    assert '"route_kind": "solo_thinking"' in response.text


def test_stream_persists_delegation_metadata(monkeypatch) -> None:
    client.put("/api/providers/deepseek/secret", json={"api_key": "secret-test-key"})
    _create(_make_agent_name("direct-agent"))

    def fake_direct_stream(**_kwargs):
        yield 'event: final_delta\ndata: {"delta": "direct answer"}\n\n'

    monkeypatch.setattr("kort_api.conversations.run_direct_answer_stream", fake_direct_stream)

    response = client.post(
        "/api/conversations/stream",
        json={"question": "Hello", "level": "off"},
    )

    assert response.status_code == 200
    assert "event: delegation_complete" in response.text
    assert '"route_kind": "direct"' in response.text
    assert '"delegation": {' in response.text
    assert '"participant_count": 1' in response.text


def test_new_post_replaces_running_job() -> None:
    conversation_id = "replace-running-job"
    old_job = ConversationJob(conversation_id)
    app_module.conversation_service.jobs[conversation_id] = old_job

    response = client.post(
        "/api/conversations/stream",
        json={"conversation_id": conversation_id, "question": "Hello", "level": "off"},
    )

    assert response.status_code == 200
    assert old_job.cancel_requested is True
    assert app_module.conversation_service.jobs[conversation_id] is not old_job


def test_cancel_persists_partial_round_from_cached_events() -> None:
    conversation_id = "cancelled-history"
    service = app_module.conversation_service
    job = ConversationJob(conversation_id, question="Keep this as context", expert_count=1)
    job.append(service._sse("conversation_start", {"conversation_id": conversation_id, "question": "Keep this as context"}))
    job.append(
        service._sse(
            "delegation_complete",
            {
                "route_kind": "direct",
                "reason_code": "off_direct",
                "discussion_level": "off",
                "deep_think": False,
                "participant_count": 1,
                "max_rounds": 0,
                "agents": [],
            },
        )
    )
    job.append(
        service._sse(
            "summary_complete",
            {
                "id": "summary-a",
                "stage": "thinking",
                "title": "Framing",
                "snippet": "Framing the question",
                "details": "I am framing the question.",
                "confidence": 0.7,
                "tree_nodes": [],
            },
        )
    )
    job.append(service._sse("final_delta", {"delta": "partial answer"}))
    service.jobs[conversation_id] = job

    response = client.post(f"/api/conversations/{conversation_id}/cancel")
    detail = client.get(f"/api/conversations/{conversation_id}").json()
    round_item = detail["rounds"][0]

    assert response.status_code == 200
    assert response.json()["cancelled"] is True
    assert round_item["question"] == "Keep this as context"
    assert round_item["status"] == "cancelled"
    assert round_item["final_answer"]["body"] == "partial answer"
    assert round_item["final_answer"]["limitations"] == [CANCELLED_ROUND_LIMITATION]
    assert round_item["delegation"]["route_kind"] == "direct"
    assert round_item["stage_summaries"][0]["id"] == "summary-a"


def test_legacy_cancelled_limitation_infers_round_status() -> None:
    round_item = ConversationRound(
        round_id="legacy-cancelled",
        question="Interrupted question",
        stage_summaries=[],
        final_answer=FinalAnswer(
            title="Partial answer",
            body="",
            confidence=0.5,
            limitations=[CANCELLED_ROUND_LIMITATION],
        ),
    )

    assert round_item.status == "cancelled"


def test_legacy_cancelled_record_response_includes_status() -> None:
    conversation_id = "legacy-cancelled-api"
    file_path = app_module.conversation_service.store.path / f"{conversation_id}.json"
    file_path.write_text(
        json.dumps(
            {
                "conversation_id": conversation_id,
                "title": "Legacy cancelled",
                "expert_count": 1,
                "rounds": [
                    {
                        "round_id": "legacy-round",
                        "question": "Interrupted question",
                        "stage_summaries": [],
                        "final_answer": {
                            "title": "Partial answer",
                            "body": "",
                            "confidence": 0.5,
                            "limitations": [CANCELLED_ROUND_LIMITATION],
                        },
                        "delegation": None,
                    }
                ],
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )

    response = client.get(f"/api/conversations/{conversation_id}")
    round_item = response.json()["rounds"][0]

    assert response.status_code == 200
    assert round_item["status"] == "cancelled"


def test_cancelled_round_is_used_as_followup_context(monkeypatch) -> None:
    conversation_id = "cancelled-context"
    service = app_module.conversation_service
    job = ConversationJob(conversation_id, question="Interrupted question", expert_count=1)
    service.jobs[conversation_id] = job
    client.post(f"/api/conversations/{conversation_id}/cancel")

    captured: dict[str, str] = {}

    def fake_direct_stream(**kwargs):
        captured["question"] = kwargs["question"]
        yield 'event: final_delta\ndata: {"delta": "follow-up"}\n\n'

    monkeypatch.setattr("kort_api.conversations.run_direct_answer_stream", fake_direct_stream)

    response = client.post(
        "/api/conversations/stream",
        json={"conversation_id": conversation_id, "question": "Continue from there", "level": "off"},
    )

    assert response.status_code == 200
    assert "User: Interrupted question" in captured["question"]
    assert "Assistant: [Response was stopped by the user.]" in captured["question"]
    assert captured["question"].endswith("User: Continue from there")


def test_panel_expert_and_critic_calls_disable_provider_thinking(monkeypatch) -> None:
    calls: list[tuple[str, bool]] = []

    def fake_call_model(*, agent, disable_thinking=False, **_kwargs):
        calls.append((agent["role"], disable_thinking))
        return f"{agent['role']} output"

    monkeypatch.setattr(orchestration, "_call_model", fake_call_model)

    state = {
        "question": "How should this work?",
        "current_round": 0,
        "max_rounds": 1,
        "expert_outputs": {},
        "critic_reviews": {},
        "discussion_transcript": [],
        "stage_summaries": [],
        "should_continue": True,
        "final_answer_text": "",
        "agents": [
            {
                "name": "expert-a",
                "nickname": "Expert A",
                "role": "expert",
                "provider_profile": "deepseek",
                "model": "deepseek-chat",
                "system_prompt": "",
                "priority": 0,
            },
            {
                "name": "critic-a",
                "nickname": "Critic A",
                "role": "critic",
                "provider_profile": "deepseek",
                "model": "deepseek-chat",
                "system_prompt": "",
                "priority": 0,
            },
        ],
        "providers": [
            {
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
        ],
        "secrets": {"deepseek": "secret-test-key"},
    }

    expert_update = orchestration._experts_think(state)
    state.update(expert_update)
    orchestration._critics_review(state)

    assert ("expert", True) in calls
    assert ("critic", True) in calls


def test_stream_conversation_uses_client_supplied_conversation_id() -> None:
    conversation_id = "client-generated-conversation"
    response = client.post(
        "/api/conversations/stream",
        json={
            "conversation_id": conversation_id,
            "question": "Hello",
            "level": "off",
        },
    )

    assert response.status_code == 200
    assert f'"conversation_id": "{conversation_id}"' in response.text


def test_conversation_store_reads_json_named_directory(tmp_path: Path) -> None:
    import json

    store_dir = tmp_path / "conversations.json"
    store_dir.mkdir()
    record = ConversationRecord(
        conversation_id="existing-history",
        title="Existing history",
        expert_count=1,
    )
    (store_dir / "existing-history.json").write_text(
        json.dumps(record.model_dump(mode="json"), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    store = ConversationStore(store_dir)

    assert store.path == store_dir
    assert [item.conversation_id for item in store.list_records()] == ["existing-history"]


def test_provider_connectivity_does_not_echo_api_key() -> None:
    response = client.post("/api/providers/deepseek/test", json={"api_key": "secret-test-key"})
    payload = response.json()

    assert response.status_code == 200
    assert payload["provider_id"] == "deepseek"
    assert payload["ok"] is True
    assert payload["status"] == "ready"
    assert "secret-test-key" not in response.text


def test_provider_connectivity_requires_key_for_remote_provider(monkeypatch) -> None:
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    _clear_test_secret("deepseek")
    response = client.post("/api/providers/deepseek/test", json={})
    payload = response.json()

    assert response.status_code == 200
    assert payload["ok"] is False
    assert payload["status"] == "missing_key"


def test_provider_secret_status_does_not_echo_secret() -> None:
    response = client.put("/api/providers/deepseek/secret", json={"api_key": "secret-test-key"})
    payload = response.json()

    assert response.status_code == 200
    assert payload == {"provider_id": "deepseek", "configured": True}
    assert "secret-test-key" not in response.text


def test_provider_secret_status_accepts_utf8_bom() -> None:
    app_module.provider_store.secrets_path.write_text(
        json.dumps({"deepseek": "secret-test-key"}, ensure_ascii=False, indent=2),
        encoding="utf-8-sig",
    )

    response = client.get("/api/provider-secrets")

    assert response.status_code == 200
    assert response.json() == [{"provider_id": "deepseek", "configured": True}]
    assert "secret-test-key" not in response.text


# ---------------------------------------------------------------------------
# Agent CRUD tests
# ---------------------------------------------------------------------------


def test_create_agent_success() -> None:
    name = _make_agent_name()
    payload = {**_AGENT_BASE, "name": name}

    resp = client.post("/api/agents", json=payload)
    assert resp.status_code == 201

    body = resp.json()
    assert body["name"] == name
    assert body["nickname"] == _AGENT_BASE["nickname"]
    assert body["role"] == _AGENT_BASE["role"]

    _delete(name)


def test_create_agent_invalid_name() -> None:
    resp = client.post("/api/agents", json={**_AGENT_BASE, "name": "Invalid-Name"})
    assert resp.status_code == 422


def test_create_agent_duplicate() -> None:
    name = _make_agent_name()
    payload = {**_AGENT_BASE, "name": name}

    client.post("/api/agents", json=payload)
    resp = client.post("/api/agents", json=payload)
    assert resp.status_code == 409

    _delete(name)


def test_update_agent_success() -> None:
    name = _make_agent_name()
    _create(name)

    resp = client.put(f"/api/agents/{name}", json={"nickname": "Updated Nickname"})
    assert resp.status_code == 200
    assert resp.json()["nickname"] == "Updated Nickname"

    _delete(name)


def test_update_agent_not_found() -> None:
    resp = client.put("/api/agents/nonexistent-agent", json={"nickname": "X"})
    assert resp.status_code == 404


def test_delete_agent_success() -> None:
    name = _make_agent_name()
    _create(name)

    resp = client.delete(f"/api/agents/{name}")
    assert resp.status_code == 204


def test_delete_agent_system_protected() -> None:
    resp = client.delete("/api/agents/summarizer-main")
    assert resp.status_code == 403


def test_delete_agent_not_found() -> None:
    resp = client.delete("/api/agents/nonexistent-agent")
    assert resp.status_code == 404


def test_agents_endpoint_returns_list() -> None:
    resp = client.get("/api/agents")
    assert resp.status_code == 200
    assert isinstance(resp.json(), list)


# ---------------------------------------------------------------------------
# Early stop convergence tests
# ---------------------------------------------------------------------------


def test_convergence_evaluation_requires_minimum_rounds() -> None:
    """Early stop should not trigger before completing at least 1 round"""
    state = {
        "question": "test",
        "current_round": 0,
        "max_rounds": 4,
        "expert_outputs": {"expert1": "output"},
        "discussion_transcript": [],
        "should_continue": True,
    }
    result = orchestration._evaluate_convergence(state)

    assert result["should_stop_early"] is False
    assert result["reason"] == "minimum_rounds_not_met"


def test_convergence_evaluation_detects_high_similarity() -> None:
    """Early stop should trigger when discussion shows high similarity"""
    # Simulate two rounds with very similar expert outputs
    state = {
        "question": "What is 2+2?",
        "current_round": 2,
        "max_rounds": 4,
        "expert_outputs": {"expert1": "The answer is 4", "expert2": "It equals 4"},
        "discussion_transcript": [
            "[Expert1 (Round 1)]:\nThe answer is definitely 4 because two plus two equals four.",
            "[Expert2 (Round 1)]:\nIt equals 4, that's basic arithmetic.",
            "[Expert1 (Round 2)]:\nThe answer is definitely 4 because two plus two equals four.",
            "[Expert2 (Round 2)]:\nIt equals 4, that's basic arithmetic.",
        ],
        "should_continue": True,
    }
    result = orchestration._evaluate_convergence(state)

    assert result["convergence_score"] >= 0.85
    assert result["should_stop_early"] is True
    assert result["reason"] == "high_similarity"


def test_text_similarity_calculation() -> None:
    """Text similarity should detect identical and different texts"""
    # Very similar texts
    similar_a = ["The answer is four because two plus two equals four"]
    similar_b = ["The answer is four since two plus two equals four"]
    similarity_high = orchestration._calculate_text_similarity(similar_a, similar_b)
    assert similarity_high > 0.7

    # Very different texts
    different_a = ["Quantum physics deals with subatomic particles"]
    different_b = ["Cooking pasta requires boiling water"]
    similarity_low = orchestration._calculate_text_similarity(different_a, different_b)
    assert similarity_low < 0.3


def test_decide_continue_triggers_early_stop() -> None:
    """_decide_continue should respect convergence evaluation"""
    state = {
        "question": "Simple question",
        "current_round": 2,
        "max_rounds": 8,
        "expert_outputs": {"expert1": "answer", "expert2": "answer"},
        "discussion_transcript": [
            "[Expert1 (Round 1)]:\nThe answer is clearly X.",
            "[Expert2 (Round 1)]:\nThe answer is clearly X.",
            "[Expert1 (Round 2)]:\nThe answer is clearly X.",
            "[Expert2 (Round 2)]:\nThe answer is clearly X.",
        ],
        "should_continue": True,
    }

    result = orchestration._decide_continue(state)

    assert result["should_continue"] is False
    assert result.get("early_stop") is True
    assert "convergence_score" in result


def test_decide_continue_respects_max_rounds() -> None:
    """_decide_continue should stop at max_rounds even without convergence"""
    state = {
        "question": "Complex question",
        "current_round": 4,
        "max_rounds": 4,
        "expert_outputs": {},
        "discussion_transcript": [],
        "should_continue": True,
    }

    result = orchestration._decide_continue(state)

    assert result["should_continue"] is False
    assert result.get("early_stop") is not True  # Not early stop, just reached limit
