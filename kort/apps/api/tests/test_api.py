import json
from pathlib import Path
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

import kort_api.app as app_module
import kort_api.orchestration as orchestration
from kort_api.conversations import ConversationJob, ConversationStore
from kort_api.request_router import RouteDecision, route_request
from kort_api.schemas import (
    AgentDefinition,
    ConversationRecord,
    ConversationRequest,
    DelegationMetadata,
    DiscussionMessage,
    MessageNode,
    ProviderProfile,
    ProviderType,
    StageSummary,
)


client = TestClient(app_module.app)


def _post_user_branch(question: str, *, conversation_id: str | None = None, **fields):
    cid = conversation_id or f"test-{uuid4()}"
    response = client.post(
        f"/api/conversations/{cid}/branches",
        json={"parent_id": None, "role": "user", "content": question, **fields},
    )
    return response, cid


def _node_ids(conversation_id: str) -> tuple[str, str]:
    payload = client.get(f"/api/conversations/{conversation_id}").json()
    user_node = next(node for node in payload["nodes"] if node["role"] == "user")
    assistant_node = next(node for node in payload["nodes"] if node["role"] == "assistant")
    return user_node["node_id"], assistant_node["node_id"]



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
    response, _ = _post_user_branch("How should I structure the MVP?", level="off")

    assert response.status_code == 200
    assert "raw_discussion" not in response.text
    assert "discussion_transcript" not in response.text
    assert "event: node_complete" in response.text


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

    response, _ = _post_user_branch("你好", level="auto")
    events = _event_names(response.text)

    assert response.status_code == 200
    assert "branch_started" in events
    assert "final_delta" in events
    assert "node_complete" in events
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

    response, _ = _post_user_branch("你今天好吗？", level="auto")
    events = _event_names(response.text)

    assert response.status_code == 200
    assert "final_delta" in events
    assert "node_complete" in events
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

    response, _ = _post_user_branch("你好", level="low")
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

    response, _ = _post_user_branch("主线？", level="off", deep_think=True)
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

    response, _ = _post_user_branch("Hello", level="off")

    assert response.status_code == 200
    assert "event: delegation_complete" in response.text
    assert '"route_kind": "direct"' in response.text
    assert '"delegation": {' in response.text
    assert '"participant_count": 1' in response.text


def test_new_post_replaces_running_job() -> None:
    conversation_id = "replace-running-job"
    old_job = ConversationJob(conversation_id)
    app_module.conversation_service.jobs[conversation_id] = old_job

    response, _ = _post_user_branch("Hello", conversation_id=conversation_id, level="off")

    assert response.status_code == 200
    assert old_job.cancel_requested is True
    assert app_module.conversation_service.jobs[conversation_id] is not old_job


def _seed_cancelled_conversation(conversation_id: str) -> None:
    service = app_module.conversation_service
    user = MessageNode(node_id="user-1", role="user", content="Interrupted question")
    assistant = MessageNode(
        node_id="assistant-1",
        parent_id="user-1",
        role="assistant",
        content="",
        status="cancelled",
    )
    user.active_child_id = assistant.node_id
    service.store.append(
        ConversationRecord(
            conversation_id=conversation_id,
            title="Cancelled",
            expert_count=1,
            nodes=[user, assistant],
            active_root_id=user.node_id,
        )
    )


def test_cancel_keeps_partial_assistant_node() -> None:
    conversation_id = "cancelled-history"
    service = app_module.conversation_service
    user = MessageNode(node_id="user-1", role="user", content="Keep this as context")
    assistant = MessageNode(
        node_id="assistant-1",
        parent_id="user-1",
        role="assistant",
        status="streaming",
    )
    user.active_child_id = assistant.node_id
    service.store.append(
        ConversationRecord(
            conversation_id=conversation_id,
            title="Keep this as context",
            expert_count=1,
            nodes=[user, assistant],
            active_root_id=user.node_id,
        )
    )
    job = ConversationJob(
        conversation_id,
        user_node_id=user.node_id,
        assistant_node_id=assistant.node_id,
        question=user.content,
        expert_count=1,
    )
    job.partial_body = "partial answer"
    job.partial_summaries = [
        StageSummary(
            id="summary-a",
            stage="thinking",
            title="Framing",
            snippet="Framing the question",
            details="I am framing the question.",
            confidence=0.7,
        )
    ]
    job.delegation = DelegationMetadata(
        route_kind="direct",
        reason_code="off_direct",
        discussion_level="off",
        deep_think=False,
        participant_count=1,
    )
    service.jobs[conversation_id] = job

    response = client.post(f"/api/conversations/{conversation_id}/cancel")
    detail = client.get(f"/api/conversations/{conversation_id}").json()
    assistant_node = next(node for node in detail["nodes"] if node["role"] == "assistant")

    assert response.status_code == 200
    assert response.json()["cancelled"] is True
    assert assistant_node["content"] == "partial answer"
    assert assistant_node["status"] == "cancelled"
    assert assistant_node["delegation"]["route_kind"] == "direct"
    assert assistant_node["stage_summaries"][0]["id"] == "summary-a"
    assert detail["active_path"] == [user.node_id, assistant.node_id]


def test_legacy_rounds_are_folded_into_a_linear_tree() -> None:
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
                            "limitations": ["Conversation was paused by the user."],
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

    detail = client.get(f"/api/conversations/{conversation_id}").json()
    user_node = next(node for node in detail["nodes"] if node["role"] == "user")
    assistant_node = next(node for node in detail["nodes"] if node["role"] == "assistant")

    assert user_node["content"] == "Interrupted question"
    assert assistant_node["status"] == "cancelled"
    assert assistant_node["parent_id"] == user_node["node_id"]
    assert detail["active_path"] == [user_node["node_id"], assistant_node["node_id"]]
    assert user_node["children"] == [assistant_node["node_id"]]


def test_cancelled_reply_is_used_as_followup_context(monkeypatch) -> None:
    conversation_id = "cancelled-context"
    _seed_cancelled_conversation(conversation_id)
    captured: dict[str, str] = {}

    def fake_direct_stream(**kwargs):
        captured["question"] = kwargs["question"]
        yield 'event: final_delta\ndata: {"delta": "follow-up"}\n\n'

    monkeypatch.setattr("kort_api.conversations.run_direct_answer_stream", fake_direct_stream)

    response = client.post(
        f"/api/conversations/{conversation_id}/branches",
        json={"parent_id": "assistant-1", "role": "user", "content": "Continue from there", "level": "off"},
    )

    assert response.status_code == 200
    assert "User: Interrupted question" in captured["question"]
    assert "Assistant: [Response was stopped by the user.]" in captured["question"]
    assert captured["question"].endswith("User: Continue from there")


def test_editing_user_message_keeps_original_branch(monkeypatch) -> None:
    def fake_direct_stream(**_kwargs):
        yield 'event: final_delta\ndata: {"delta": "edited reply"}\n\n'

    monkeypatch.setattr("kort_api.conversations.run_direct_answer_stream", fake_direct_stream)
    conversation_id = "edit-branch"
    _, _ = _post_user_branch("Original question", conversation_id=conversation_id, level="off")
    original_user, original_assistant = _node_ids(conversation_id)

    edited = client.post(
        f"/api/conversations/{conversation_id}/branches",
        json={"parent_id": None, "role": "user", "content": "Edited question", "level": "off"},
    )
    detail = client.get(f"/api/conversations/{conversation_id}").json()

    assert edited.status_code == 200
    assert len(detail["nodes"]) == 4
    roots = [node for node in detail["nodes"] if node["parent_id"] is None]
    assert [node["content"] for node in roots] == ["Original question", "Edited question"]
    assert roots[0]["active_child_id"] == original_assistant
    assert roots[0]["children"] == [original_assistant]
    assert original_user in [node["node_id"] for node in detail["nodes"]]
    assert detail["active_root_id"] == roots[1]["node_id"]
    assert detail["nodes"][-1]["content"] == "edited reply"


def test_retry_adds_assistant_sibling_without_prior_reply_in_context(monkeypatch) -> None:
    questions: list[str] = []

    def fake_direct_stream(**kwargs):
        questions.append(kwargs["question"])
        yield f'event: final_delta\ndata: {json.dumps({"delta": f"reply {len(questions)}"})}\n\n'

    monkeypatch.setattr("kort_api.conversations.run_direct_answer_stream", fake_direct_stream)
    conversation_id = "retry-branch"
    _post_user_branch("Only question", conversation_id=conversation_id, level="off")
    user_id, first_assistant = _node_ids(conversation_id)

    retry = client.post(
        f"/api/conversations/{conversation_id}/branches",
        json={"parent_id": user_id, "role": "assistant", "level": "off"},
    )
    detail = client.get(f"/api/conversations/{conversation_id}").json()
    user_node = next(node for node in detail["nodes"] if node["node_id"] == user_id)

    assert retry.status_code == 200
    assert len(user_node["children"]) == 2
    assert first_assistant in user_node["children"]
    assert user_node["active_child_id"] == user_node["children"][1]
    assert detail["active_path"] == [user_id, user_node["children"][1]]
    assert questions[-1] == "User: Only question"
    assert "reply 1" not in questions[-1]


def test_selecting_a_branch_changes_the_next_context(monkeypatch) -> None:
    def fake_direct_stream(**kwargs):
        marker = "edited" if "Edited" in kwargs["question"].splitlines()[-1] else "original"
        yield f'event: final_delta\ndata: {json.dumps({"delta": f"{marker} answer"})}\n\n'

    monkeypatch.setattr("kort_api.conversations.run_direct_answer_stream", fake_direct_stream)
    conversation_id = "switch-branch"
    _post_user_branch("Original question", conversation_id=conversation_id, level="off")
    _, original_assistant = _node_ids(conversation_id)
    client.post(
        f"/api/conversations/{conversation_id}/branches",
        json={"parent_id": None, "role": "user", "content": "Edited question", "level": "off"},
    )

    switched = client.post(
        f"/api/conversations/{conversation_id}/active-path",
        json={"node_id": original_assistant},
    )
    assert switched.status_code == 200
    assert switched.json()["active_path"][-1] == original_assistant

    captured: dict[str, str] = {}

    def fake_followup_stream(**kwargs):
        captured["question"] = kwargs["question"]
        yield 'event: final_delta\ndata: {"delta": "follow-up"}\n\n'

    monkeypatch.setattr("kort_api.conversations.run_direct_answer_stream", fake_followup_stream)
    followup = client.post(
        f"/api/conversations/{conversation_id}/branches",
        json={"parent_id": original_assistant, "role": "user", "content": "Follow up", "level": "off"},
    )

    assert followup.status_code == 200
    assert "Assistant: original answer" in captured["question"]
    assert "edited answer" not in captured["question"]
    assert captured["question"].endswith("User: Follow up")


def test_generation_failure_keeps_error_node_and_retry_can_replace_it(monkeypatch) -> None:
    def failing_stream(**_kwargs):
        raise RuntimeError("provider exploded")
        yield  # pragma: no cover

    monkeypatch.setattr("kort_api.conversations.run_direct_answer_stream", failing_stream)
    conversation_id = "error-branch"
    response, _ = _post_user_branch("Will it fail?", conversation_id=conversation_id, level="off")
    detail = client.get(f"/api/conversations/{conversation_id}").json()
    user_id, failed_id = _node_ids(conversation_id)
    failed = next(node for node in detail["nodes"] if node["node_id"] == failed_id)

    assert response.status_code == 200
    assert failed["status"] == "error"
    assert "provider exploded" in failed["error"]

    def working_stream(**_kwargs):
        yield 'event: final_delta\ndata: {"delta": "recovered"}\n\n'

    monkeypatch.setattr("kort_api.conversations.run_direct_answer_stream", working_stream)
    retry = client.post(
        f"/api/conversations/{conversation_id}/branches",
        json={"parent_id": user_id, "role": "assistant", "level": "off"},
    )
    recovered = client.get(f"/api/conversations/{conversation_id}").json()
    user_node = next(node for node in recovered["nodes"] if node["node_id"] == user_id)
    active = next(node for node in recovered["nodes"] if node["node_id"] == recovered["active_path"][-1])

    assert retry.status_code == 200
    assert len(user_node["children"]) == 2
    assert active["content"] == "recovered"
    assert active["status"] == "complete"


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


def test_discussion_stream_emits_speaker_messages(monkeypatch) -> None:
    def fake_call_model(*, agent, **_kwargs):
        return f"{agent['nickname']} speaks"

    monkeypatch.setattr(orchestration, "_call_model", fake_call_model)
    monkeypatch.setattr(orchestration, "_stream_final_answer", lambda _state: iter(["final answer"]))

    agents = [
        AgentDefinition(
            name="expert-a",
            nickname="Expert A",
            role="expert",
            provider_profile="deepseek",
            model="deepseek-chat",
            system_prompt="",
        ),
        AgentDefinition(
            name="critic-a",
            nickname="Critic A",
            role="critic",
            provider_profile="deepseek",
            model="deepseek-chat",
            system_prompt="",
        ),
    ]
    providers = [
        ProviderProfile(
            provider_id="deepseek",
            label="DeepSeek",
            provider_type=ProviderType.deepseek,
            base_url="https://api.deepseek.com",
            api_style="openai",
            default_model="deepseek-chat",
            env_key_name="DEEPSEEK_API_KEY",
        )
    ]

    events = list(
        orchestration.run_discussion_stream(
            question="Should we rewrite the orchestrator?",
            agents=agents,
            providers=providers,
            secrets={"deepseek": "secret-test-key"},
            max_rounds=1,
        )
    )

    payloads = [
        DiscussionMessage.model_validate(json.loads(event.split("data: ", 1)[1]))
        for event in events
        if event.startswith("event: discussion_message")
    ]

    assert [(m.speaker, m.role) for m in payloads] == [("expert-a", "expert"), ("critic-a", "critic")]
    assert [m.round for m in payloads] == [1, 1]
    assert payloads[0].text == "Expert A speaks"
    assert payloads[1].nickname == "Critic A"
    assert any(event.startswith("event: thinking_complete") for event in events)


def test_branch_stream_uses_client_supplied_conversation_id() -> None:
    conversation_id = "client-generated-conversation"
    response = client.post(
        f"/api/conversations/{conversation_id}/branches",
        json={"parent_id": None, "role": "user", "content": "Hello", "level": "off"},
    )

    assert response.status_code == 200
    assert f'"conversation_id": "{conversation_id}"' in response.text
    assert "event: branch_started" in response.text


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


def test_provider_secret_status_does_not_echo_secret(monkeypatch) -> None:
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    response = client.put("/api/providers/deepseek/secret", json={"api_key": "secret-test-key"})
    payload = response.json()

    assert response.status_code == 200
    assert payload == {"provider_id": "deepseek", "configured": True, "env_configured": False}
    assert "secret-test-key" not in response.text


def test_provider_secret_status_accepts_utf8_bom(monkeypatch) -> None:
    monkeypatch.setenv("DEEPSEEK_API_KEY", "secret-from-environment")
    app_module.provider_store.secrets_path.write_text(
        json.dumps({"deepseek": "secret-test-key"}, ensure_ascii=False, indent=2),
        encoding="utf-8-sig",
    )

    response = client.get("/api/provider-secrets")

    assert response.status_code == 200
    assert response.json() == [
        {"provider_id": "deepseek", "configured": True, "env_configured": True}
    ]
    assert "secret-test-key" not in response.text
    assert "secret-from-environment" not in response.text


def test_provider_secret_status_reports_env_only_key(monkeypatch) -> None:
    monkeypatch.setenv("DEEPSEEK_API_KEY", "secret-from-environment")

    response = client.get("/api/provider-secrets")

    assert response.json() == [
        {"provider_id": "deepseek", "configured": False, "env_configured": True}
    ]


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


def test_system_agent_can_switch_provider() -> None:
    _create("summarizer-main")

    resp = client.put(
        "/api/agents/summarizer-main",
        json={"provider_profile": "kimi", "model": "kimi-k3"},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["provider_profile"] == "kimi"
    assert body["model"] == "kimi-k3"


def test_system_agent_role_stays_locked() -> None:
    _create("summarizer-main")

    # The edit form always echoes the unchanged role, so only a real change may be refused.
    kept = client.put("/api/agents/summarizer-main", json={"role": "expert", "nickname": "Renamed"})
    assert kept.status_code == 200
    assert kept.json()["nickname"] == "Renamed"

    resp = client.put("/api/agents/summarizer-main", json={"role": "critic"})
    assert resp.status_code == 409
    assert "role" in resp.json()["detail"]


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
    """Early stop should not trigger before completing at least 2 rounds"""
    # Test round 0
    state_round0 = {
        "question": "test",
        "current_round": 0,
        "max_rounds": 4,
        "expert_outputs": {"expert1": "output"},
        "discussion_transcript": [],
        "should_continue": True,
    }
    result0 = orchestration._evaluate_convergence(state_round0)
    assert result0["should_stop_early"] is False
    assert result0["reason"] == "minimum_rounds_not_met"

    # Test round 1
    state_round1 = {
        "question": "test",
        "current_round": 1,
        "max_rounds": 4,
        "expert_outputs": {"expert1": "output"},
        "discussion_transcript": ["something"],
        "should_continue": True,
    }
    result1 = orchestration._evaluate_convergence(state_round1)
    assert result1["should_stop_early"] is False
    assert result1["reason"] == "minimum_rounds_not_met"


def test_convergence_evaluation_detects_high_similarity() -> None:
    """Early stop should trigger when discussion shows very high similarity (92%+)"""
    # Simulate two rounds with nearly identical expert outputs
    state = {
        "question": "What is 2+2?",
        "current_round": 2,
        "max_rounds": 4,
        "expert_outputs": {"expert1": "The answer is 4", "expert2": "It equals 4"},
        "discussion_transcript": [
            "[Expert1 (Round 1)]:\nThe answer is definitely four because two plus two equals four mathematically.",
            "[Expert2 (Round 1)]:\nIt equals four, that's basic arithmetic operation.",
            "[Expert1 (Round 2)]:\nThe answer is definitely four because two plus two equals four mathematically.",
            "[Expert2 (Round 2)]:\nIt equals four, that's basic arithmetic operation.",
        ],
        "should_continue": True,
    }
    result = orchestration._evaluate_convergence(state)

    assert result["convergence_score"] >= 0.92
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


# ---------------------------------------------------------------------------
# Custom max_rounds tests
# ---------------------------------------------------------------------------


def test_request_router_uses_custom_max_rounds() -> None:
    """Router should use custom_max_rounds when provided"""
    # Low level with custom 8 rounds (default would be 2)
    request = ConversationRequest(question="Test question", level="low", custom_max_rounds=8)
    decision = route_request(request)

    assert decision.kind == "panel"
    assert decision.max_rounds == 8

    # Auto mode with custom 10 rounds (default would be 4)
    request_auto = ConversationRequest(question="Complex task", level="auto", custom_max_rounds=10)
    decision_auto = route_request(request_auto)

    assert decision_auto.kind == "panel"
    assert decision_auto.max_rounds == 10


def test_request_router_respects_default_when_no_custom() -> None:
    """Router should use default max_rounds when custom_max_rounds is None"""
    request_low = ConversationRequest(question="Test", level="low")
    decision_low = route_request(request_low)

    assert decision_low.max_rounds == 2  # Default for low

    request_high = ConversationRequest(question="Test", level="high")
    decision_high = route_request(request_high)

    assert decision_high.max_rounds == 8  # Default for high


def test_custom_max_rounds_validation() -> None:
    """custom_max_rounds should be validated between 1 and 12"""
    # Valid values should pass
    valid_request = ConversationRequest(question="Test", level="auto", custom_max_rounds=6)
    assert valid_request.custom_max_rounds == 6

    # Boundary values
    min_request = ConversationRequest(question="Test", level="auto", custom_max_rounds=1)
    assert min_request.custom_max_rounds == 1

    max_request = ConversationRequest(question="Test", level="auto", custom_max_rounds=12)
    assert max_request.custom_max_rounds == 12

    # Out of range should fail
    try:
        ConversationRequest(question="Test", level="auto", custom_max_rounds=0)
        assert False, "Should have raised validation error for 0"
    except ValueError:
        pass

    try:
        ConversationRequest(question="Test", level="auto", custom_max_rounds=13)
        assert False, "Should have raised validation error for 13"
    except ValueError:
        pass


def test_agent_model_overrides_provider_default(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict] = []

    class _Response:
        def raise_for_status(self) -> None:
            return None

        def json(self) -> dict:
            return {"choices": [{"message": {"content": "ok"}}]}

    def fake_post(url: str, **kwargs) -> _Response:
        calls.append(kwargs["json"])
        return _Response()

    monkeypatch.setattr("kort_api.model_client.httpx.post", fake_post)

    provider = {
        "provider_id": "deepseek",
        "label": "DeepSeek",
        "provider_type": "deepseek",
        "base_url": "https://api.deepseek.com",
        "api_style": "openai",
        "default_model": "provider-default-model",
        "env_key_name": "DEEPSEEK_API_KEY",
        "enabled": True,
        "capabilities": ["chat"],
    }

    orchestration._call_model(
        agent={"model": "agent-specific-model", "system_prompt": "sys"},
        provider=provider,
        system_prompt="sys",
        user_prompt="hi",
        secrets={"deepseek": "sk-test"},
    )
    orchestration._call_model(
        agent={"model": "", "system_prompt": "sys"},
        provider=provider,
        system_prompt="sys",
        user_prompt="hi",
        secrets={"deepseek": "sk-test"},
    )

    assert calls[0]["model"] == "agent-specific-model"
    assert calls[1]["model"] == "provider-default-model"


def test_model_stream_reports_http_error_without_reading_closed_body(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from kort_api.model_client import ModelCallError, OpenAICompatibleClient

    class _StreamResponse:
        status_code = 400
        text = '{"error": {"message": "The model `gpt-4.1-mini` does not exist"}}'

        def __enter__(self) -> "_StreamResponse":
            return self

        def __exit__(self, *_exc) -> bool:
            return False

        def read(self) -> None:
            return None

        def iter_lines(self):
            raise AssertionError("error responses must not be iterated")

    monkeypatch.setattr("kort_api.model_client.httpx.stream", lambda *args, **kwargs: _StreamResponse())

    provider = ProviderProfile(
        provider_id="deepseek",
        label="DeepSeek",
        provider_type=ProviderType.deepseek,
        base_url="https://api.deepseek.com",
        api_style="openai",
        default_model="gpt-4.1-mini",
        env_key_name="DEEPSEEK_API_KEY",
    )
    client = OpenAICompatibleClient({"deepseek": "sk-secret-value"})

    with pytest.raises(ModelCallError) as excinfo:
        list(client.stream_chat(provider=provider, prompt="hi", system_prompt="sys"))

    assert "HTTP 400" in str(excinfo.value)
    assert "gpt-4.1-mini" in str(excinfo.value)
    assert "sk-secret-value" not in str(excinfo.value)
