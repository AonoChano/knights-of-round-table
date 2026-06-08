from pathlib import Path

from fastapi.testclient import TestClient

from kort_api.app import app
from kort_api.config import settings
from kort_api.conversations import ConversationStore
from kort_api.request_router import RouteDecision, route_request
from kort_api.schemas import ConversationRecord, ConversationRequest


client = TestClient(app)


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
    path = Path(settings.secrets_file)
    if not path.exists():
        return
    import json

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
