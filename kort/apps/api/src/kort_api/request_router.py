from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

from .schemas import ConversationRequest

RouteKind = Literal["direct", "solo_thinking", "panel"]

LEVEL_MAX_ROUNDS: dict[str, int] = {
    "low": 2,
    "auto": 4,
    "medium": 5,
    "high": 8,
}

_TRIM_CHARS = " \t\r\n.,!?;:'\"`~，。！？；：、（）()[]【】{}<>《》“”‘’…"
_AUTO_DIRECT_PATTERNS = (
    re.compile(r"^(hi|hello|hey|yo|thanks|thankyou|thx|ok|okay|goodmorning|goodafternoon|goodevening)$"),
    re.compile(r"^(你好|您好|嗨|哈喽|在吗|你在吗|谢谢|感谢|多谢|好的|好|嗯|嗯嗯|早上好|下午好|晚上好|测试)$"),
    re.compile(r"^(你好|您好|嗨|哈喽)[呀啊哈]*$"),
)


@dataclass(frozen=True)
class RouteDecision:
    kind: RouteKind
    reason_code: str
    max_rounds: int = 0


def _normalize_question(question: str) -> str:
    compact = "".join(question.strip().lower().split())
    return compact.strip(_TRIM_CHARS)


def is_auto_direct_prompt(question: str) -> bool:
    normalized = _normalize_question(question)
    if not normalized:
        return False
    return any(pattern.fullmatch(normalized) for pattern in _AUTO_DIRECT_PATTERNS)


def route_request(request: ConversationRequest) -> RouteDecision:
    if request.deep_think and request.level == "off":
        return RouteDecision(kind="solo_thinking", reason_code="explicit_deep_think")

    if request.level == "off":
        return RouteDecision(kind="direct", reason_code="explicit_discussion_off")

    if request.level in {"low", "medium", "high"}:
        # Use custom_max_rounds if provided, otherwise use default for level
        max_rounds = request.custom_max_rounds if request.custom_max_rounds is not None else LEVEL_MAX_ROUNDS[request.level]
        return RouteDecision(
            kind="panel",
            reason_code=f"explicit_{request.level}",
            max_rounds=max_rounds,
        )

    if is_auto_direct_prompt(request.question):
        return RouteDecision(kind="direct", reason_code="auto_trivial")

    # Auto mode: use custom_max_rounds if provided, otherwise use auto default
    max_rounds = request.custom_max_rounds if request.custom_max_rounds is not None else LEVEL_MAX_ROUNDS["auto"]
    return RouteDecision(kind="panel", reason_code="auto_panel", max_rounds=max_rounds)
