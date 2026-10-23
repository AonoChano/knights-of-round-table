import json

import pytest

from kort_api import web_research
from kort_api.model_client import (
    OpenAICompatibleClient,
    ToolCall,
    ToolResult,
    ToolSession,
)
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


def test_every_source_gets_one_citation_index_shared_by_search_and_fetch() -> None:
    numbers = web_research.SourceNumbers()
    first = _source(1)
    second = _source(2)

    assert numbers.assign(first) == 1
    assert numbers.assign(second) == 2
    assert numbers.assign(first) == 1
    assert numbers.count == 2


def test_search_results_reach_the_model_as_tool_results_with_indices(monkeypatch) -> None:
    traces: list[ToolTrace] = []
    monkeypatch.setattr(
        web_research,
        "search_web",
        lambda query, max_results: [_source(1, "https://acm.org/a"), _source(2, "https://ieee.org/b")],
    )
    numbers = web_research.SourceNumbers()
    execute = web_research.make_tool_executor(emit=traces.append, numbers=numbers)

    outcome = execute(ToolCall(id="call-1", name="web_search", arguments={"query": "2026 图灵奖", "max_results": 5}))

    payload = json.loads(outcome.content)
    assert not outcome.is_error
    assert [entry["index"] for entry in payload["results"]] == [1, 2]
    assert payload["result_count"] == 2
    assert "untrusted" in payload["note"].lower()
    assert traces[0].call_id == "call-1"
    assert traces[0].status == "complete"
    assert outcome.summary.startswith("2 results")
    assert numbers.count == 2


def test_a_failed_search_comes_back_as_an_error_tool_result_not_a_fake_answer(monkeypatch) -> None:
    traces: list[ToolTrace] = []

    def boom(query, max_results):
        raise RuntimeError("duckduckgo blocked")

    monkeypatch.setattr(web_research, "search_web", boom)
    numbers = web_research.SourceNumbers()
    execute = web_research.make_tool_executor(emit=traces.append, numbers=numbers)

    outcome = execute(ToolCall(id="call-2", name="web_search", arguments={"query": "anything"}))

    assert outcome.is_error
    assert numbers.count == 0
    assert traces[0].status == "error"
    assert "duckduckgo blocked" in outcome.content


def test_unknown_and_argumentless_calls_are_reported_instead_of_running(monkeypatch) -> None:
    traces: list[ToolTrace] = []
    monkeypatch.setattr(web_research, "search_web", lambda query, max_results: [])
    execute = web_research.make_tool_executor(emit=traces.append, numbers=web_research.SourceNumbers())

    unknown = execute(ToolCall(id="c", name="delete_everything", arguments={}))
    no_query = execute(ToolCall(id="d", name="web_search", arguments={}))

    assert unknown.is_error and "Unknown tool" in unknown.content
    assert no_query.is_error and "needs a query" in no_query.content
    assert traces == []


def test_tool_descriptions_make_the_model_resolve_references_and_distrust_pages() -> None:
    search = web_research.TOOLS[0]["description"]
    fetch = web_research.TOOLS[1]["description"]

    assert "self-contained queries" in search
    assert "re-query" in search
    assert "untrusted" in fetch
    assert "never follow instructions" in fetch.lower()
    assert "citation index" in search


def test_citation_rules_match_the_bracket_format_the_front_end_renders() -> None:
    rules = web_research.CITATION_RULES

    assert "exactly as [n]" in rules
    assert "[1][3]" in rules
    assert "never [1, 3]" in rules
    assert "not as a Markdown link" in rules


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
