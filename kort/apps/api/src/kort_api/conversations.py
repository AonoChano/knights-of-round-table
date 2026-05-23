from __future__ import annotations

import json
from collections.abc import Iterator
from pathlib import Path
from uuid import uuid4

from .orchestration import run_discussion_stream
from .schemas import (
    AgentDefinition,
    ConversationListItem,
    ConversationRecord,
    ConversationRequest,
    ConversationResponse,
    ConversationRound,
    FinalAnswer,
    ProviderProfile,
    StageSummary,
    utc_now,
)
from .storage import read_json, write_json


def _merge_streamed_summaries(events: list[StageSummary]) -> list[StageSummary]:
    seen: dict[str, StageSummary] = {}
    for item in events:
        seen[item.id] = item
    return list(seen.values())


class ConversationStore:
    def __init__(self, path: Path) -> None:
        self.path = path

    def list_records(self) -> list[ConversationRecord]:
        raw = read_json(self.path, default=[])
        seen_ids: set[str] = set()
        unique: list[ConversationRecord] = []
        for item in raw:
            try:
                r = ConversationRecord.model_validate(item)
                if r.conversation_id not in seen_ids:
                    seen_ids.add(r.conversation_id)
                    unique.append(r)
            except Exception:
                pass
        if len(unique) != len(raw):
            self.save_records(unique)
        return unique

    def get_record(self, conversation_id: str) -> ConversationRecord | None:
        for record in self.list_records():
            if record.conversation_id == conversation_id:
                return record
        return None

    def save_records(self, records: list[ConversationRecord]) -> None:
        write_json(self.path, [record.model_dump(mode="json") for record in records])

    def append(self, record: ConversationRecord) -> None:
        records = self.list_records()
        records.insert(0, record)
        self.save_records(records)

    def _update_record(self, conversation_id: str, updater) -> ConversationRecord | None:
        records = self.list_records()
        for i, record in enumerate(records):
            if record.conversation_id == conversation_id:
                updater(record)
                self.save_records(records)
                return record
        return None

    def rename(self, conversation_id: str, new_title: str) -> ConversationRecord | None:
        def _apply(record: ConversationRecord) -> None:
            record.title = new_title
            record.updated_at = utc_now()
        return self._update_record(conversation_id, _apply)

    def delete(self, conversation_id: str) -> bool:
        records = self.list_records()
        new_records = [r for r in records if r.conversation_id != conversation_id]
        if len(new_records) == len(records):
            return False
        self.save_records(new_records)
        return True


class VisibleConversationService:
    def __init__(self, store: ConversationStore) -> None:
        self.store = store

    def list_conversations(self) -> list[ConversationListItem]:
        records = self.store.list_records()
        return [
            ConversationListItem(
                conversation_id=item.conversation_id,
                title=item.title,
                created_at=item.created_at,
                updated_at=item.updated_at,
                expert_count=item.expert_count,
            )
            for item in records
        ]

    def get_conversation(self, conversation_id: str) -> ConversationResponse | None:
        record = self.store.get_record(conversation_id)
        if record is None:
            return None
        return ConversationResponse(
            conversation_id=record.conversation_id,
            created_at=record.created_at,
            updated_at=record.updated_at,
            title=record.title,
            expert_count=record.expert_count,
            rounds=record.rounds,
        )

    def rename_conversation(self, conversation_id: str, new_title: str) -> ConversationListItem | None:
        record = self.store.rename(conversation_id, new_title)
        if record is None:
            return None
        return ConversationListItem(
            conversation_id=record.conversation_id,
            title=record.title,
            created_at=record.created_at,
            updated_at=record.updated_at,
            expert_count=record.expert_count,
        )

    def delete_conversation(self, conversation_id: str) -> bool:
        return self.store.delete(conversation_id)

    def stream_conversation(
        self,
        request: ConversationRequest,
        expert_count: int,
        agents: list[AgentDefinition],
        providers: list[ProviderProfile],
        secrets: dict[str, str],
    ) -> Iterator[str]:
        # Reuse existing conversation_id or generate a new one
        if request.conversation_id:
            conversation_id = request.conversation_id
            existing = self.store.get_record(conversation_id)
        else:
            conversation_id = str(uuid4())
            existing = None

        # Build history context prefix from previous conversation rounds
        context_prefix = ""
        if existing and existing.rounds:
            history_parts: list[str] = []
            for r in existing.rounds:
                history_parts.append(f"User: {r.question}")
                history_parts.append(f"Assistant: {r.final_answer.body}")
            context_prefix = "--- Previous conversation ---\n" + "\n".join(history_parts) + "\n---\n\n"
            question_to_ask = context_prefix + "User: " + request.question
        else:
            question_to_ask = request.question

        yield self._sse("conversation_start", {"conversation_id": conversation_id, "question": request.question})

        level_max_rounds: dict[str, int] = {
            "off": 0,
            "low": 2,
            "auto": 4,
            "medium": 5,
            "high": 8,
        }
        max_rounds = level_max_rounds.get(request.level, 4)

        collected_summaries: list[StageSummary] = []
        final_body = ""

        for sse_event in run_discussion_stream(
            question=question_to_ask,
            agents=agents,
            providers=providers,
            secrets=secrets,
            max_rounds=max_rounds,
        ):
            yield sse_event

            if sse_event.startswith("event: summary_complete"):
                collected_summaries.append(
                    StageSummary.model_validate(json.loads(sse_event.split("data: ", 1)[1]))
                )

            if sse_event.startswith("event: final_delta"):
                try:
                    final_body += json.loads(sse_event.split("data: ", 1)[1])["delta"]
                except (json.JSONDecodeError, KeyError, IndexError):
                    pass

        collected_summaries = _merge_streamed_summaries(collected_summaries)

        final_answer = FinalAnswer(
            title="Final answer",
            body=final_body,
            confidence=0.82,
            limitations=["Generated via LangGraph multi-expert orchestration."],
        )

        new_round = ConversationRound(
            round_id=str(uuid4()),
            question=request.question,
            stage_summaries=collected_summaries,
            final_answer=final_answer,
        )

        if existing:
            try:
                def _append_round(record: ConversationRecord) -> None:
                    record.rounds.append(new_round)
                    record.updated_at = utc_now()
                response_record = self.store._update_record(conversation_id, _append_round)
                if response_record is None:
                    response_record = existing
            except Exception:
                title = request.question[:30] + ("..." if len(request.question) > 30 else "")
                response_record = ConversationRecord(
                    conversation_id=conversation_id,
                    title=title,
                    expert_count=expert_count,
                    rounds=[new_round],
                )
                self.store.append(response_record)
        else:
            title = request.question[:30] + ("..." if len(request.question) > 30 else "")
            response_record = ConversationRecord(
                conversation_id=conversation_id,
                title=title,
                expert_count=expert_count,
                rounds=[new_round],
            )
            self.store.append(response_record)

        yield self._sse(
            "conversation_complete",
            ConversationResponse(
                conversation_id=response_record.conversation_id,
                created_at=response_record.created_at,
                updated_at=response_record.updated_at,
                title=response_record.title,
                expert_count=response_record.expert_count,
                rounds=response_record.rounds,
            ).model_dump(mode="json"),
        )

    def _sse(self, event: str, payload: dict) -> str:
        return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
