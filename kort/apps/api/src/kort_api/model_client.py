from __future__ import annotations

import os
import re

import httpx

from .schemas import ProviderProfile


class ModelCallError(RuntimeError):
    pass


def sanitize_error_text(text: str) -> str:
    redacted = re.sub(r"sk-[A-Za-z0-9_\-*]{8,}", "sk-***", text)
    redacted = re.sub(r"(api[_ -]?key[^:：]*[:：]\s*)[A-Za-z0-9_\-*]{8,}", r"\1***", redacted, flags=re.IGNORECASE)
    return redacted[:500]


class OpenAICompatibleClient:
    def __init__(self, secrets: dict[str, str]) -> None:
        self.secrets = secrets

    def chat(self, provider: ProviderProfile, prompt: str, system_prompt: str) -> str:
        if provider.api_style != "openai":
            raise ModelCallError(f"Provider {provider.provider_id} is not OpenAI-compatible yet.")

        api_key = self.secrets.get(provider.provider_id) or os.getenv(provider.env_key_name, "")
        if not api_key.strip() and provider.provider_type != "ollama":
            raise ModelCallError(f"Provider {provider.provider_id} has no saved API key.")

        headers = {"Content-Type": "application/json"}
        if api_key.strip():
            headers["Authorization"] = f"Bearer {api_key.strip()}"

        base_url = provider.base_url.rstrip("/")
        url = f"{base_url}/chat/completions"
        payload = {
            "model": provider.default_model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
            "temperature": 0.4,
        }

        try:
            response = httpx.post(url, headers=headers, json=payload, timeout=60)
            response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            detail = sanitize_error_text(exc.response.text)
            raise ModelCallError(f"Model call failed with HTTP {exc.response.status_code}: {detail}") from exc
        except httpx.HTTPError as exc:
            raise ModelCallError(f"Model call failed: {exc}") from exc

        data = response.json()
        try:
            content = data["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as exc:
            raise ModelCallError("Model response did not contain choices[0].message.content.") from exc

        if not isinstance(content, str) or not content.strip():
            raise ModelCallError("Model response content was empty.")
        return content.strip()
