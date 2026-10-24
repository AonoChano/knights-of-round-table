"""Conversation job queue and JSON-file conversation store."""

from __future__ import annotations

import json
import logging
import threading
import time
from pathlib import Path

from .search_index import ConversationSearchIndex, SearchPage
from .schemas import (
    ConversationRecord,
    DelegationMetadata,
    DiscussionMessage,
    StageSummary,
    ToolTrace,
    utc_now,
)

logger = logging.getLogger(__name__)


class ConversationJob:
    def __init__(
        self,
        conversation_id: str,
        *,
        user_node_id: str = "",
        assistant_node_id: str = "",
        question: str = "",
        expert_count: int = 0,
    ) -> None:
        self.conversation_id = conversation_id
        self.user_node_id = user_node_id
        self.assistant_node_id = assistant_node_id
        self.question = question
        self.expert_count = expert_count
        self.events: list[str] = []
        self.done = False
        self.cancel_requested = False
        self.finalized = False
        self.error: Exception | None = None
        self.partial_body = ""
        self.partial_summaries: list[StageSummary] = []
        self.partial_messages: list[DiscussionMessage] = []
        self.partial_traces: dict[str, ToolTrace] = {}
        self.rail_order = 0
        self.delegation: DelegationMetadata | None = None
        self.started_at = time.monotonic()
        self.thinking_elapsed_ms = 0
        self.condition = threading.Condition()

    def append(self, event: str) -> None:
        with self.condition:
            self.events.append(event)
            self.condition.notify_all()

    def finish(self, error: Exception | None = None) -> None:
        with self.condition:
            self.error = error
            self.done = True
            self.condition.notify_all()

    def cancel(self) -> None:
        with self.condition:
            self.cancel_requested = True
            self.condition.notify_all()

    def claim_finalization(self) -> bool:
        with self.condition:
            if self.finalized:
                return False
            self.finalized = True
            return True

    def next_order(self) -> int:
        """Arrival rank for the thinking rail, so a reloaded node replays in real order."""
        with self.condition:
            self.rail_order += 1
            return self.rail_order

    def stream(self, start_index: int = 0) -> Iterator[str]:
        index = start_index
        while True:
            with self.condition:
                while index >= len(self.events) and not self.done:
                    self.condition.wait(timeout=15)
                if index < len(self.events):
                    event = self.events[index]
                    index += 1
                elif self.done:
                    if self.error is not None:
                        raise self.error
                    break
                else:
                    continue
            yield event

class ConversationStore:
    def __init__(self, path: Path) -> None:
        original_path = path
        self.path = path
        if self.path.is_file():
            old_file = self.path
            self.path = self.path.with_name(self.path.stem)
            self.path.mkdir(parents=True, exist_ok=True)
            self._migrate_from_file(old_file)
        elif self.path.is_dir():
            self.path.mkdir(parents=True, exist_ok=True)
        elif self.path.suffix == ".json":
            self.path = self.path.with_name(self.path.stem)
            self.path.mkdir(parents=True, exist_ok=True)
        else:
            self.path.mkdir(parents=True, exist_ok=True)
        self.search_index = ConversationSearchIndex(self.path.parent / "search.db")
        logger.info("conversation_store.ready configured_path=%s resolved_path=%s", original_path, self.path)

    def _migrate_from_file(self, file_path: Path) -> None:
        migrated = 0
        try:
            data = json.loads(file_path.read_text(encoding="utf-8"))
            records = data if isinstance(data, list) else []
            for entry in records:
                try:
                    record = ConversationRecord.model_validate(entry)
                    fpath = self.path / f"{record.conversation_id}.json"
                    fpath.write_text(json.dumps(record.model_dump(mode="json"), ensure_ascii=False, indent=2), encoding="utf-8")
                    migrated += 1
                except Exception:
                    logger.warning("conversation_store.migrate_skip_invalid source=%s", file_path)
            file_path.unlink()
            logger.info("conversation_store.migrated source=%s count=%s", file_path, migrated)
        except Exception as exc:
            logger.warning("conversation_store.migrate_failed source=%s error=%s", file_path, exc)

    def list_records(self) -> list[ConversationRecord]:
        started = time.perf_counter()
        records: list[ConversationRecord] = []
        if not self.path.exists():
            logger.debug("conversation_store.list_records_missing path=%s", self.path)
            return records
        for file_path in sorted(self.path.glob("*.json")):
            try:
                data = json.loads(file_path.read_text(encoding="utf-8"))
                record = ConversationRecord.model_validate(data)
                records.append(record)
            except Exception as exc:
                logger.warning("conversation_store.skip_invalid file=%s error=%s", file_path.name, exc)
        logger.debug(
            "conversation_store.list_records count=%s duration_ms=%.1f path=%s",
            len(records),
            (time.perf_counter() - started) * 1000,
            self.path,
        )
        return records

    def get_record(self, conversation_id: str) -> ConversationRecord | None:
        file_path = self.path / f"{conversation_id}.json"
        if not file_path.exists():
            return None
        try:
            data = json.loads(file_path.read_text(encoding="utf-8"))
            return ConversationRecord.model_validate(data)
        except Exception as exc:
            logger.warning("conversation_store.get_failed conversation_id=%s error=%s", conversation_id, exc)
            return None

    def save_records(self, records: list[ConversationRecord]) -> None:
        for record in records:
            self.append(record)

    def append(self, record: ConversationRecord) -> None:
        file_path = self.path / f"{record.conversation_id}.json"
        file_path.write_text(
            json.dumps(record.model_dump(mode="json"), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        self.search_index.sync(record)
        logger.debug(
            "conversation_store.saved conversation_id=%s nodes=%s",
            record.conversation_id,
            len(record.nodes),
        )

    def _update_record(self, conversation_id: str, updater) -> ConversationRecord | None:
        record = self.get_record(conversation_id)
        if record is None:
            return None
        updater(record)
        self.append(record)
        return record

    def rename(self, conversation_id: str, new_title: str) -> ConversationRecord | None:
        def _apply(record: ConversationRecord) -> None:
            record.title = new_title
            record.updated_at = utc_now()

        return self._update_record(conversation_id, _apply)

    def delete(self, conversation_id: str) -> bool:
        file_path = self.path / f"{conversation_id}.json"
        if not file_path.exists():
            return False
        file_path.unlink()
        self.search_index.remove(conversation_id)
        return True

    def search(self, query: str, *, scope: str, limit: int, cursor: str | None) -> SearchPage:
        if not self.search_index.ready():
            self.search_index.build(self.list_records())
        return self.search_index.search(query, scope=scope, limit=limit, cursor=cursor)
