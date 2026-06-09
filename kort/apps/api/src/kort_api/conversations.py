from __future__ import annotations

import asyncio
import json
import logging
import queue
import threading
import time
from collections.abc import Iterator
from pathlib import Path
from uuid import uuid4

from fastapi import HTTPException

from .orchestration import (
    classify_auto_route,
    run_direct_answer_stream,
    run_discussion_stream,
    run_solo_thinking_stream,
)
from .request_router import RouteDecision, route_request
from .schemas import (
    AgentDefinition,
    ConversationListItem,
    ConversationRecord,
    ConversationRequest,
    ConversationResponse,
    ConversationRound,
    DelegatedAgent,
    DelegationMetadata,
    FinalAnswer,
    ProviderProfile,
    StageSummary,
    utc_now,
)

logger = logging.getLogger(__name__)


class ConversationJob:
    def __init__(self, conversation_id: str) -> None:
        self.conversation_id = conversation_id
        self.events: list[str] = []
        self.done = False
        self.cancel_requested = False
        self.error: Exception | None = None
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


def _async_gen_to_sync(async_gen_func, *args, **kwargs) -> Iterator[str]:
    """Bridge an async generator to a sync iterator via a daemon thread.

    The async generator is consumed inside ``asyncio.run()`` on a dedicated
    thread.  Items are pushed into a thread-safe queue that the caller drains.
    """
    q: queue.Queue[tuple[str, object]] = queue.Queue()

    async def _runner() -> None:
        try:
            async for item in async_gen_func(*args, **kwargs):
                q.put(("item", item))
        except Exception as exc:
            q.put(("error", exc))
        finally:
            q.put(("done", None))

    def _thread_target() -> None:
        asyncio.run(_runner())

    thread = threading.Thread(target=_thread_target, daemon=True)
    thread.start()

    while True:
        try:
            kind, value = q.get(timeout=300)
        except queue.Empty:
            raise RuntimeError("Async generator bridge timed out")
        if kind == "done":
            break
        if kind == "error":
            # value is an Exception instance
            raise value  # type: ignore[misc]
        # kind == "item"
        yield value  # type: ignore[misc]


def _merge_streamed_summaries(events: list[StageSummary]) -> list[StageSummary]:
    seen: dict[str, StageSummary] = {}
    for item in events:
        seen[item.id] = item
    return list(seen.values())


def _sse_event_name(event: str) -> str:
    first_line = event.splitlines()[0] if event else ""
    return first_line.removeprefix("event:").strip() if first_line.startswith("event:") else "unknown"


def _provider_by_id(providers: list[ProviderProfile], provider_id: str) -> ProviderProfile | None:
    for provider in providers:
        if provider.provider_id == provider_id:
            return provider
    return None


def _enabled_agent(agent: AgentDefinition, providers: list[ProviderProfile], secrets: dict[str, str]) -> bool:
    provider = _provider_by_id(providers, agent.provider_profile)
    if provider is None or not provider.enabled:
        return False
    if provider.api_style != "openai":
        return False
    return provider.provider_type == "ollama" or bool(secrets.get(provider.provider_id, "").strip())


def _delegated_agent(agent: AgentDefinition) -> DelegatedAgent:
    return DelegatedAgent(
        name=agent.name,
        nickname=agent.nickname,
        role=agent.role,
        provider_profile=agent.provider_profile,
        model=agent.model,
    )


def _single_model_delegate(
    agents: list[AgentDefinition],
    providers: list[ProviderProfile],
    secrets: dict[str, str],
) -> list[DelegatedAgent]:
    role_rank = {"synthesizer": 0, "expert": 1, "summarizer": 2, "critic": 3}
    candidates = [agent for agent in agents if _enabled_agent(agent, providers, secrets)]
    candidates.sort(key=lambda item: (role_rank.get(item.role, 99), -item.priority, item.name))
    return [_delegated_agent(candidates[0])] if candidates else []


def _panel_delegates(
    agents: list[AgentDefinition],
    providers: list[ProviderProfile],
    secrets: dict[str, str],
) -> list[DelegatedAgent]:
    candidates = [agent for agent in agents if _enabled_agent(agent, providers, secrets)]
    candidates.sort(key=lambda item: (item.role, -item.priority, item.name))
    return [_delegated_agent(agent) for agent in candidates]


def _build_delegation_metadata(
    request: ConversationRequest,
    route_decision: RouteDecision,
    agents: list[AgentDefinition],
    providers: list[ProviderProfile],
    secrets: dict[str, str],
) -> DelegationMetadata:
    delegated_agents = (
        _panel_delegates(agents, providers, secrets)
        if route_decision.kind == "panel"
        else _single_model_delegate(agents, providers, secrets)
    )
    return DelegationMetadata(
        route_kind=route_decision.kind,
        reason_code=route_decision.reason_code,
        discussion_level=request.level,
        deep_think=request.deep_think,
        participant_count=len(delegated_agents),
        max_rounds=route_decision.max_rounds,
        agents=delegated_agents,
    )


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
                    fpath.write_text(json.dumps(record.model_dump(), ensure_ascii=False, indent=2), encoding="utf-8")
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
            file_path = self.path / f"{record.conversation_id}.json"
            file_path.write_text(
                json.dumps(record.model_dump(mode="json"), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

    def append(self, record: ConversationRecord) -> None:
        file_path = self.path / f"{record.conversation_id}.json"
        file_path.write_text(
            json.dumps(record.model_dump(mode="json"), ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        logger.debug("conversation_store.saved conversation_id=%s rounds=%s", record.conversation_id, len(record.rounds))

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
        return True


class VisibleConversationService:
    def __init__(self, store: ConversationStore) -> None:
        self.store = store
        self.jobs: dict[str, ConversationJob] = {}
        self.jobs_lock = threading.Lock()

    def list_conversations(self) -> list[ConversationListItem]:
        records = self.store.list_records()
        logger.info("conversations.list count=%s", len(records))
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

    def cancel_conversation(self, conversation_id: str) -> bool:
        with self.jobs_lock:
            job = self.jobs.get(conversation_id)
        if job is None or job.done:
            logger.info("conversation_job.cancel_missing conversation_id=%s", conversation_id)
            return False
        job.cancel()
        logger.info("conversation_job.cancel_requested conversation_id=%s event_count=%s", conversation_id, len(job.events))
        return True

    def stream_existing_job(self, conversation_id: str) -> Iterator[str] | None:
        with self.jobs_lock:
            job = self.jobs.get(conversation_id)
        if job is None:
            logger.info("conversation_job.resume_missing conversation_id=%s", conversation_id)
            return None
        logger.info("conversation_job.resume conversation_id=%s done=%s event_count=%s", conversation_id, job.done, len(job.events))
        return job.stream()

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

        with self.jobs_lock:
            job = self.jobs.get(conversation_id)
            if job is not None and not job.done:
                logger.info(
                    "conversation_job.replace_running conversation_id=%s previous_event_count=%s",
                    conversation_id,
                    len(job.events),
                )
                job.cancel()
            job = ConversationJob(conversation_id)
            self.jobs[conversation_id] = job
            logger.info(
                "conversation_job.start conversation_id=%s level=%s deep_think=%s has_existing=%s",
                conversation_id,
                request.level,
                request.deep_think,
                existing is not None,
            )
            thread = threading.Thread(
                target=self._run_job,
                args=(job, request, conversation_id, existing, expert_count, agents, providers, secrets),
                daemon=True,
            )
            thread.start()

        return job.stream()

    def _run_job(
        self,
        job: ConversationJob,
        request: ConversationRequest,
        conversation_id: str,
        existing: ConversationRecord | None,
        expert_count: int,
        agents: list[AgentDefinition],
        providers: list[ProviderProfile],
        secrets: dict[str, str],
    ) -> None:
        try:
            for event in self._generate_conversation_events(
                job,
                request,
                conversation_id,
                existing,
                expert_count,
                agents,
                providers,
                secrets,
            ):
                if job.cancel_requested:
                    logger.info("conversation_job.cancelled_before_append conversation_id=%s", conversation_id)
                    break
                logger.debug("conversation_job.event conversation_id=%s event=%s", conversation_id, _sse_event_name(event))
                job.append(event)
        except Exception as exc:
            logger.exception("conversation_job.error conversation_id=%s", conversation_id)
            job.finish(exc)
            return
        logger.info("conversation_job.complete conversation_id=%s event_count=%s", conversation_id, len(job.events))
        job.finish()

    def _generate_conversation_events(
        self,
        job: ConversationJob,
        request: ConversationRequest,
        conversation_id: str,
        existing: ConversationRecord | None,
        expert_count: int,
        agents: list[AgentDefinition],
        providers: list[ProviderProfile],
        secrets: dict[str, str],
    ) -> Iterator[str]:

        def _cancelled() -> bool:
            if job.cancel_requested:
                logger.info("conversation_job.generation_cancelled conversation_id=%s", conversation_id)
                return True
            return False

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

        collected_summaries: list[StageSummary] = []
        final_body = ""
        delegation: DelegationMetadata | None = None

        try:
            yield self._sse("conversation_start", {"conversation_id": conversation_id, "question": request.question})
            if _cancelled():
                return

            if request.deep_think and request.level != "off":
                raise HTTPException(
                    status_code=422,
                    detail="deep_think mode requires discussion level to be 'off'",
                )

            route_decision = route_request(request)
            if request.level == "auto" and route_decision.reason_code == "auto_panel":
                route_decision = classify_auto_route(
                    question=request.question,
                    agents=agents,
                    providers=providers,
                    secrets=secrets,
                    has_history=bool(existing and existing.rounds),
                )
            logger.info(
                "conversation_route conversation_id=%s kind=%s reason=%s max_rounds=%s has_history=%s",
                conversation_id,
                route_decision.kind,
                route_decision.reason_code,
                route_decision.max_rounds,
                bool(existing and existing.rounds),
            )
            delegation = _build_delegation_metadata(request, route_decision, agents, providers, secrets)
            yield self._sse("delegation_complete", delegation.model_dump(mode="json"))
            if _cancelled():
                return

            if route_decision.kind == "solo_thinking":
                # --- Deep-think (solo model with CoT summaries) ---
                for sse_event in _async_gen_to_sync(
                    run_solo_thinking_stream,
                    question=question_to_ask,
                    agents=agents,
                    providers=providers,
                    secrets=secrets,
                ):
                    yield sse_event
                    if _cancelled():
                        return

                    if sse_event.startswith("event: summary_complete"):
                        collected_summaries.append(
                            StageSummary.model_validate(json.loads(sse_event.split("data: ", 1)[1]))
                        )

                    if sse_event.startswith("event: final_delta"):
                        try:
                            final_body += json.loads(sse_event.split("data: ", 1)[1])["delta"]
                        except (json.JSONDecodeError, KeyError, IndexError):
                            pass
            elif route_decision.kind == "direct":
                # --- Direct answer: no visible thinking projection ---
                for sse_event in run_direct_answer_stream(
                    question=question_to_ask,
                    agents=agents,
                    providers=providers,
                    secrets=secrets,
                ):
                    yield sse_event
                    if _cancelled():
                        return

                    if sse_event.startswith("event: final_delta"):
                        try:
                            final_body += json.loads(sse_event.split("data: ", 1)[1])["delta"]
                        except (json.JSONDecodeError, KeyError, IndexError):
                            pass
            else:
                # --- Discussion stream ---
                for sse_event in run_discussion_stream(
                    question=question_to_ask,
                    agents=agents,
                    providers=providers,
                    secrets=secrets,
                    max_rounds=route_decision.max_rounds,
                ):
                    yield sse_event
                    if _cancelled():
                        return

                    if sse_event.startswith("event: summary_complete"):
                        collected_summaries.append(
                            StageSummary.model_validate(json.loads(sse_event.split("data: ", 1)[1]))
                        )

                    if sse_event.startswith("event: final_delta"):
                        try:
                            final_body += json.loads(sse_event.split("data: ", 1)[1])["delta"]
                        except (json.JSONDecodeError, KeyError, IndexError):
                            pass

            if _cancelled():
                return

            collected_summaries = _merge_streamed_summaries(collected_summaries)

            final_answer = FinalAnswer(
                title="Final answer",
                body=final_body,
                confidence=0.82,
                limitations=[],
            )

            new_round = ConversationRound(
                round_id=str(uuid4()),
                question=request.question,
                stage_summaries=collected_summaries,
                final_answer=final_answer,
                delegation=delegation,
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
        except GeneratorExit:
            logger.info(
                "conversation_job.client_disconnected conversation_id=%s summaries=%s final_chars=%s",
                conversation_id,
                len(collected_summaries),
                len(final_body),
            )
            if job.cancel_requested:
                return
            # Client disconnected (e.g. user clicked pause).
            # Save partial progress so it survives page refreshes.
            if not collected_summaries and not final_body:
                pass
            else:
                partial_round = ConversationRound(
                    round_id=str(uuid4()),
                    question=request.question,
                    stage_summaries=_merge_streamed_summaries(collected_summaries),
                    final_answer=FinalAnswer(
                        title="Partial answer",
                        body=final_body,
                        confidence=0.5,
                        limitations=["Conversation was paused by the user."],
                    ),
                    delegation=delegation,
                )
                if existing:
                    try:
                        def _append_partial(record: ConversationRecord) -> None:
                            record.rounds.append(partial_round)
                            record.updated_at = utc_now()
                        self.store._update_record(conversation_id, _append_partial)
                    except Exception:
                        pass
                else:
                    title = request.question[:30] + ("..." if len(request.question) > 30 else "")
                    partial_record = ConversationRecord(
                        conversation_id=conversation_id,
                        title=title,
                        expert_count=expert_count,
                        rounds=[partial_round],
                    )
                    try:
                        self.store.append(partial_record)
                    except Exception:
                        pass

    def _sse(self, event: str, payload: dict) -> str:
        return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
