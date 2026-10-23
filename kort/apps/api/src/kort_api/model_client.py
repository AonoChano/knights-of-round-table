from __future__ import annotations

import json
import os
import re
from collections.abc import AsyncIterator, Iterator
from dataclasses import dataclass, field
from typing import Any

import httpx

from .schemas import ProviderProfile


class ModelCallError(RuntimeError):
    pass


@dataclass
class ToolCall:
    id: str
    name: str
    arguments: dict[str, Any] = field(default_factory=dict)


@dataclass
class ToolTurn:
    text: str
    tool_calls: list[ToolCall] = field(default_factory=list)
    reasoning: str = ""


@dataclass
class ToolResult:
    call_id: str
    content: str
    is_error: bool = False


@dataclass
class StreamReasoning:
    """Native reasoning tokens streamed before the model decides on a tool."""

    text: str


@dataclass
class StreamAnswer:
    """Visible answer tokens streamed by the same turn that may also carry tool calls."""

    text: str


@dataclass
class TurnDone:
    """The turn closed; its assistant message is already committed to session history."""

    turn: ToolTurn


StreamUpdate = StreamReasoning | StreamAnswer | TurnDone


def _parse_arguments(raw: Any) -> dict[str, Any]:
    if isinstance(raw, dict):
        return raw
    if not isinstance(raw, str) or not raw.strip():
        return {}
    try:
        value = json.loads(raw)
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}


STYLE_CHAT = "openai"
STYLE_RESPONSES = "openai_responses"
STYLE_ANTHROPIC = "anthropic"
SUPPORTED_STYLES = (STYLE_CHAT, STYLE_RESPONSES, STYLE_ANTHROPIC)

ANTHROPIC_VERSION = "2023-06-01"
ANTHROPIC_MAX_TOKENS = 8000
ANTHROPIC_THINKING_BUDGET = 4000

# How each vendor switches reasoning on/off. Providers absent from this table never
# receive a reasoning parameter, because an unsupported field makes strict servers 400.
_THINKING_STYLE: dict[str, str] = {
    "deepseek": "thinking_object",
    "bigmodel": "thinking_object",
    "kimi": "thinking_object",
    "xiaomi": "thinking_object",
    "bailian": "enable_thinking",
    "qianwen": "enable_thinking",
    "openai": "reasoning_effort",
    "openrouter": "reasoning_effort",
}

# Models that reason on every request: sending them a disable switch is an error, not a no-op.
_ALWAYS_ON_REASONING = ("glm-5.3", "glm-5v", "kimi-k3", "minimax-m2.5", "minimax-m3")


def sanitize_error_text(text: str) -> str:
    redacted = re.sub(r"sk-[A-Za-z0-9_\-*]{8,}", "sk-***", text)
    redacted = re.sub(r"tp-[A-Za-z0-9_\-*]{8,}", "tp-***", text)
    redacted = re.sub(r"(api[_ -]?key[^:：]*[:：]\s*)[A-Za-z0-9_\-*]{8,}", r"\1***", redacted, flags=re.IGNORECASE)
    return redacted[:500]


def normalize_style(api_style: str) -> str:
    style = (api_style or "").strip().lower()
    if style in {"", "openai", "chat", "chat_completions", "chatcompletion"}:
        return STYLE_CHAT
    if style in {STYLE_RESPONSES, "responses", "openai_responses"}:
        return STYLE_RESPONSES
    if style in {STYLE_ANTHROPIC, "claude", "messages"}:
        return STYLE_ANTHROPIC
    raise ModelCallError(f"Unsupported api_style '{api_style}'. Use one of {', '.join(SUPPORTED_STYLES)}.")


def chat_endpoint(base_url: str, api_style: str) -> str:
    style = normalize_style(api_style)
    trimmed = base_url.rstrip("/")
    if style == STYLE_ANTHROPIC:
        return f"{trimmed}/messages" if trimmed.endswith("/v1") else f"{trimmed}/v1/messages"
    if style == STYLE_RESPONSES:
        return f"{trimmed}/responses"
    return f"{trimmed}/chat/completions"


def models_endpoint(base_url: str, api_style: str) -> str:
    """Model discovery URL. All three protocols publish one; Ollama uses the OpenAI path."""
    style = normalize_style(api_style)
    trimmed = base_url.rstrip("/")
    if style == STYLE_ANTHROPIC and not trimmed.endswith("/v1"):
        return f"{trimmed}/v1/models"
    return f"{trimmed}/models"


def provider_requires_key(provider: ProviderProfile) -> bool:
    return provider.provider_type != "ollama"


def resolve_api_key(provider: ProviderProfile, secrets: dict[str, str]) -> str:
    return (secrets.get(provider.provider_id) or os.getenv(provider.env_key_name, "")).strip()


def extract_message_text(api_style: str, data: dict) -> str:
    style = normalize_style(api_style)
    if style == STYLE_ANTHROPIC:
        blocks = data.get("content") or []
        text = "".join(
            block.get("text", "")
            for block in blocks
            if isinstance(block, dict) and block.get("type") == "text"
        )
        if not text.strip():
            raise ModelCallError("Model response did not contain any text block.")
        return text.strip()
    if style == STYLE_RESPONSES:
        if isinstance(data.get("output_text"), str) and data["output_text"].strip():
            return data["output_text"].strip()
        parts: list[str] = []
        for item in data.get("output") or []:
            if not isinstance(item, dict):
                continue
            for part in item.get("content") or []:
                if isinstance(part, dict) and part.get("type") in {"output_text", "text"}:
                    parts.append(str(part.get("text", "")))
        text = "".join(parts)
        if not text.strip():
            raise ModelCallError("Model response did not contain output_text.")
        return text.strip()
    try:
        content = data["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise ModelCallError("Model response did not contain choices[0].message.content.") from exc
    if not isinstance(content, str) or not content.strip():
        raise ModelCallError("Model response content was empty.")
    return content.strip()


def extract_stream_delta(api_style: str, data: dict) -> tuple[str, str]:
    """Return (reasoning, answer) text carried by one streamed chunk."""
    style = normalize_style(api_style)
    if style == STYLE_ANTHROPIC:
        if data.get("type") != "content_block_delta":
            return "", ""
        delta = data.get("delta") or {}
        if delta.get("type") == "thinking_delta":
            return str(delta.get("thinking", "")), ""
        if delta.get("type") == "text_delta":
            return "", str(delta.get("text", ""))
        return "", ""
    if style == STYLE_RESPONSES:
        if data.get("type") == "response.output_text.delta":
            return "", str(data.get("delta", ""))
        if data.get("type") == "response.reasoning_summary_text.delta":
            return str(data.get("delta", "")), ""
        return "", ""
    delta = (data.get("choices") or [{}])[0].get("delta", {}) if data.get("choices") else {}
    reasoning = delta.get("reasoning_content") if isinstance(delta, dict) else None
    content = delta.get("content") if isinstance(delta, dict) else None
    return (
        reasoning if isinstance(reasoning, str) else "",
        content if isinstance(content, str) else "",
    )


def model_always_reasons(provider: ProviderProfile) -> bool:
    model = provider.default_model.lower()
    return any(model.startswith(prefix) for prefix in _ALWAYS_ON_REASONING)


def apply_thinking_parameters(
    payload: dict,
    provider: ProviderProfile,
    *,
    disable_thinking: bool,
    enable_thinking: bool = False,
) -> None:
    """Set the vendor's own reasoning switch, or none at all when it has no safe one."""
    style = _thinking_style(provider)
    if style == "none":
        return
    if disable_thinking and model_always_reasons(provider):
        return
    if style == "thinking_object":
        if disable_thinking:
            payload["thinking"] = {"type": "disabled"}
        elif enable_thinking:
            payload["thinking"] = {"type": "enabled"}
        return
    if style == "enable_thinking":
        if disable_thinking:
            payload["enable_thinking"] = False
        elif enable_thinking:
            payload["enable_thinking"] = True
        return
    if style == "reasoning_effort" and enable_thinking and not disable_thinking:
        payload["reasoning_effort"] = "high"


class OpenAICompatibleClient:
    def __init__(self, secrets: dict[str, str]) -> None:
        self.secrets = secrets

    def _prepare(
        self,
        provider: ProviderProfile,
        prompt: str,
        system_prompt: str,
        *,
        stream: bool,
        disable_thinking: bool,
        enable_thinking: bool = False,
    ) -> tuple[str, dict[str, str], dict]:
        style = normalize_style(provider.api_style)
        api_key = resolve_api_key(provider, self.secrets)
        if not api_key and (style == STYLE_ANTHROPIC or provider_requires_key(provider)):
            raise ModelCallError(f"Provider {provider.provider_id} has no saved API key.")

        headers = {"Content-Type": "application/json"}
        if api_key and style == STYLE_ANTHROPIC:
            headers["x-api-key"] = api_key
            headers["anthropic-version"] = ANTHROPIC_VERSION
        elif api_key:
            headers["Authorization"] = f"Bearer {api_key}"

        url = chat_endpoint(provider.base_url, style)

        if style == STYLE_ANTHROPIC:
            payload: dict = {
                "model": provider.default_model,
                "system": system_prompt,
                "messages": [{"role": "user", "content": prompt}],
                "max_tokens": ANTHROPIC_MAX_TOKENS,
            }
            if enable_thinking and not disable_thinking:
                # Extended thinking only accepts the default sampling temperature, so omit it.
                payload["thinking"] = {"type": "enabled", "budget_tokens": ANTHROPIC_THINKING_BUDGET}
            else:
                payload["temperature"] = 0.4
        elif style == STYLE_RESPONSES:
            payload = {
                "model": provider.default_model,
                "instructions": system_prompt,
                "input": [{"role": "user", "content": prompt}],
                "temperature": 0.4,
            }
        else:
            payload = {
                "model": provider.default_model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt},
                ],
                "temperature": 0.4,
            }

        if style != STYLE_ANTHROPIC:
            apply_thinking_parameters(
                payload,
                provider,
                disable_thinking=disable_thinking,
                enable_thinking=enable_thinking,
            )

        if stream:
            payload["stream"] = True
        return url, headers, payload

    def chat(self, provider: ProviderProfile, prompt: str, system_prompt: str, *, disable_thinking: bool = False) -> str:
        url, headers, payload = self._prepare(
            provider, prompt, system_prompt, stream=False, disable_thinking=disable_thinking
        )

        try:
            response = httpx.post(url, headers=headers, json=payload, timeout=120)
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            detail = sanitize_error_text(exc.response.text)
            raise ModelCallError(f"Model call failed with HTTP {exc.response.status_code}: {detail}") from exc
        except httpx.HTTPError as exc:
            raise ModelCallError(f"Model call failed: {exc}") from exc

        return extract_message_text(provider.api_style, response.json())

    def stream_chat(
        self, provider: ProviderProfile, prompt: str, system_prompt: str, *, disable_thinking: bool = False
    ) -> Iterator[str]:
        url, headers, payload = self._prepare(
            provider, prompt, system_prompt, stream=True, disable_thinking=disable_thinking
        )

        try:
            with httpx.stream("POST", url, headers=headers, json=payload, timeout=120) as response:
                if response.status_code >= 400:
                    # 必须先读 body：流式响应未 read 时访问 .text 会抛 ResponseNotRead
                    response.read()
                    raise ModelCallError(
                        f"Model stream failed with HTTP {response.status_code}: "
                        f"{sanitize_error_text(response.text)}"
                    )
                for line in response.iter_lines():
                    _, answer = _sse_parts(line, provider.api_style)
                    if answer:
                        yield answer
        except httpx.HTTPError as exc:
            raise ModelCallError(f"Model stream failed: {exc}") from exc

    async def stream_model_with_thinking(
        self,
        provider: ProviderProfile,
        prompt: str,
        system_prompt: str,
        *,
        disable_thinking: bool = False,
        enable_thinking: bool = False,
    ) -> AsyncIterator[dict[str, str]]:
        """Stream a model response, splitting think (reasoning_content) from answer (content).

        Yields dicts with ``type`` (``"think"`` or ``"answer"``) and ``text`` (the token).
        """
        url, headers, payload = self._prepare(
            provider,
            prompt,
            system_prompt,
            stream=True,
            disable_thinking=disable_thinking,
            enable_thinking=enable_thinking,
        )

        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as client:
            try:
                async with client.stream("POST", url, headers=headers, json=payload) as response:
                    if response.status_code >= 400:
                        await response.aread()
                        raise ModelCallError(
                            f"Model stream failed with HTTP {response.status_code}: "
                            f"{sanitize_error_text(response.text)}"
                        )
                    async for line in response.aiter_lines():
                        reasoning, answer = _sse_parts(line, provider.api_style)
                        if reasoning:
                            yield {"type": "think", "text": reasoning}
                        if answer:
                            yield {"type": "answer", "text": answer}
            except httpx.HTTPError as exc:
                raise ModelCallError(f"Model stream failed: {exc}") from exc


@dataclass
class _CallSlot:
    """One tool call rebuilt from stream fragments, keyed by the provider's own slot index."""

    id: str = ""
    name: str = ""
    raw: list[str] = field(default_factory=list)
    arguments: dict[str, Any] | None = None

    @property
    def raw_arguments(self) -> str:
        return "".join(self.raw)

    def parsed(self) -> dict[str, Any]:
        if self.arguments is not None:
            return self.arguments
        return _parse_arguments(self.raw_arguments)

    def call(self, position: int) -> ToolCall:
        return ToolCall(id=self.id or f"tool-call-{position + 1}", name=self.name, arguments=self.parsed())


class _ChatStreamAccumulator:
    """Chat Completions SSE: delta.content, delta.reasoning_content, delta.tool_calls[i]."""

    def __init__(self) -> None:
        self.reasoning: list[str] = []
        self.content: list[str] = []
        self.slots: dict[Any, _CallSlot] = {}

    def feed(self, data: dict) -> tuple[str, str]:
        choice = (data.get("choices") or [{}])[0] if isinstance(data.get("choices"), list) else {}
        delta = choice.get("delta") if isinstance(choice, dict) else None
        if not isinstance(delta, dict):
            return "", ""
        reasoning = _first_text(delta, "reasoning_content", "reasoning", "thinking")
        content = delta.get("content")
        content = content if isinstance(content, str) else ""
        if reasoning:
            self.reasoning.append(reasoning)
        if content:
            self.content.append(content)
        for item in delta.get("tool_calls") or []:
            if isinstance(item, dict):
                self._consume(item)
        return reasoning, content

    def _consume(self, item: dict) -> None:
        key = item.get("index")
        if key is None:
            key = f"id:{item.get('id')}" if item.get("id") else f"pos:{len(self.slots)}"
        slot = self.slots.setdefault(key, _CallSlot())
        if isinstance(item.get("id"), str) and item["id"]:
            slot.id = item["id"]
        function = item.get("function")
        if not isinstance(function, dict):
            return
        if isinstance(function.get("name"), str) and function["name"]:
            slot.name = function["name"]
        value = function.get("arguments")
        if isinstance(value, dict):
            slot.arguments = value
            slot.raw = [json.dumps(value, ensure_ascii=False)]
        elif isinstance(value, str) and value:
            slot.raw.append(value)

    def slots_ordered(self) -> list[_CallSlot]:
        return list(self.slots.values())

    def turn(self) -> ToolTurn:
        calls = [
            slot.call(position)
            for position, slot in enumerate(self.slots_ordered())
            if slot.name or slot.id
        ]
        return ToolTurn(
            text="".join(self.content).strip(),
            tool_calls=[call for call in calls if call.name],
            reasoning="".join(self.reasoning).strip(),
        )

    def commit(self, include_reasoning: bool = True) -> dict[str, Any]:
        """Assistant message exactly as the protocol wants it replayed: native reasoning field,
        content and tool_calls with their original ids — never merged into one text blob.

        ``reasoning_content`` is only replayed while thinking is on: sending it to a endpoint
        that was asked to think less makes DeepSeek answer with tool markup in plain content.
        """
        raw_calls = [
            {
                "id": slot.id or f"tool-call-{position + 1}",
                "type": "function",
                "function": {"name": slot.name, "arguments": slot.raw_arguments},
            }
            for position, slot in enumerate(self.slots_ordered())
            if slot.name
        ]
        message: dict[str, Any] = {"role": "assistant", "content": "".join(self.content) or None}
        reasoning = "".join(self.reasoning)
        if reasoning and include_reasoning:
            message["reasoning_content"] = reasoning
        if raw_calls:
            message["tool_calls"] = raw_calls
        return message


class _ResponsesStreamAccumulator:
    """Responses SSE: output items, function_call argument deltas, output/reasoning text deltas."""

    def __init__(self) -> None:
        self.items: dict[Any, dict[str, Any]] = {}
        self.reasoning: list[str] = []
        self.content: list[str] = []
        self.error: str | None = None

    def feed(self, data: dict) -> tuple[str, str]:
        kind = data.get("type")
        if kind == "response.output_item.added":
            item = data.get("item")
            if isinstance(item, dict):
                self.items[data.get("output_index", len(self.items))] = dict(item)
            return "", ""
        if kind == "response.output_item.done":
            item = data.get("item")
            if isinstance(item, dict):
                key = data.get("output_index")
                if key is None:
                    key = next(
                        (k for k, v in self.items.items() if v.get("id") == item.get("id")),
                        len(self.items),
                    )
                merged = {**self.items.get(key, {}), **item}
                if not merged.get("arguments") and self.items.get(key, {}).get("arguments"):
                    merged["arguments"] = self.items[key]["arguments"]
                self.items[key] = merged
            return "", ""
        if kind == "response.function_call_arguments.delta":
            slot = self._argument_slot(data)
            if slot is not None:
                slot.setdefault("arguments", "")
                slot["arguments"] += str(data.get("delta") or "")
            return "", ""
        if kind in {"response.output_text.delta", "response.text.delta"}:
            text = str(data.get("delta") or "")
            self.content.append(text)
            return "", text
        if kind in {"response.reasoning_summary_text.delta", "response.reasoning_text.delta"}:
            text = str(data.get("delta") or "")
            self.reasoning.append(text)
            return text, ""
        if kind == "response.failed":
            self.error = "Responses stream reported a failed generation."
        if kind == "response.incomplete":
            self.error = "Responses stream ended incomplete."
        return "", ""

    def _argument_slot(self, data: dict) -> dict[str, Any] | None:
        for item in self.items.values():
            if item.get("type") != "function_call":
                continue
            identities = {item.get("id"), item.get("call_id")}
            if identities & {data.get("item_id"), data.get("call_id")}:
                return item
        return None

    def _final_items(self) -> list[dict[str, Any]]:
        return list(self.items.values())

    def turn(self) -> ToolTurn:
        calls: list[ToolCall] = []
        texts: list[str] = []
        for item in self._final_items():
            if item.get("type") == "function_call":
                calls.append(
                    ToolCall(
                        id=str(item.get("call_id") or item.get("id") or ""),
                        name=str(item.get("name") or ""),
                        arguments=_parse_arguments(item.get("arguments")),
                    )
                )
            elif item.get("type") == "message":
                for part in item.get("content") or []:
                    if isinstance(part, dict) and part.get("type") in {"output_text", "text"}:
                        texts.append(str(part.get("text") or ""))
        text = "".join(self.content) or "".join(texts)
        return ToolTurn(text=text.strip(), tool_calls=[c for c in calls if c.id and c.name],
                        reasoning="".join(self.reasoning).strip())

    def commit(self) -> list[dict[str, Any]]:
        """Only function_call and message items go back; reasoning items are provider-owned."""
        return [
            item
            for item in self._final_items()
            if item.get("type") in {"function_call", "message"}
        ]


class _AnthropicStreamAccumulator:
    """Messages SSE: content_block_start/delta/stop for text, thinking and tool_use blocks."""

    def __init__(self) -> None:
        self.blocks: dict[int, dict[str, Any]] = {}
        self.args: dict[int, list[str]] = {}

    def feed(self, data: dict) -> tuple[str, str]:
        kind = data.get("type")
        if kind == "content_block_start":
            block = data.get("content_block")
            if isinstance(block, dict):
                index = int(data.get("index") or 0)
                self.blocks[index] = dict(block)
                self.args.setdefault(index, [])
            return "", ""
        if kind != "content_block_delta":
            if kind == "error":
                raise ModelCallError("Model stream reported an error event.")
            return "", ""
        delta = data.get("delta") or {}
        index = int(data.get("index") or 0)
        block = self.blocks.setdefault(index, {"type": str(delta.get("type") or "text")})
        delta_type = delta.get("type")
        if delta_type == "text_delta":
            text = str(delta.get("text") or "")
            block["text"] = str(block.get("text") or "") + text
            return "", text
        if delta_type == "thinking_delta":
            text = str(delta.get("thinking") or "")
            block["thinking"] = str(block.get("thinking") or "") + text
            return text, ""
        if delta_type == "signature_delta":
            block["signature"] = str(block.get("signature") or "") + str(delta.get("signature") or "")
            return "", ""
        if delta_type == "input_json_delta":
            self.args.setdefault(index, []).append(str(delta.get("partial_json") or ""))
        return "", ""

    def _final_blocks(self) -> list[dict[str, Any]]:
        blocks: list[dict[str, Any]] = []
        for index in sorted(self.blocks):
            block = dict(self.blocks[index])
            kind = block.get("type")
            if kind == "tool_use":
                block["input"] = _parse_arguments("".join(self.args.get(index) or []))
            elif kind == "text":
                block["text"] = str(block.get("text") or "")
            elif kind == "thinking":
                block["thinking"] = str(block.get("thinking") or "")
                block.setdefault("signature", "")
            else:
                continue
            blocks.append(block)
        return blocks

    def turn(self) -> ToolTurn:
        calls: list[ToolCall] = []
        texts: list[str] = []
        thinking: list[str] = []
        for block in self._final_blocks():
            if block.get("type") == "tool_use":
                calls.append(
                    ToolCall(
                        id=str(block.get("id") or ""),
                        name=str(block.get("name") or ""),
                        arguments=block.get("input") or {},
                    )
                )
            elif block.get("type") == "text":
                texts.append(str(block.get("text") or ""))
            elif block.get("type") == "thinking":
                thinking.append(str(block.get("thinking") or ""))
        return ToolTurn(
            text="".join(texts).strip(),
            tool_calls=[call for call in calls if call.id and call.name],
            reasoning="".join(thinking).strip(),
        )

    def commit(self) -> list[dict[str, Any]]:
        return self._final_blocks()


def _first_text(data: dict, *keys: str) -> str:
    for key in keys:
        value = data.get(key)
        if isinstance(value, str) and value:
            return value
    return ""


def _stream_accumulator(style: str) -> Any:
    if style == STYLE_ANTHROPIC:
        return _AnthropicStreamAccumulator()
    if style == STYLE_RESPONSES:
        return _ResponsesStreamAccumulator()
    return _ChatStreamAccumulator()


class ToolSession:
    """Provider-neutral function-calling turn, translated per wire protocol.

    The caller supplies JSON-Schema tools, runs the loop (execute calls, feed
    results back), and stops when a turn comes back without tool calls.
    """

    def __init__(
        self,
        client: "OpenAICompatibleClient",
        provider: ProviderProfile,
        *,
        prompt: str,
        system_prompt: str,
        tools: list[dict[str, Any]],
        enable_thinking: bool = False,
    ) -> None:
        self.client = client
        self.provider = provider
        self.style = normalize_style(provider.api_style)
        self.tools = tools
        self.enable_thinking = enable_thinking
        self.url, self.headers, self.payload = client._prepare(
            provider,
            prompt,
            system_prompt,
            stream=False,
            disable_thinking=not enable_thinking,
            enable_thinking=enable_thinking,
        )
        self._apply_tools()
        if self.style == STYLE_RESPONSES:
            self.input_items: list[dict[str, Any]] = list(self.payload["input"])
        else:
            self.messages: list[dict[str, Any]] = list(self.payload["messages"])

    def _apply_tools(self) -> None:
        if self.style == STYLE_ANTHROPIC:
            self.payload["tools"] = [
                {
                    "name": tool["name"],
                    "description": tool.get("description", ""),
                    "input_schema": tool.get("parameters") or {"type": "object", "properties": {}},
                }
                for tool in self.tools
            ]
        elif self.style == STYLE_RESPONSES:
            self.payload["tools"] = [
                {
                    "type": "function",
                    "name": tool["name"],
                    "description": tool.get("description", ""),
                    "parameters": tool.get("parameters") or {"type": "object", "properties": {}},
                }
                for tool in self.tools
            ]
        else:
            self.payload["tools"] = [
                {
                    "type": "function",
                    "function": {
                        "name": tool["name"],
                        "description": tool.get("description", ""),
                        "parameters": tool.get("parameters") or {"type": "object", "properties": {}},
                    },
                }
                for tool in self.tools
            ]
        self.payload["tool_choice"] = "auto"

    def _sync_transport(self) -> None:
        if self.style == STYLE_RESPONSES:
            self.payload["input"] = self.input_items
        else:
            self.payload["messages"] = self.messages

    def run(self) -> ToolTurn:
        self._sync_transport()
        try:
            response = httpx.post(self.url, headers=self.headers, json=self.payload, timeout=120)
            response.raise_for_status()
            data = response.json()
        except httpx.HTTPStatusError as exc:
            detail = sanitize_error_text(exc.response.text)
            raise ModelCallError(
                f"Model tool call failed with HTTP {exc.response.status_code}: {detail}"
            ) from exc
        except httpx.HTTPError as exc:
            raise ModelCallError(f"Model tool call failed: {exc}") from exc
        if self.style == STYLE_ANTHROPIC:
            return self._read_anthropic(data)
        if self.style == STYLE_RESPONSES:
            return self._read_responses(data)
        return self._read_chat(data)

    async def stream_turn(self, *, final: bool = False) -> AsyncIterator[StreamUpdate]:
        """Stream one tool-capable turn: reasoning and answer deltas as they arrive.

        The assistant message is committed to session history the moment the stream
        closes, so the caller can execute tools and ask again with the real ids.
        ``final`` drops the tool registration entirely: the budget is gone and the model
        has to answer from the tool results already in the history.
        """
        self._sync_transport()
        payload = {**self.payload, "stream": True}
        if final:
            payload.pop("tools", None)
            payload.pop("tool_choice", None)
        acc = _stream_accumulator(self.style)
        async with httpx.AsyncClient(timeout=httpx.Timeout(120.0)) as client:
            try:
                async with client.stream("POST", self.url, headers=self.headers, json=payload) as response:
                    if response.status_code >= 400:
                        await response.aread()
                        raise ModelCallError(
                            f"Model tool stream failed with HTTP {response.status_code}: "
                            f"{sanitize_error_text(response.text)}"
                        )
                    async for line in response.aiter_lines():
                        data = _sse_json(line)
                        if data is None:
                            continue
                        reasoning, answer = acc.feed(data)
                        if reasoning:
                            yield StreamReasoning(reasoning)
                        if answer:
                            yield StreamAnswer(answer)
            except httpx.HTTPError as exc:
                raise ModelCallError(f"Model tool stream failed: {exc}") from exc
        failure = getattr(acc, "error", None)
        if failure:
            raise ModelCallError(f"Model tool stream {failure}")
        turn = acc.turn()
        self._commit(acc)
        yield TurnDone(turn)

    def _commit(self, acc: Any) -> None:
        if self.style == STYLE_RESPONSES:
            self.input_items.extend(acc.commit())
        elif self.style == STYLE_ANTHROPIC:
            self.messages.append({"role": "assistant", "content": acc.commit()})
        else:
            self.messages.append(acc.commit(include_reasoning=self.enable_thinking))
        self._sync_transport()

    def submit_tool_results(self, results: list[ToolResult]) -> None:
        if self.style == STYLE_ANTHROPIC:
            self.messages.append(
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "tool_result",
                            "tool_use_id": result.call_id,
                            "content": result.content,
                            **({"is_error": True} if result.is_error else {}),
                        }
                        for result in results
                    ],
                }
            )
            self.payload["messages"] = self.messages
        elif self.style == STYLE_RESPONSES:
            self.input_items.extend(
                {
                    "type": "function_call_output",
                    "call_id": result.call_id,
                    "output": result.content,
                }
                for result in results
            )
        else:
            self.messages.extend(
                {
                    "role": "tool",
                    "tool_call_id": result.call_id,
                    "content": result.content,
                }
                for result in results
            )

    def _read_chat(self, data: dict) -> ToolTurn:
        try:
            message = data["choices"][0]["message"]
        except (KeyError, IndexError, TypeError):
            raise ModelCallError("Model tool response did not contain a message.") from None
        text = message.get("content") if isinstance(message.get("content"), str) else ""
        reasoning = _first_text(message, "reasoning_content", "reasoning", "thinking")
        raw_calls = message.get("tool_calls") or []
        calls = [
            ToolCall(
                id=str(item.get("id") or f"call-{index}"),
                name=str((item.get("function") or {}).get("name") or ""),
                arguments=_parse_arguments((item.get("function") or {}).get("arguments")),
            )
            for index, item in enumerate(raw_calls)
            if isinstance(item, dict)
        ]
        self.messages.append(
            {
                "role": "assistant",
                "content": text or None,
                **({"reasoning_content": reasoning} if reasoning and self.enable_thinking else {}),
                **({"tool_calls": raw_calls} if raw_calls else {}),
            }
        )
        return ToolTurn(text=text.strip(), tool_calls=[call for call in calls if call.name], reasoning=reasoning)

    def _read_responses(self, data: dict) -> ToolTurn:
        calls: list[ToolCall] = []
        texts: list[str] = []
        thinking: list[str] = []
        for item in data.get("output") or []:
            if not isinstance(item, dict):
                continue
            if item.get("type") == "function_call":
                calls.append(
                    ToolCall(
                        id=str(item.get("call_id") or item.get("id") or ""),
                        name=str(item.get("name") or ""),
                        arguments=_parse_arguments(item.get("arguments")),
                    )
                )
                self.input_items.append(item)
            elif item.get("type") == "message":
                for part in item.get("content") or []:
                    if isinstance(part, dict) and part.get("type") in {"output_text", "text"}:
                        texts.append(str(part.get("text") or ""))
                self.input_items.append(item)
            elif item.get("type") == "reasoning":
                for summary in item.get("summary") or []:
                    if isinstance(summary, dict):
                        thinking.append(str(summary.get("text") or ""))
        if isinstance(data.get("output_text"), str) and data["output_text"].strip():
            texts.append(data["output_text"])
        return ToolTurn(
            text="".join(texts).strip(),
            tool_calls=[call for call in calls if call.id and call.name],
            reasoning="".join(thinking).strip(),
        )

    def _read_anthropic(self, data: dict) -> ToolTurn:
        blocks = data.get("content") or []
        calls: list[ToolCall] = []
        texts: list[str] = []
        thinking: list[str] = []
        for block in blocks:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "tool_use":
                calls.append(
                    ToolCall(
                        id=str(block.get("id") or ""),
                        name=str(block.get("name") or ""),
                        arguments=_parse_arguments(block.get("input")),
                    )
                )
            elif block.get("type") == "text":
                texts.append(str(block.get("text") or ""))
            elif block.get("type") == "thinking":
                thinking.append(str(block.get("thinking") or ""))
        self.messages.append({"role": "assistant", "content": blocks})
        return ToolTurn(
            text="".join(texts).strip(),
            tool_calls=[call for call in calls if call.id and call.name],
            reasoning="".join(thinking).strip(),
        )


def _thinking_style(provider: ProviderProfile) -> str:
    provider_type = str(getattr(provider.provider_type, "value", provider.provider_type)).lower()
    known = _THINKING_STYLE.get(provider_type)
    if known:
        return known
    text = f"{provider.provider_id} {provider.base_url}".lower()
    for marker, style in (
        ("deepseek", "thinking_object"),
        ("bigmodel", "thinking_object"),
        ("zhipu", "thinking_object"),
        ("glm", "thinking_object"),
        ("moonshot", "thinking_object"),
        ("kimi", "thinking_object"),
        ("xiaomi", "thinking_object"),
        ("mimo", "thinking_object"),
        ("dashscope", "enable_thinking"),
        ("bailian", "enable_thinking"),
        ("qianwen", "enable_thinking"),
        ("qwen", "enable_thinking"),
    ):
        if marker in text:
            return style
    return "none"


def _sse_json(line: str) -> dict | None:
    """Decode one SSE ``data:`` line, or None for keep-alives, event names and [DONE]."""
    if not line.startswith("data:"):
        return None
    payload_text = line.removeprefix("data:").strip()
    if not payload_text or payload_text == "[DONE]":
        return None
    try:
        data = json.loads(payload_text)
    except ValueError:
        return None
    return data if isinstance(data, dict) else None


def _sse_parts(line: str, api_style: str) -> tuple[str, str]:
    """Reasoning and answer text carried by one SSE ``data:`` line."""
    data = _sse_json(line)
    if data is None:
        return "", ""
    return extract_stream_delta(api_style, data)
