from fastapi.testclient import TestClient

from kort_api.app import app


client = TestClient(app)


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
