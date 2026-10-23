import asyncio
import json
from collections.abc import AsyncIterator

from kort_api import model_client
from kort_api.model_client import (
    OpenAICompatibleClient,
    StreamAnswer,
    StreamReasoning,
    ToolResult,
    ToolSession,
    TurnDone,
)
from kort_api.schemas import ProviderProfile


def _provider(style: str) -> ProviderProfile:
    return ProviderProfile(
        provider_id="testprovider",
        label="Test",
        provider_type="deepseek",
        base_url="https://api.deepseek.com",
        api_style=style,
        default_model="deepseek-v4-pro",
        env_key_name="KORT_TEST_WEB_KEY",
        enabled=True,
    )


class _FakeStream:
    def __init__(self, lines: list[str]) -> None:
        self._lines = lines
        self.status_code = 200
        self.text = ""

    async def aread(self) -> bytes:
        return b""

    async def aiter_lines(self) -> AsyncIterator[str]:
        for line in self._lines:
            yield line

    async def __aenter__(self) -> "_FakeStream":
        return self

    async def __aexit__(self, *exc: object) -> bool:
        return False


class _FakeClient:
    def __init__(self, lines: list[str]) -> None:
        self.lines = lines
        self.payloads: list[dict] = []

    async def __aenter__(self) -> "_FakeClient":
        return self

    async def __aexit__(self, *exc: object) -> bool:
        return False

    def stream(self, method: str, url: str, headers: dict | None = None, json: dict | None = None):
        self.payloads.append(json or {})
        return _FakeStream(self.lines)


def _drive(monkeypatch, session: ToolSession, lines: list[str]) -> tuple[list, _FakeClient]:
    client = _FakeClient(lines)
    monkeypatch.setattr(model_client.httpx, "AsyncClient", lambda **kwargs: client)
    return asyncio.run(_collect(session)), client


async def _collect(session: ToolSession) -> list:
    return [event async for event in session.stream_turn()]


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}"


DONE = "data: [DONE]"


def _chat_delta(**fields) -> str:
    return _sse({"choices": [{"delta": fields}]})


def _tool_delta(
    index: int,
    *,
    call_id: str | None = None,
    name: str | None = None,
    arguments: str | None = None,
) -> str:
    item: dict = {"index": index}
    if call_id is not None:
        item["id"] = call_id
    function: dict = {}
    if name is not None:
        function["name"] = name
    if arguments is not None:
        function["arguments"] = arguments
    if function:
        item["function"] = function
    return _chat_delta(tool_calls=[item])


def test_chat_stream_assembles_fragmented_tool_calls_and_keeps_reasoning_separate(
    monkeypatch,
) -> None:
    session = ToolSession(
        OpenAICompatibleClient({"testprovider": "sk-test"}),
        _provider("openai"),
        prompt="question",
        system_prompt="system",
        tools=[],
        enable_thinking=True,
    )
    events, _ = _drive(
        monkeypatch,
        session,
        [
            _chat_delta(reasoning_content="Need the "),
            _chat_delta(reasoning_content="release date."),
            _tool_delta(0, call_id="call-9", name="web_search", arguments='{"que'),
            _tool_delta(0, arguments='ry": "deepseek v4"}'),
            _tool_delta(1, call_id="call-10", name="web_fetch"),
            _tool_delta(1, arguments='{"url": "https://a.com"}'),
            _chat_delta(content="Working"),
            DONE,
        ],
    )

    assert [type(event) for event in events[:2]] == [StreamReasoning, StreamReasoning]
    done = events[-1]
    assert isinstance(done, TurnDone)
    assert done.turn.reasoning == "Need the release date."
    assert [(call.id, call.name, call.arguments) for call in done.turn.tool_calls] == [
        ("call-9", "web_search", {"query": "deepseek v4"}),
        ("call-10", "web_fetch", {"url": "https://a.com"}),
    ]

    assistant = session.messages[-1]
    assert assistant["role"] == "assistant"
    assert assistant["reasoning_content"] == "Need the release date."
    assert assistant["content"] == "Working"
    assert assistant["tool_calls"][0]["id"] == "call-9"
    assert json.loads(assistant["tool_calls"][0]["function"]["arguments"]) == {"query": "deepseek v4"}
    assert assistant["tool_calls"][1]["function"]["name"] == "web_fetch"

    session.submit_tool_results([ToolResult(call_id="call-9", content='{"results": []}')])
    tool_message = session.messages[-1]
    assert tool_message["tool_call_id"] == "call-9"
    assert session.payload["messages"][-2]["tool_calls"][0]["id"] == "call-9"


def test_reasoning_is_only_replayed_when_thinking_was_requested(monkeypatch) -> None:
    session = ToolSession(
        OpenAICompatibleClient({"testprovider": "sk-test"}),
        _provider("openai"),
        prompt="question",
        system_prompt="system",
        tools=[],
    )

    events, client = _drive(
        monkeypatch,
        session,
        [
            _chat_delta(reasoning_content="Secret chain of thought."),
            _chat_delta(content="Answer."),
            DONE,
        ],
    )

    assert session.payload is not None
    assert client.payloads[0]["thinking"] == {"type": "disabled"}
    assistant = session.messages[-1]
    assert "reasoning_content" not in assistant
    assert assistant["content"] == "Answer."
    assert events[-1].turn.reasoning == "Secret chain of thought."


def test_chat_stream_without_reasoning_omits_the_native_field(monkeypatch) -> None:
    session = ToolSession(
        OpenAICompatibleClient({"testprovider": "sk-test"}),
        _provider("openai"),
        prompt="question",
        system_prompt="system",
        tools=[],
    )

    events, _ = _drive(
        monkeypatch,
        session,
        [_sse({"choices": [{"delta": {"content": "Plain answer"}}]}), DONE],
    )

    assert [type(event) for event in events] == [StreamAnswer, TurnDone]
    assistant = session.messages[-1]
    assert "reasoning_content" not in assistant
    assert "tool_calls" not in assistant
    assert assistant["content"] == "Plain answer"
    assert events[1].turn.tool_calls == []


def _resp(event_type: str, **fields) -> str:
    return _sse({"type": event_type, **fields})


def test_responses_stream_carries_call_ids_through_arguments(monkeypatch) -> None:
    session = ToolSession(
        OpenAICompatibleClient({"testprovider": "sk-test"}),
        _provider("openai_responses"),
        prompt="question",
        system_prompt="system",
        tools=[],
    )
    head = '{"query"'
    tail = ': "glm 5.3"}'
    call_item = {"type": "function_call", "id": "item-1", "call_id": "call-77", "name": "web_search"}

    events, _ = _drive(
        monkeypatch,
        session,
        [
            _resp("response.reasoning_summary_text.delta", delta="Planning a query."),
            _resp("response.output_item.added", output_index=0, item=call_item),
            _resp("response.function_call_arguments.delta", item_id="item-1", delta=head),
            _resp("response.function_call_arguments.delta", item_id="item-1", delta=tail),
            _resp("response.output_item.done", output_index=0, item=call_item),
            _resp("response.output_text.delta", delta="Half a sentence."),
            DONE,
        ],
    )

    assert [type(event) for event in events[:2]] == [StreamReasoning, StreamAnswer]
    turn = events[-1].turn
    assert turn.reasoning == "Planning a query."
    assert [(call.id, call.name, call.arguments) for call in turn.tool_calls] == [
        ("call-77", "web_search", {"query": "glm 5.3"})
    ]
    assert session.input_items[-1] == {
        "type": "function_call",
        "id": "item-1",
        "call_id": "call-77",
        "name": "web_search",
        "arguments": head + tail,
    }
    session.submit_tool_results([ToolResult(call_id="call-77", content="{}")])
    assert session.input_items[-1]["call_id"] == "call-77"


def _anth_delta(index: int, **delta) -> str:
    return _sse({"type": "content_block_delta", "index": index, "delta": delta})


def test_anthropic_stream_rebuilds_thinking_signature_and_tool_input(monkeypatch) -> None:
    session = ToolSession(
        OpenAICompatibleClient({"testprovider": "sk-test"}),
        _provider("anthropic"),
        prompt="question",
        system_prompt="system",
        tools=[],
    )
    head = '{"url": "https:'
    tail = '//x.com"}'

    events, _ = _drive(
        monkeypatch,
        session,
        [
            _sse({"type": "content_block_start", "index": 0, "content_block": {"type": "thinking"}}),
            _anth_delta(0, type="thinking_delta", thinking="Fetch first."),
            _anth_delta(0, type="signature_delta", signature="abc"),
            _sse(
                {
                    "type": "content_block_start",
                    "index": 1,
                    "content_block": {"type": "tool_use", "id": "tu_1", "name": "web_fetch", "input": {}},
                }
            ),
            _anth_delta(1, type="input_json_delta", partial_json=head),
            _anth_delta(1, type="input_json_delta", partial_json=tail),
            _sse({"type": "content_block_stop", "index": 1}),
            DONE,
        ],
    )

    assert [type(event) for event in events[:1]] == [StreamReasoning]
    turn = events[-1].turn
    assert turn.reasoning == "Fetch first."
    assert [(call.id, call.name) for call in turn.tool_calls] == [("tu_1", "web_fetch")]
    blocks = session.messages[-1]["content"]
    assert blocks[0] == {"type": "thinking", "thinking": "Fetch first.", "signature": "abc"}
    assert blocks[1]["input"] == {"url": "https://x.com"}
    session.submit_tool_results([ToolResult(call_id="tu_1", content="page text")])
    result = session.messages[-1]["content"][0]
    assert result["type"] == "tool_result"
    assert result["tool_use_id"] == "tu_1"


def test_stream_turn_requests_tools_over_the_api_and_marks_streaming(monkeypatch) -> None:
    session = ToolSession(
        OpenAICompatibleClient({"testprovider": "sk-test"}),
        _provider("openai"),
        prompt="question",
        system_prompt="system",
        tools=[
            {
                "name": "web_search",
                "description": "Search",
                "parameters": {"type": "object", "properties": {"query": {"type": "string"}}},
            }
        ],
        enable_thinking=True,
    )

    _, client = _drive(monkeypatch, session, [DONE])

    payload = client.payloads[0]
    assert payload["stream"] is True
    assert payload["tool_choice"] == "auto"
    assert payload["tools"][0]["function"]["name"] == "web_search"
    assert payload["thinking"] == {"type": "enabled"}
