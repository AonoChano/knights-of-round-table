"""Persistent agent-memory store."""

from __future__ import annotations

import hashlib
import json
import logging
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path

from .memory_dream import MemoryDreamMixin
from .memory_retrieval import MemoryRetrievalMixin
from .memory_utils import (
    AGENT_NAME_RE,
    EPISODE_PREFIX,
    MAX_EPISODE_GIST_CHARS,
    MAX_EPISODE_QUESTION_CHARS,
    MAX_FACT_CHARS,
    MAX_SHARED_FACTS,
    _append_jsonl,
    _clamp,
    _clean_text,
    _fact_record,
    _iso_now,
    _jaccard,
    _looks_like_instruction,
    _new_id,
    _parse_ts,
    _read_jsonl,
    _recency,
    _rewrite_jsonl,
    _tags,
    _utc_now,
)

logger = logging.getLogger("kort_api.memory")


class MemoryStore(MemoryRetrievalMixin, MemoryDreamMixin):
    def __init__(
        self,
        runtime_root: Path,
        *,
        budget_tokens: int = 320,
        auto_dream: bool = True,
        dream_min_episodes: int = 6,
        dream_min_hours: int = 24,
    ) -> None:
        self.runtime_root = Path(runtime_root)
        self.agents_root = self.runtime_root / "agents"
        self.memory_root = self.runtime_root / "memory"
        self.seed_root = self.runtime_root / "memory_seed"
        self.shared_dir = self.memory_root / "_shared"
        self.snapshots_root = self.memory_root / "snapshots"
        self.budget_tokens = max(120, int(budget_tokens))
        self.auto_dream = bool(auto_dream)
        self.dream_min_episodes = max(1, int(dream_min_episodes))
        self.dream_min_hours = max(1, int(dream_min_hours))
        self._lock = threading.RLock()
        self._seed_shared()
        logger.info(
            "memory_store.ready root=%s budget_tokens=%s auto_dream=%s",
            self.memory_root,
            self.budget_tokens,
            self.auto_dream,
        )

    def _seed_shared(self) -> None:
        self.shared_dir.mkdir(parents=True, exist_ok=True)
        target = self.shared_dir / "facts.jsonl"
        seed = self.seed_root / "shared.jsonl"
        if target.exists() or not seed.is_file():
            return
        records = self._read_seed_facts(seed, scope="shared")
        if records:
            _rewrite_jsonl(target, records)
            logger.info("memory_store.seeded_shared count=%s", len(records))

    def _read_seed_facts(self, path: Path, *, scope: str) -> list[dict]:
        records: list[dict] = []
        for raw in _read_jsonl(path):
            text = _clean_text(raw.get("text"), MAX_FACT_CHARS)
            if not text or _looks_like_instruction(text):
                continue
            record = _fact_record(
                text,
                scope=scope,
                tags=_tags(raw.get("tags")),
                confidence=_clamp(raw.get("confidence"), 0.0, 1.0, 0.8),
                importance=_clamp(raw.get("importance"), 0.0, 1.0, 0.6),
                pinned=bool(raw.get("pinned")),
                source=str(raw.get("source") or "seed"),
            )
            records.append(record)
        return records

    def _agent_dir(self, agent_name: str, *, seed: bool = True) -> Path:
        if not AGENT_NAME_RE.fullmatch(agent_name):
            raise ValueError(f"Invalid agent name '{agent_name}'")
        agent_dir = self.memory_root / agent_name
        agent_dir.mkdir(parents=True, exist_ok=True)
        if seed:
            with self._lock:
                self._seed_agent(agent_name, agent_dir)
        return agent_dir

    def _seed_agent(self, agent_name: str, agent_dir: Path) -> None:
        facts_path = agent_dir / "facts.jsonl"
        seed_facts = self.agents_root / agent_name / "memory_seed.jsonl"
        if not facts_path.exists() and seed_facts.is_file():
            records = self._read_seed_facts(seed_facts, scope="private")
            if records:
                _rewrite_jsonl(facts_path, records)
                logger.info("memory_store.seeded_agent agent=%s count=%s", agent_name, len(records))

        self_path = agent_dir / "self.md"
        seed_self = self.agents_root / agent_name / "self_seed.md"
        if not self_path.exists() and seed_self.is_file():
            try:
                self_path.write_text(seed_self.read_text(encoding="utf-8"), encoding="utf-8")
            except OSError as exc:
                logger.warning("memory_store.self_seed_failed agent=%s error=%s", agent_name, exc)

    def _shared_facts(self) -> list[dict]:
        return _read_jsonl(self.shared_dir / "facts.jsonl")

    def _private_facts(self, agent_name: str) -> list[dict]:
        return _read_jsonl(self._agent_dir(agent_name) / "facts.jsonl")

    def _episodes(self) -> list[dict]:
        return _read_jsonl(self.shared_dir / "episodes.jsonl")

    def _hunches(self, agent_name: str) -> list[dict]:
        return _read_jsonl(self._agent_dir(agent_name) / "hunches.jsonl")

    def _dream_state(self, agent_name: str) -> dict:
        path = self._agent_dir(agent_name) / "dream_state.json"
        if not path.is_file():
            return {}
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
        except (OSError, json.JSONDecodeError):
            return {}

    def record_round(
        self,
        *,
        conversation_id: str,
        question: str,
        final_answer: str,
        summaries: list | None = None,
        agents: list[str] | None = None,
        importance: float = 0.5,
    ) -> str:
        """Store one completed round as an episode card built only from visible data."""
        clean_question = _clean_text(question, MAX_EPISODE_QUESTION_CHARS)
        clean_answer = _clean_text(final_answer, MAX_EPISODE_GIST_CHARS)
        participants = [
            name
            for name in dict.fromkeys(agents or [])
            if isinstance(name, str) and AGENT_NAME_RE.fullmatch(name) and name != "summarizer-main"
        ]
        if not clean_question or not participants:
            return ""
        if not clean_answer and not summaries:
            return ""

        summary_lines: list[str] = []
        for item in (summaries or [])[:4]:
            title = _clean_text(getattr(item, "title", None), 80)
            snippet = _clean_text(getattr(item, "snippet", None) or getattr(item, "details", None), 180)
            if title or snippet:
                summary_lines.append(f"{title}: {snippet}" if title else snippet)

        question_digest = hashlib.sha1(clean_question.encode("utf-8")).hexdigest()[:12]
        dedupe = f"{conversation_id}:{question_digest}"
        with self._lock:
            existing = self._episodes()
            if any(item.get("dedupe") == dedupe for item in existing[-500:]):
                return ""
            now = _iso_now()
            record = {
                "id": _new_id(EPISODE_PREFIX),
                "kind": "episode",
                "dedupe": dedupe,
                "conversation_id": conversation_id,
                "question": clean_question,
                "answer_gist": clean_answer,
                "summaries": summary_lines,
                "participants": participants,
                "tags": [],
                "importance": _clamp(importance, 0.0, 1.0, 0.5),
                "created_at": now,
                "status": "active",
            }
            _append_jsonl(self.shared_dir / "episodes.jsonl", record)
        logger.info(
            "memory_store.recorded_episode id=%s conversation_id=%s participants=%s",
            record["id"],
            conversation_id,
            participants,
        )
        return str(record["id"])

    def remember(
        self,
        agent_name: str,
        text: str,
        *,
        tags: list[str] | None = None,
        scope: str = "private",
        pinned: bool = False,
        confidence: float = 0.85,
        importance: float = 0.65,
    ) -> dict:
        cleaned = _clean_text(text, MAX_FACT_CHARS)
        if len(cleaned) < 2:
            raise ValueError("Memory text is too short")
        if _looks_like_instruction(cleaned):
            raise ValueError("Memory text looks like an instruction, not a fact")
        if scope not in {"private", "shared"}:
            raise ValueError("scope must be 'private' or 'shared'")

        with self._lock:
            if scope == "shared":
                path = self.shared_dir / "facts.jsonl"
                records = self._shared_facts()
            else:
                path = self._agent_dir(agent_name) / "facts.jsonl"
                records = self._private_facts(agent_name)

            for existing in records:
                if (
                    existing.get("status", "active") == "active"
                    and _jaccard(str(existing.get("text", "")), cleaned) >= 0.9
                ):
                    existing["updated_at"] = _iso_now()
                    existing["importance"] = max(
                        _clamp(existing.get("importance"), 0.0, 1.0, 0.5),
                        _clamp(importance, 0.0, 1.0, 0.6),
                    )
                    existing["pinned"] = bool(existing.get("pinned")) or bool(pinned)
                    _rewrite_jsonl(path, records)
                    return existing

            record = _fact_record(
                cleaned,
                scope=scope,
                tags=_tags(tags),
                confidence=_clamp(confidence, 0.0, 1.0, 0.85),
                importance=_clamp(importance, 0.0, 1.0, 0.65),
                pinned=bool(pinned),
                source="manual",
            )
            _append_jsonl(path, record)
            if scope == "shared" and len(records) + 1 > MAX_SHARED_FACTS:
                trimmed, archived = self._trim(records + [record], MAX_SHARED_FACTS)
                if archived:
                    _rewrite_jsonl(path, trimmed)
        logger.info("memory_store.remembered agent=%s scope=%s id=%s", agent_name, scope, record["id"])
        return record

    def detail(
        self,
        agent_name: str,
        *,
        episode_limit: int = 8,
        dream_limit: int = 5,
    ) -> dict:
        """Everything the settings panel needs to inspect one agent's memory."""
        with self._lock:
            private = [
                item
                for item in self._private_facts(agent_name)
                if item.get("status", "active") == "active"
            ]
            shared = [
                item for item in self._shared_facts() if item.get("status", "active") == "active"
            ]
            hunches = [
                item
                for item in self._hunches(agent_name)
                if item.get("status", "active") == "active"
            ]
            episodes = [
                item
                for item in self._episodes()
                if agent_name in (item.get("participants") or [])
                and item.get("status", "active") == "active"
            ]
            dreams = _read_jsonl(self._agent_dir(agent_name) / "dreams.jsonl")
            narrative = self.self_narrative(agent_name)

        def _fact_order(item: dict) -> tuple[bool, str]:
            return (
                bool(item.get("pinned")),
                str(item.get("updated_at") or item.get("created_at") or ""),
            )

        private.sort(key=_fact_order, reverse=True)
        shared.sort(key=_fact_order, reverse=True)
        hunches.sort(key=lambda item: str(item.get("updated_at") or ""), reverse=True)
        episodes.sort(key=lambda item: str(item.get("created_at") or ""), reverse=True)
        return {
            "agent": agent_name,
            "self_narrative": narrative,
            "private_facts": private,
            "shared_facts": shared,
            "hunches": hunches,
            "episodes": episodes[:episode_limit],
            "dreams": list(reversed(dreams[-dream_limit:])),
            "status": self.status(agent_name),
        }

    def update_fact(
        self,
        agent_name: str,
        fact_id: str,
        *,
        text: str | None = None,
        pinned: bool | None = None,
        importance: float | None = None,
        confidence: float | None = None,
        status: str | None = None,
    ) -> dict | None:
        """Edit a private or shared fact. Archiving is the delete path."""
        cleaned: str | None = None
        if text is not None:
            cleaned = _clean_text(text, MAX_FACT_CHARS)
            if len(cleaned) < 2:
                raise ValueError("Memory text is too short")
            if _looks_like_instruction(cleaned):
                raise ValueError("Memory text looks like an instruction, not a fact")
        if status is not None and status not in {"active", "archived"}:
            raise ValueError("status must be 'active' or 'archived'")

        with self._lock:
            for path, records in (
                (self.shared_dir / "facts.jsonl", self._shared_facts()),
                (self._agent_dir(agent_name) / "facts.jsonl", self._private_facts(agent_name)),
            ):
                target = next((item for item in records if item.get("id") == fact_id), None)
                if target is None:
                    continue
                if cleaned is not None:
                    target["text"] = cleaned
                if pinned is not None:
                    target["pinned"] = bool(pinned)
                if importance is not None:
                    target["importance"] = _clamp(importance, 0.0, 1.0, 0.5)
                if confidence is not None:
                    target["confidence"] = _clamp(confidence, 0.0, 1.0, 0.5)
                if status is not None:
                    target["status"] = status
                    if status == "archived":
                        target["archived_at"] = _iso_now()
                        target["archive_reason"] = "manual"
                    else:
                        target.pop("archived_at", None)
                        target.pop("archive_reason", None)
                target["updated_at"] = _iso_now()
                _rewrite_jsonl(path, records)
                logger.info("memory_store.fact_updated agent=%s id=%s", agent_name, fact_id)
                return target
        return None

    def promote_fact(self, agent_name: str, fact_id: str) -> dict | None:
        with self._lock:
            private_path = self._agent_dir(agent_name) / "facts.jsonl"
            private = self._private_facts(agent_name)
            target = next((item for item in private if item.get("id") == fact_id), None)
            if target is None:
                return None
            shared = self._shared_facts()
            for existing in shared:
                if existing.get("status", "active") == "active" and _jaccard(
                    str(existing.get("text", "")), str(target.get("text", ""))
                ) >= 0.9:
                    return existing
            promoted = _fact_record(
                str(target.get("text", ""))[:MAX_FACT_CHARS],
                scope="shared",
                tags=_tags(target.get("tags")),
                confidence=_clamp(target.get("confidence"), 0.0, 1.0, 0.7),
                importance=_clamp(target.get("importance"), 0.0, 1.0, 0.6),
                pinned=bool(target.get("pinned")),
                source=f"promoted:{agent_name}",
                evidence=list(target.get("evidence") or []),
            )
            _append_jsonl(self.shared_dir / "facts.jsonl", promoted)
            target["promoted_to"] = promoted["id"]
            target["updated_at"] = _iso_now()
            _rewrite_jsonl(private_path, private)
        return promoted

    def status(self, agent_name: str, query: str = "") -> dict:
        state = self._dream_state(agent_name)
        last_dream = _parse_ts(state.get("last_dream_at"))
        episodes = [
            item for item in self._episodes() if agent_name in (item.get("participants") or [])
        ]
        pending = 0
        if last_dream is not None:
            pending = sum(
                1
                for item in episodes
                if (_parse_ts(item.get("created_at")) or datetime.min.replace(tzinfo=timezone.utc)) > last_dream
            )
        else:
            pending = sum(1 for item in episodes if item.get("status", "active") == "active")
        private = self._private_facts(agent_name)
        shared = self._shared_facts()
        return {
            "agent": agent_name,
            "fact_count": sum(1 for item in private if item.get("status", "active") == "active"),
            "shared_fact_count": sum(1 for item in shared if item.get("status", "active") == "active"),
            "episode_count": sum(1 for item in episodes if item.get("status", "active") == "active"),
            "hunch_count": sum(
                1 for item in self._hunches(agent_name) if item.get("status", "active") == "active"
            ),
            "pending_episodes": pending,
            "last_dream_at": last_dream.isoformat() if last_dream else None,
            "self_narrative": self.self_narrative(agent_name),
            "preview": self.compose_memory(agent_name, query, role="expert"),
            "budget_tokens": self.budget_tokens,
            "auto_dream": self.auto_dream,
            "dream_min_episodes": self.dream_min_episodes,
            "dream_min_hours": self.dream_min_hours,
        }

    @staticmethod
    def _trim(records: list[dict], limit: int) -> tuple[list[dict], int]:
        active = [item for item in records if item.get("status", "active") == "active"]
        if len(active) <= limit:
            return records, 0
        pinned = [item for item in active if item.get("pinned")]
        movable = [item for item in active if not item.get("pinned")]
        movable.sort(
            key=lambda item: (
                _clamp(item.get("importance"), 0.0, 1.0, 0.5)
                + 0.1 * _clamp(item.get("confidence"), 0.0, 1.0, 0.5)
                + 0.2 * _recency(item.get("updated_at") or item.get("created_at"), 60)
            ),
            reverse=True,
        )
        keep_ids = {id(item) for item in pinned + movable[: max(0, limit - len(pinned))]}
        archived = 0
        for item in active:
            if id(item) not in keep_ids:
                item["status"] = "archived"
                item["archived_at"] = _iso_now()
                item["archive_reason"] = "capacity"
                archived += 1
        return records, archived
