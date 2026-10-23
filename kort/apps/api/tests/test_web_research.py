import json

import pytest

from kort_api import web_research
from kort_api.model_client import OpenAICompatibleClient, ToolResult, ToolSession
from kort_api.schemas import ProviderProfile, ToolSource, ToolTrace


def _provider(style: str) -> ProviderProfile:
    return ProviderProfile(
        provider_id="testprovider",
        label="Test",
        provider_type="deepseek",
        base_url="https://api.deepseek.com",
        api_style=style,
        default_model="deepseek-chat",
        env_key_name="KORT_TEST_WEB_KEY",
        enabled=True,
    )


def _source(index: int, url: str | None = None) -> ToolSource:
    target = url or f"https://example{index}.com/story"
    return ToolSource(
        title=f"Story {index}",
        url=target,
        domain=f"example{index}.com",
        snippet=f"Snippet {index}",
    )


DDG_HTML = """
<html><body>
<div class="result">
  <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage&amp;rut=x">
    Example <b>Page</b>
  </a>
  <a class="result__snippet" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage">
    A <b>snippet</b> from the page.
  </a>
</div>
<div class="result">
  <a class="result__a" href="https://second.example.org/post">Second post</a>
  <a class="result__snippet">Second snippet.</a>
</div>
</body></html>
"""


class _FakeResponse:
    def __init__(self, text: str, payload: dict | None = None) -> None:
        self.text = text
        self._payload = payload or {}

    def raise_for_status(self) -> None:
        return None

    def json(self) -> dict:
        return self._payload


def test_duckduckgo_results_are_unwrapped_and_deduped(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("KORT_SEARXNG_URL", raising=False)
    monkeypatch.setattr(web_research.httpx, "post", lambda *args, **kwargs: _FakeResponse(DDG_HTML))

    sources = web_research.search_web("example query", 5)

    assert [source.url for source in sources] == [
        "https://example.com/page",
        "https://second.example.org/post",
    ]
    assert sources[0].title == "Example Page"
    assert sources[0].domain == "example.com"
    assert sources[0].snippet == "A snippet from the page."
    assert sources[1].snippet == "Second snippet."


def test_text_extractor_keeps_content_and_drops_chrome() -> None:
    parser = web_research._TextExtractor()
    parser.feed(
        "<html><head><title>Doc title</title>"
        '<meta name="description" content="Doc description"></head>'
        "<body><nav>Navigation</nav><script>evil()</script>"
        "<main><h1>Heading</h1><p>Hello <b>world</b></p></main>"
        "<footer>Footer</footer></body></html>"
    )

    text = parser.text()

    assert parser.title == "Doc title"
    assert parser.description == "Doc description"
    assert "Heading" in text and "Hello world" in text
    assert "Navigation" not in text
    assert "evil()" not in text
    assert "Footer" not in text


def test_text_extractor_ignores_svg_accessibility_titles() -> None:
    parser = web_research._TextExtractor()
    parser.feed(
        "<html><head><title>Real page</title></head><body>"
        "<button><svg><title>Close the search menu</title></svg></button>"
        "<p>Body copy.</p></body></html>"
    )

    assert parser.title == "Real page"
    assert "Close the search menu" not in parser.text()


def test_private_hosts_are_rejected_but_proxy_fake_ips_are_allowed(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    for host in ("localhost", "127.0.0.1", "10.0.0.2", "192.168.1.5", "169.254.1.1"):
        with pytest.raises(web_research.WebFetchError):
            web_research._resolve_public_host(host)

    web_research._resolve_public_host("198.18.0.199")

    monkeypatch.setattr(
        web_research.socket,
        "getaddrinfo",
        lambda *args, **kwargs: [(2, 1, 6, "", ("93.184.216.34", 0))],
    )
    web_research._resolve_public_host("example.com")


def test_url_validation_rejects_non_http_and_credentials() -> None:
    with pytest.raises(web_research.WebFetchError):
        web_research._validate_url("ftp://example.com/file")
    with pytest.raises(web_research.WebFetchError):
        web_research._validate_url("https://user:secret@example.com/")
    with pytest.raises(web_research.WebFetchError):
        web_research._validate_url("http://localhost:8000/api")


def test_digest_numbers_sources_once_and_attaches_fetch_excerpt() -> None:
    first = _source(1)
    second = _source(2)
    search = ToolTrace(
        id="tool-search",
        tool="search",
        status="complete",
        query="story",
        sources=[first, second],
        source_count=2,
    )
    fetch = ToolTrace(
        id="tool-fetch",
        tool="fetch",
        status="complete",
        url=second.url,
        title=second.title,
        sources=[second],
        excerpt="Fetched body text.",
        source_count=1,
    )

    digest, count = web_research.build_digest([search, fetch], "Evidence brief.")

    assert count == 2
    assert digest.count("[1] Story 1") == 1
    assert digest.count("[2] Story 2") == 1
    assert "[2] excerpt:\n   Fetched body text." in digest
    assert "untrusted evidence" in digest
    assert digest.endswith("--- End web research ---")


def test_digest_is_empty_without_completed_traces() -> None:
    failed = ToolTrace(id="tool-fail", tool="search", status="error", error="boom")
    assert web_research.build_digest([failed], "nothing") == ("", 0)


@pytest.mark.parametrize("style", ["openai", "openai_responses", "anthropic"])
def test_tool_payload_shape_matches_protocol(style: str) -> None:
    session = ToolSession(
        OpenAICompatibleClient({"testprovider": "sk-test"}),
        _provider(style),
        prompt="question",
        system_prompt="system",
        tools=web_research.TOOLS,
    )

    assert session.payload["tool_choice"] == "auto"
    tools = session.payload["tools"]
    if style == "anthropic":
        assert tools[0]["name"] == "web_search"
        assert tools[0]["input_schema"]["required"] == ["query"]
    elif style == "openai_responses":
        assert tools[0]["type"] == "function"
        assert tools[0]["name"] == "web_search"
        assert tools[0]["parameters"]["required"] == ["query"]
    else:
        assert tools[0]["type"] == "function"
        assert tools[0]["function"]["name"] == "web_search"

    session.submit_tool_results([ToolResult(call_id="call-1", content='{"ok": true}')])

    if style == "anthropic":
        result = session.messages[-1]["content"][0]
        assert result["type"] == "tool_result"
        assert result["tool_use_id"] == "call-1"
    elif style == "openai_responses":
        output = session.input_items[-1]
        assert output["type"] == "function_call_output"
        assert output["call_id"] == "call-1"
    else:
        message = session.messages[-1]
        assert message["role"] == "tool"
        assert message["tool_call_id"] == "call-1"


def test_chat_tool_turn_is_parsed_and_preserved(monkeypatch: pytest.MonkeyPatch) -> None:
    payload = {
        "choices": [
            {
                "message": {
                    "content": "",
                    "tool_calls": [
                        {
                            "id": "call-42",
                            "type": "function",
                            "function": {
                                "name": "web_search",
                                "arguments": json.dumps({"query": "kort web"}),
                            },
                        }
                    ],
                }
            }
        ]
    }
    monkeypatch.setattr(
        web_research.httpx,
        "post",
        lambda *args, **kwargs: _FakeResponse("", payload),
    )
    session = ToolSession(
        OpenAICompatibleClient({"testprovider": "sk-test"}),
        _provider("openai"),
        prompt="question",
        system_prompt="system",
        tools=web_research.TOOLS,
    )

    turn = session.run()

    assert turn.text == ""
    assert [(call.id, call.name, call.arguments) for call in turn.tool_calls] == [
        ("call-42", "web_search", {"query": "kort web"})
    ]
    assert session.messages[-1]["role"] == "assistant"
    assert session.messages[-1]["tool_calls"][0]["id"] == "call-42"
