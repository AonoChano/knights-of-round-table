import json

import pytest
from fastapi.testclient import TestClient

import kort_api.app as app_module
from kort_api.model_client import OpenAICompatibleClient, apply_thinking_parameters
from kort_api.providers import model_is_selected, provider_is_reachable
from kort_api.schemas import ProviderProfile, ProviderType

client = TestClient(app_module.app)


class _Response:
    """Minimal stand-in for an httpx response."""

    def __init__(self, status_code: int = 200, payload: dict | None = None, text: str = "") -> None:
        self.status_code = status_code
        self.text = text
        self._payload = payload

    def json(self) -> dict:
        if self._payload is None:
            raise ValueError("response body is not json")
        return self._payload

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise AssertionError(f"unexpected HTTP {self.status_code}")


def _validate(payload: dict) -> dict:
    response = client.post("/api/model-probes", json=payload)
    assert response.status_code == 200, response.text
    return response.json()


def _profile(**overrides) -> ProviderProfile:
    base = {
        "provider_id": "deepseek",
        "label": "DeepSeek",
        "provider_type": ProviderType.deepseek,
        "base_url": "https://api.deepseek.com",
        "api_style": "openai",
        "default_model": "deepseek-flash",
        "env_key_name": "DEEPSEEK_API_KEY",
    }
    return ProviderProfile(**{**base, **overrides})


# ---------------------------------------------------------------------------
# /api/providers/validate
# ---------------------------------------------------------------------------


def test_validate_trusts_a_published_model_list(monkeypatch: pytest.MonkeyPatch) -> None:
    seen: list[tuple[str, str]] = []

    def fake_request(method: str, url: str, **_kwargs):
        seen.append((method, url))
        if method == "GET":
            return _Response(payload={"data": [{"id": "deepseek-flash"}, {"id": "deepseek-v4-pro"}]})
        raise AssertionError("a visible model list already proves the key works; no completion should be requested")

    monkeypatch.setattr("kort_api.probe.httpx.request", fake_request)

    body = _validate(
        {
            "base_url": "https://api.deepseek.com",
            "api_style": "openai",
            "provider_type": "deepseek",
            "api_key": "sk-test-value",
            "models": ["deepseek-flash", "deepseek-nope"],
        }
    )

    assert seen == [("GET", "https://api.deepseek.com/models")]
    assert body["ok"] is False
    assert body["status"] == "rejected"
    assert body["discovered_models"] == ["deepseek-flash", "deepseek-v4-pro"]
    assert body["missing_models"] == ["deepseek-nope"]
    assert "sk-test-value" not in json.dumps(body)


def test_validate_falls_back_to_a_one_token_call(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict] = []

    def fake_request(method: str, url: str, **kwargs):
        calls.append({"method": method, "url": url, **kwargs})
        if method == "GET":
            return _Response(status_code=404, text="no model list here")
        return _Response(payload={"choices": [{"message": {"content": "pong"}}]})

    monkeypatch.setattr("kort_api.probe.httpx.request", fake_request)

    body = _validate(
        {
            "base_url": "https://example.com/v1/",
            "api_style": "openai",
            "provider_type": "custom",
            "api_key": "sk-abcdef123456",
            "models": ["some-model"],
        }
    )

    assert body["ok"] is True
    assert body["status"] == "valid"
    assert "test call" in body["message"]
    ping = calls[1]
    assert ping["url"] == "https://example.com/v1/chat/completions"
    assert ping["json"] == {
        "model": "some-model",
        "messages": [{"role": "user", "content": "ping"}],
        "max_tokens": 1,
        "temperature": 0,
    }
    assert ping["headers"]["Authorization"] == "Bearer sk-abcdef123456"


def test_validate_stops_at_the_first_refusal(monkeypatch: pytest.MonkeyPatch) -> None:
    attempts: list[str] = []

    def fake_request(method: str, url: str, **_kwargs):
        attempts.append(url)
        return _Response(status_code=401, text="invalid api key")

    monkeypatch.setattr("kort_api.probe.httpx.request", fake_request)

    body = _validate(
        {
            "base_url": "https://api.moonshot.cn/v1",
            "api_style": "openai",
            "provider_type": "kimi",
            "api_key": "sk-wrong-key",
            "models": ["kimi-k3"],
        }
    )

    assert body["ok"] is False
    assert body["status"] == "unauthorized"
    assert attempts == ["https://api.moonshot.cn/v1/models"]


def test_validate_uses_anthropic_headers_for_messages_apis(monkeypatch: pytest.MonkeyPatch) -> None:
    calls: list[dict] = []

    def fake_request(method: str, url: str, **kwargs):
        calls.append({"method": method, "url": url, **kwargs})
        return _Response(status_code=404, text="no model list") if method == "GET" else _Response(
            payload={"content": [{"type": "text", "text": "pong"}]}
        )

    monkeypatch.setattr("kort_api.probe.httpx.request", fake_request)

    body = _validate(
        {
            "base_url": "https://open.bigmodel.cn/api/anthropic",
            "api_style": "anthropic",
            "provider_type": "bigmodel",
            "api_key": "sk-secret-token",
            "models": ["glm-4.6"],
        }
    )

    assert body["ok"] is True
    ping = calls[1]
    assert ping["url"] == "https://open.bigmodel.cn/api/anthropic/v1/messages"
    assert ping["headers"]["x-api-key"] == "sk-secret-token"
    assert ping["headers"]["anthropic-version"] == "2023-06-01"
    assert "Authorization" not in ping["headers"]
    assert ping["json"]["max_tokens"] == 1


def test_validate_requires_a_base_url_and_a_key() -> None:
    assert _validate({"base_url": "api.deepseek.com"})["status"] == "invalid_base_url"
    assert _validate({"base_url": "https://api.deepseek.com", "api_style": "mistyped"})["status"] == "rejected"
    assert _validate({"base_url": "https://api.deepseek.com", "models": ["x"]})["status"] == "missing_key"


def test_validate_reports_when_no_model_can_be_probed(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "kort_api.probe.httpx.request",
        lambda method, url, **_kwargs: _Response(status_code=404, text="missing"),
    )

    body = _validate(
        {
            "base_url": "https://api.example-vendor.com/v1",
            "api_style": "openai",
            "provider_type": "custom",
            "api_key": "sk-any-key",
            "models": [],
        }
    )

    assert body["ok"] is False
    assert body["status"] == "rejected"
    assert "at least one model ID" in body["message"]


# ---------------------------------------------------------------------------
# provider CRUD
# ---------------------------------------------------------------------------


def _kimi_payload() -> dict:
    return {
        "label": "Kimi",
        "provider_type": "kimi",
        "base_url": "https://api.moonshot.cn/v1",
        "api_style": "openai",
        "default_model": "kimi-k3",
        "env_key_name": "MOONSHOT_API_KEY",
        "enabled": True,
        "capabilities": ["chat", "reasoning"],
        "catalog_id": "kimi",
        "billing_type": "pay_as_you_go",
        "models": [
            {"id": "kimi-k3", "label": "Kimi K3", "enabled": True, "capabilities": ["reasoning", "vision"]},
            {"id": "kimi-k2.6", "label": "Kimi K2.6", "enabled": False, "capabilities": ["vision"]},
        ],
    }


def test_created_profile_keeps_its_model_rows() -> None:
    created = client.post("/api/providers/kimi", json=_kimi_payload())

    assert created.status_code == 201
    profile = created.json()
    assert profile["provider_id"] == "kimi"
    assert profile["billing_type"] == "pay_as_you_go"
    assert [model["id"] for model in profile["models"]] == ["kimi-k3", "kimi-k2.6"]


def test_creating_a_duplicate_provider_is_refused() -> None:
    assert client.post("/api/providers/deepseek", json=_kimi_payload()).status_code == 409


def test_deleting_a_provider_also_drops_its_stored_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)
    monkeypatch.delenv("MOONSHOT_API_KEY", raising=False)
    client.post("/api/providers/kimi", json=_kimi_payload())
    client.put("/api/providers/kimi/secret", json={"api_key": "sk-stored-key"})
    assert client.get("/api/provider-secrets").json() == [
        {"provider_id": "deepseek", "configured": False, "env_configured": False},
        {"provider_id": "kimi", "configured": True, "env_configured": False},
    ]

    assert client.delete("/api/providers/kimi").status_code == 204
    assert client.delete("/api/providers/kimi").status_code == 404
    assert [item["provider_id"] for item in client.get("/api/providers").json()] == ["deepseek"]
    assert client.get("/api/provider-secrets").json() == [
        {"provider_id": "deepseek", "configured": False, "env_configured": False}
    ]


def test_profiles_without_model_rows_still_validate() -> None:
    payload = _kimi_payload()
    payload.pop("models")
    payload.pop("billing_type")
    payload.pop("catalog_id")

    created = client.post("/api/providers/kimi", json=payload)

    assert created.status_code == 201
    assert created.json()["models"] == []
    assert created.json()["billing_type"] == "pay_as_you_go"


# ---------------------------------------------------------------------------
# seat eligibility
# ---------------------------------------------------------------------------


def test_env_only_provider_still_earns_seats(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DEEPSEEK_API_KEY", "sk-from-environment")
    profile = _profile(models=[{"id": "deepseek-flash"}, {"id": "glm-4.6", "enabled": False}])

    assert provider_is_reachable(profile, secrets={}) is True
    assert provider_is_reachable(profile.model_copy(update={"enabled": False}), secrets={}) is False
    assert provider_is_reachable(profile.model_copy(update={"api_style": "mistyped"}), secrets={}) is False
    assert model_is_selected(profile, "deepseek-flash") is True
    assert model_is_selected(profile, "glm-4.6") is False
    assert model_is_selected(profile, "") is True
    assert model_is_selected(profile.model_copy(update={"models": []}), "whatever-the-agent-names") is True
    # 档案没列出的模型交给厂商判断，否则老 ID 会把整张桌子清空
    assert model_is_selected(profile, "deepseek-chat") is True


def test_saved_key_beats_an_unset_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DEEPSEEK_API_KEY", raising=False)

    assert provider_is_reachable(_profile(), secrets={"deepseek": "sk-saved"}) is True
    assert provider_is_reachable(_profile(), secrets={}) is False
    assert provider_is_reachable(_profile(provider_type=ProviderType.ollama), secrets={}) is True


# ---------------------------------------------------------------------------
# request bodies per protocol and per vendor
# ---------------------------------------------------------------------------


class _PostCapture:
    def __init__(self, payload: dict) -> None:
        self.calls: list[dict] = []
        self._payload = payload

    def __call__(self, url: str, **kwargs) -> _Response:
        self.calls.append({"url": url, **kwargs})
        return _Response(payload=self._payload)

    @property
    def json(self) -> dict:
        return self.calls[0]["json"]

    @property
    def headers(self) -> dict:
        return self.calls[0]["headers"]


@pytest.mark.parametrize(
    ("provider_type", "default_model", "expected"),
    [
        ("deepseek", "deepseek-flash", {"thinking": {"type": "disabled"}}),
        ("bigmodel", "glm-4.6", {"thinking": {"type": "disabled"}}),
        ("kimi", "kimi-k2.6", {"thinking": {"type": "disabled"}}),
        ("bailian", "qwen3.8-max", {"enable_thinking": False}),
        ("qianwen", "qwen3.8-max", {"enable_thinking": False}),
        ("xiaomi", "mimo-v2.6-pro", {"thinking": {"type": "disabled"}}),
        # Always-reasoning models reject a disable switch, and vendors without a
        # documented switch get nothing at all rather than an unknown field.
        ("bigmodel", "glm-5.3", {}),
        ("kimi", "kimi-k3", {}),
        ("minimax", "MiniMax-M3", {}),
        ("openai", "gpt-5.4", {}),
        ("custom", "some-model", {}),
    ],
)
def test_disable_thinking_uses_each_vendors_own_switch(
    monkeypatch: pytest.MonkeyPatch,
    provider_type: str,
    default_model: str,
    expected: dict,
) -> None:
    capture = _PostCapture({"choices": [{"message": {"content": "ok"}}]})
    monkeypatch.setattr("kort_api.model_client.httpx.post", capture)

    OpenAICompatibleClient({"anything": "sk-secret-token"}).chat(
        provider=_profile(
            provider_id="anything",
            label=provider_type,
            provider_type=ProviderType(provider_type),
            base_url=f"https://api.{provider_type}.example.com/v1",
            default_model=default_model,
            env_key_name="UNUSED_TEST_KEY",
        ),
        prompt="hi",
        system_prompt="sys",
        disable_thinking=True,
    )

    payload = capture.json
    for key, value in expected.items():
        assert payload[key] == value
    for key in ("thinking", "enable_thinking", "reasoning_effort"):
        if key not in expected:
            assert key not in payload


def test_enable_thinking_is_requested_only_from_vendors_that_accept_it() -> None:
    cases = (
        (ProviderType.openai, "gpt-5.4", "https://api.openai.com/v1", {"reasoning_effort": "high"}),
        (ProviderType.deepseek, "deepseek-v4-pro", "https://api.deepseek.com", {"thinking": {"type": "enabled"}}),
        (ProviderType.custom, "any-model", "https://models.example.com/v1", {}),
    )
    payloads: list[dict] = []
    for provider_type, model, base_url, _expected in cases:
        payload: dict = {}
        apply_thinking_parameters(
            payload,
            _profile(
                provider_id=provider_type.value,
                provider_type=provider_type,
                base_url=base_url,
                default_model=model,
                env_key_name="UNUSED_TEST_KEY",
            ),
            disable_thinking=False,
            enable_thinking=True,
        )
        payloads.append(payload)

    assert payloads == [expected for _type, _model, _url, expected in cases]


def test_anthropic_style_calls_the_messages_endpoint(monkeypatch: pytest.MonkeyPatch) -> None:
    capture = _PostCapture({"content": [{"type": "thinking", "thinking": "hmm"}, {"type": "text", "text": " hi "}]})
    monkeypatch.setattr("kort_api.model_client.httpx.post", capture)

    answer = OpenAICompatibleClient({"anthropic": "sk-ant-secret"}).chat(
        provider=_profile(
            provider_id="anthropic",
            label="Anthropic",
            provider_type=ProviderType.anthropic,
            base_url="https://api.anthropic.com/v1",
            api_style="anthropic",
            default_model="claude-sonnet-5-5",
            env_key_name="ANTHROPIC_API_KEY",
        ),
        prompt="hi",
        system_prompt="sys",
    )

    assert answer == "hi"
    assert capture.calls[0]["url"] == "https://api.anthropic.com/v1/messages"
    assert capture.headers["x-api-key"] == "sk-ant-secret"
    assert capture.json["system"] == "sys"
    assert capture.json["messages"] == [{"role": "user", "content": "hi"}]
    assert capture.json["max_tokens"] == 8000


def test_responses_style_uses_input_and_streams_output_text(monkeypatch: pytest.MonkeyPatch) -> None:
    lines = [
        'data: {"type":"response.created","response":{"id":"resp_1"}}',
        'data: {"type":"response.output_text.delta","delta":"Hel"}',
        'data: {"type":"response.output_text.delta","delta":"lo"}',
        "data: [DONE]",
    ]

    class _Stream:
        status_code = 200
        text = ""

        def __enter__(self) -> "_Stream":
            return self

        def __exit__(self, *_exc) -> bool:
            return False

        def read(self) -> None:
            return None

        def iter_lines(self):
            yield from lines

    calls: list[dict] = []
    monkeypatch.setattr(
        "kort_api.model_client.httpx.stream",
        lambda method, url, **kwargs: calls.append({"method": method, "url": url, **kwargs}) or _Stream(),
    )

    chunks = list(
        OpenAICompatibleClient({"openai": "sk-openai-key"}).stream_chat(
            provider=_profile(
                provider_id="openai",
                label="OpenAI",
                provider_type=ProviderType.openai,
                base_url="https://api.openai.com/v1",
                api_style="openai_responses",
                default_model="gpt-5.4",
                env_key_name="UNUSED_TEST_KEY",
            ),
            prompt="hi",
            system_prompt="sys",
        )
    )

    assert chunks == ["Hel", "lo"]
    assert calls[0]["url"] == "https://api.openai.com/v1/responses"
    assert calls[0]["json"]["instructions"] == "sys"
    assert calls[0]["json"]["input"] == [{"role": "user", "content": "hi"}]
    assert calls[0]["json"]["stream"] is True
