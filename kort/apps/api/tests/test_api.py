from fastapi.testclient import TestClient

from kort_api.app import app


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


# ---------------------------------------------------------------------------
# existing tests
# ---------------------------------------------------------------------------


def test_health() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_visible_conversation_payload_hides_internal_discussion() -> None:
    response = client.post("/api/conversations", json={"question": "How should I structure the MVP?"})
    payload = response.json()

    assert response.status_code == 200
    assert payload["status"] == "completed"
    assert payload["stage_summaries"]
    assert "final_answer" in payload
    assert "raw_discussion" not in payload


def test_provider_connectivity_does_not_echo_api_key() -> None:
    response = client.post("/api/providers/deepseek/test", json={"api_key": "secret-test-key"})
    payload = response.json()

    assert response.status_code == 200
    assert payload["provider_id"] == "deepseek"
    assert payload["ok"] is True
    assert payload["status"] == "ready"
    assert "secret-test-key" not in response.text


def test_provider_connectivity_requires_key_for_remote_provider() -> None:
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
