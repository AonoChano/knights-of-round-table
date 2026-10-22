from __future__ import annotations

import os
import time
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx

from .model_client import (
    ANTHROPIC_VERSION,
    ModelCallError,
    STYLE_ANTHROPIC,
    STYLE_RESPONSES,
    chat_endpoint,
    models_endpoint,
    normalize_style,
    sanitize_error_text,
)
from .schemas import ProviderValidateRequest, ProviderValidateResponse, ValidateStatus

PROBE_TIMEOUT_SECONDS = 12.0


@dataclass
class _HttpResult:
    outcome: str  # ok | unauthorized | not_found | unreachable | rejected
    message: str = ""
    payload: object = None


def probe_upstream(request: ProviderValidateRequest, saved_key: str = "") -> ProviderValidateResponse:
    """Check an endpoint before it is saved, preferring the free model-list call."""
    started = time.perf_counter()

    parsed = urlparse(request.base_url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        return _result(False, "invalid_base_url", "Base URL must be an absolute http(s) URL.")

    try:
        style = normalize_style(request.api_style)
    except ModelCallError as exc:
        return _result(False, "rejected", str(exc))

    api_key = (request.api_key or saved_key or os.getenv(request.env_key_name, "")).strip()
    if not api_key and request.provider_type != "ollama":
        return _result(False, "missing_key", "Enter an API key before validating this endpoint.")

    headers = _probe_headers(style, api_key)
    discovered, refused = _discover_models(request.base_url, style, headers)
    if refused is not None:
        return _result(False, refused.outcome, refused.message, latency_ms=_elapsed(started))

    if not discovered:
        if not request.models:
            return _result(
                False,
                "rejected",
                "This endpoint publishes no model list, so add at least one model ID to validate it.",
                latency_ms=_elapsed(started),
            )
        ping = _http_json(
            "POST",
            chat_endpoint(request.base_url, style),
            headers,
            _ping_payload(style, request.models[0]),
        )
        if ping.outcome != "ok":
            return _result(False, ping.outcome, ping.message, latency_ms=_elapsed(started))
        return _result(True, "valid", "Endpoint validated with a one-token test call.", latency_ms=_elapsed(started))

    missing = [item for item in request.models if not _is_listed(item, discovered)]
    if missing:
        return _result(
            False,
            "rejected",
            f"The endpoint is reachable but does not list: {', '.join(missing)}.",
            discovered,
            missing,
            latency_ms=_elapsed(started),
        )
    return _result(True, "valid", f"Endpoint lists {len(discovered)} models.", discovered, [], _elapsed(started))


def _probe_headers(style: str, api_key: str) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if not api_key:
        return headers
    if style == STYLE_ANTHROPIC:
        headers["x-api-key"] = api_key
        headers["anthropic-version"] = ANTHROPIC_VERSION
    else:
        headers["Authorization"] = f"Bearer {api_key}"
    return headers


def _discover_models(
    base_url: str, style: str, headers: dict[str, str]
) -> tuple[list[str], _HttpResult | None]:
    """Model IDs from the list endpoint plus a fatal result, if the host is down or refuses the key."""
    result = _http_json("GET", models_endpoint(base_url, style), headers)
    if result.outcome == "ok":
        return _model_ids(result.payload), None
    if result.outcome in {"unauthorized", "unreachable"}:
        return [], result
    return [], None


def _ping_payload(style: str, model: str) -> dict:
    if style == STYLE_ANTHROPIC:
        return {"model": model, "messages": [{"role": "user", "content": "ping"}], "max_tokens": 1}
    if style == STYLE_RESPONSES:
        return {"model": model, "input": [{"role": "user", "content": "ping"}], "max_output_tokens": 16}
    return {"model": model, "messages": [{"role": "user", "content": "ping"}], "max_tokens": 1, "temperature": 0}


def _http_json(method: str, url: str, headers: dict[str, str], payload: dict | None = None) -> _HttpResult:
    try:
        response = httpx.request(method, url, headers=headers, json=payload, timeout=PROBE_TIMEOUT_SECONDS)
    except httpx.HTTPError as exc:
        return _HttpResult("unreachable", f"Could not reach {url}: {sanitize_error_text(str(exc))}")

    if response.status_code in {401, 403}:
        return _HttpResult("unauthorized", f"The endpoint rejected this API key (HTTP {response.status_code}).")
    if response.status_code == 404:
        return _HttpResult("not_found", f"Nothing answers at {url}. Check the base URL path.")
    if response.status_code >= 400:
        return _HttpResult("rejected", f"HTTP {response.status_code}: {sanitize_error_text(response.text)}")
    try:
        return _HttpResult("ok", payload=response.json())
    except ValueError:
        return _HttpResult("rejected", "The endpoint returned a response that was not JSON.")


def _model_ids(payload: object) -> list[str]:
    if isinstance(payload, dict):
        items = payload.get("data") or payload.get("models") or []
    elif isinstance(payload, list):
        items = payload
    else:
        return []
    if not isinstance(items, list):
        return []

    ids: list[str] = []
    for item in items:
        candidate = (item.get("id") or item.get("name")) if isinstance(item, dict) else item
        if isinstance(candidate, str) and candidate:
            ids.append(candidate)
    return ids


def _is_listed(model: str, discovered: list[str]) -> bool:
    needle = model.strip().lower()
    return any(needle == item.lower() or needle in item.lower() for item in discovered)


def _elapsed(started: float) -> int:
    return int((time.perf_counter() - started) * 1000)


def _result(
    ok: bool,
    status: ValidateStatus,
    message: str,
    discovered: list[str] | None = None,
    missing: list[str] | None = None,
    latency_ms: int = 0,
) -> ProviderValidateResponse:
    return ProviderValidateResponse(
        ok=ok,
        status=status,
        message=message,
        discovered_models=discovered or [],
        missing_models=missing or [],
        latency_ms=latency_ms,
    )
