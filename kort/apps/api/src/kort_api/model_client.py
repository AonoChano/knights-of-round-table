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


@dataclass
class ToolResult:
    call_id: str
    content: str
    is_error: bool = False


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
    ) -> None:
        self.client = client
        self.provider = provider
        self.style = normalize_style(provider.api_style)
        self.tools = tools
        self.url, self.headers, self.payload = client._prepare(
            provider, prompt, system_prompt, stream=False, disable_thinking=False
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

    def run(self) -> ToolTurn:
        if self.style == STYLE_CHAT:
            self.payload["messages"] = self.messages
        elif self.style == STYLE_RESPONSES:
            self.payload["input"] = self.input_items
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
                **({"tool_calls": raw_calls} if raw_calls else {}),
            }
        )
        return ToolTurn(text=text.strip(), tool_calls=[call for call in calls if call.name])

    def _read_responses(self, data: dict) -> ToolTurn:
        calls: list[ToolCall] = []
        texts: list[str] = []
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
        if isinstance(data.get("output_text"), str) and data["output_text"].strip():
            texts.append(data["output_text"])
        return ToolTurn(text="".join(texts).strip(), tool_calls=[call for call in calls if call.id and call.name])

    def _read_anthropic(self, data: dict) -> ToolTurn:
        blocks = data.get("content") or []
        calls: list[ToolCall] = []
        texts: list[str] = []
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
        self.messages.append({"role": "assistant", "content": blocks})
        return ToolTurn(text="".join(texts).strip(), tool_calls=[call for call in calls if call.id and call.name])


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


def _sse_parts(line: str, api_style: str) -> tuple[str, str]:
    """Reasoning and answer text carried by one SSE ``data:`` line."""
    if not line.startswith("data:"):
        return "", ""
    payload_text = line.removeprefix("data:").strip()
    if payload_text == "[DONE]":
        return "", ""
    try:
        data = json.loads(payload_text)
    except ValueError:
        return "", ""
    if not isinstance(data, dict):
        return "", ""
    return extract_stream_delta(api_style, data)
