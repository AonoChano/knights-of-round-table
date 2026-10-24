"""Shared constants and JSONL helpers for file-backed agent memory."""

from __future__ import annotations

import json
import logging
import re
from collections.abc import Iterable
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

logger = logging.getLogger("kort_api.memory")

logger = logging.getLogger(__name__)

AGENT_NAME_RE = re.compile(r"^[a-z][a-z0-9-]*$")

CONTROL_RE = re.compile(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]")

WORD_RE = re.compile(r"[a-z0-9]{2,}")

CJK_CHAR_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff]")

JSON_BLOCK_RE = re.compile(r"\{.*\}", re.DOTALL)

INJECTION_MARKERS = (
    "ignore previous",
    "ignore all previous",
    "disregard the above",
    "system prompt",
    "developer message",
    "you must now",
    "忽略之前",
    "忽略以上",
    "无视以上",
    "系统提示词",
    "你现在必须",
)

SECRET_PATTERNS = (
    re.compile(r"sk-[A-Za-z0-9_\-]{8,}"),
    re.compile(r"tp-[A-Za-z0-9_\-]{8,}"),
    re.compile(r"Bearer\s+[A-Za-z0-9._\-]{12,}", re.IGNORECASE),
)

FACT_PREFIX = "F"

EPISODE_PREFIX = "E"

HUNCH_PREFIX = "H"

DREAM_PREFIX = "D"

MAX_FACT_CHARS = 400

MAX_EPISODE_QUESTION_CHARS = 600

MAX_EPISODE_GIST_CHARS = 700

MAX_HUNCH_CHARS = 300

MAX_PRIVATE_FACTS = 400

MAX_HUNCHES = 120

MAX_SHARED_FACTS = 800

MAX_DREAM_EPISODES = 24

MAX_SNAPSHOTS = 10


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)

def _iso_now() -> str:
    return _utc_now().isoformat()

def _parse_ts(value: object) -> datetime | None:
    if not isinstance(value, str) or not value.strip():
        return None
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)

def _new_id(prefix: str) -> str:
    return f"{prefix}-{uuid4().hex[:8]}"

def _read_jsonl(path: Path) -> list[dict]:
    if not path.is_file():
        return []
    records: list[dict] = []
    try:
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if not line:
                continue
            try:
                item = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(item, dict):
                records.append(item)
    except OSError as exc:
        logger.warning("memory.read_failed path=%s error=%s", path, exc)
    return records

def _append_jsonl(path: Path, record: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, ensure_ascii=False) + "\n")

def _rewrite_jsonl(path: Path, records: Iterable[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_suffix(path.suffix + ".tmp")
    with temp.open("w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False) + "\n")
    temp.replace(path)

def _clean_text(text: object, limit: int) -> str:
    if not isinstance(text, str):
        return ""
    cleaned = CONTROL_RE.sub(" ", text)
    for pattern in SECRET_PATTERNS:
        cleaned = pattern.sub("[redacted]", cleaned)
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned[:limit]

def _looks_like_instruction(text: str) -> bool:
    lowered = text.lower()
    return any(marker in lowered for marker in INJECTION_MARKERS)

def _terms(text: str) -> set[str]:
    lowered = text.lower()
    terms = set(WORD_RE.findall(lowered))
    cjk = CJK_CHAR_RE.findall(lowered)
    terms.update(a + b for a, b in zip(cjk, cjk[1:]))
    return terms

def _relevance(query_terms: set[str], text: str) -> float:
    if not query_terms:
        return 0.0
    terms = _terms(text)
    if not terms:
        return 0.0
    return len(query_terms & terms) / len(query_terms)

def _jaccard(left: str, right: str) -> float:
    a, b = _terms(left), _terms(right)
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)

def _recency(value: object, half_life_days: float) -> float:
    parsed = _parse_ts(value)
    if parsed is None:
        return 0.0
    days = max(0.0, (_utc_now() - parsed).total_seconds() / 86400)
    return 0.5 ** (days / half_life_days)

def _clamp(value: object, low: float, high: float, default: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    return max(low, min(high, number))

def _tags(value: object, limit: int = 8) -> list[str]:
    if isinstance(value, str):
        raw = re.split(r"[,，、\s]+", value)
    elif isinstance(value, list):
        raw = [str(item) for item in value]
    else:
        raw = []
    seen: list[str] = []
    for item in raw:
        tag = _clean_text(item, 24)
        if tag and tag not in seen:
            seen.append(tag)
        if len(seen) >= limit:
            break
    return seen

def _evidence_ids(value: object, known: set[str]) -> list[str]:
    if not isinstance(value, list):
        return []
    result: list[str] = []
    for item in value:
        text = str(item).strip()
        if text in known and text not in result:
            result.append(text)
    return result

def _fact_record(text: str, *, scope: str, tags: list[str], confidence: float, importance: float,
                 pinned: bool, source: str, evidence: list[str] | None = None) -> dict:
    now = _iso_now()
    return {
        "id": _new_id(FACT_PREFIX),
        "kind": "fact",
        "scope": scope,
        "text": text,
        "tags": tags,
        "confidence": confidence,
        "importance": importance,
        "salience": 0.0,
        "pinned": pinned,
        "source": source,
        "evidence": evidence or [],
        "created_at": now,
        "updated_at": now,
        "status": "active",
    }
