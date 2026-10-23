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

from .memory import MemoryStore
from .orchestration import (
    classify_auto_route,
    run_direct_answer_stream,
    run_discussion_stream,
    run_solo_thinking_stream,
)
from .providers import model_is_selected, provider_is_reachable
from .request_router import RouteDecision, route_request
from .schemas import (
    AgentDefinition,
    BranchRequest,
    ConversationListItem,
    ConversationRecord,
    ConversationRequest,
    ConversationResponse,
    DelegatedAgent,
    DelegationMetadata,
    DiscussionMessage,
    MessageNode,
    MessageNodeView,
    ProviderProfile,
    StageSummary,
    utc_now,
)

logger = logging.getLogger(__name__)

STOPPED_ASSISTANT_CONTEXT = "[Response was stopped by the user.]"
FAILED_ASSISTANT_CONTEXT = "[This response failed to generate.]"


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
            raise value  # type: ignore[misc]
        yield value  # type: ignore[misc]


def _merge_streamed_summaries(events: list[StageSummary]) -> list[StageSummary]:
    seen: dict[str, StageSummary] = {}
    for item in events:
        seen[item.id] = item
    return list(seen.values())


def _sse_event_name(event: str) -> str:
    first_line = event.splitlines()[0] if event else ""
    return first_line.removeprefix("event:").strip() if first_line.startswith("event:") else "unknown"


def _children_index(nodes: list[MessageNode]) -> dict[str | None, list[MessageNode]]:
    grouped: dict[str | None, list[MessageNode]] = {}
    for node in nodes:
        grouped.setdefault(node.parent_id, []).append(node)
    return grouped


def _path_to(nodes: list[MessageNode], node_id: str) -> list[MessageNode]:
    by_id = {node.node_id: node for node in nodes}
    path: list[MessageNode] = []
    seen: set[str] = set()
    current = by_id.get(node_id)
    while current is not None and current.node_id not in seen:
        seen.add(current.node_id)
        path.append(current)
        current = by_id.get(current.parent_id) if current.parent_id else None
    path.reverse()
    return path


def _active_path_ids(record: ConversationRecord) -> list[str]:
    by_id = {node.node_id: node for node in record.nodes}
    ids: list[str] = []
    seen: set[str] = set()
    current = by_id.get(record.active_root_id) if record.active_root_id else None
    while current is not None and current.node_id not in seen:
        seen.add(current.node_id)
        ids.append(current.node_id)
        current = by_id.get(current.active_child_id) if current.active_child_id else None
    return ids


def _assistant_history_body(node: MessageNode) -> str:
    body = node.content.strip()
    if node.status == "cancelled":
        return f"{body}\n{STOPPED_ASSISTANT_CONTEXT}".strip() if body else STOPPED_ASSISTANT_CONTEXT
    if node.status == "error":
        return f"{body}\n{FAILED_ASSISTANT_CONTEXT}".strip() if body else FAILED_ASSISTANT_CONTEXT
    return body


def _history_prefix(nodes: list[MessageNode]) -> str:
    parts: list[str] = []
    for node in nodes:
        if node.role == "user":
            parts.append(f"User: {node.content}")
        else:
            parts.append(f"Assistant: {_assistant_history_body(node)}")
    if not parts:
        return ""
    return "--- Previous conversation ---\n" + "\n".join(parts) + "\n---\n\n"


def _node_view(node: MessageNode, children: list[MessageNode]) -> MessageNodeView:
    return MessageNodeView(**node.model_dump(), children=[child.node_id for child in children])


def _conversation_response(record: ConversationRecord) -> ConversationResponse:
    grouped = _children_index(record.nodes)
    return ConversationResponse(
        conversation_id=record.conversation_id,
        created_at=record.created_at,
        updated_at=record.updated_at,
        title=record.title,
        expert_count=record.expert_count,
        nodes=[_node_view(node, grouped.get(node.node_id, [])) for node in record.nodes],
        active_root_id=record.active_root_id,
        active_path=_active_path_ids(record),
    )


def _provider_by_id(providers: list[ProviderProfile], provider_id: str) -> ProviderProfile | None:
    for provider in providers:
        if provider.provider_id == provider_id:
            return provider
    return None


def _enabled_agent(agent: AgentDefinition, providers: list[ProviderProfile], secrets: dict[str, str]) -> bool:
    provider = _provider_by_id(providers, agent.provider_profile)
    if provider is None or not provider_is_reachable(provider, secrets):
        return False
    return model_is_selected(provider, agent.model)


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
        return True


class VisibleConversationService:
    def __init__(self, store: ConversationStore, memory_store: MemoryStore | None = None) -> None:
        self.store = store
        self.memory_store = memory_store
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
        with self.jobs_lock:
            job = self.jobs.get(conversation_id)
        if job is None or job.done:
            interrupted = [node for node in record.nodes if node.status == "streaming"]
            for node in interrupted:
                node.status = "error"
                node.error = node.error or "Generation was interrupted."
            if interrupted:
                record.updated_at = utc_now()
                self.store.append(record)
        return _conversation_response(record)

    def set_active_path(self, conversation_id: str, node_id: str) -> ConversationResponse | None:
        record = self.store.get_record(conversation_id)
        if record is None:
            return None
        path = _path_to(record.nodes, node_id)
        if not path:
            raise HTTPException(status_code=404, detail="Message node not found")
        for parent, child in zip(path, path[1:]):
            parent.active_child_id = child.node_id
        if path[0].parent_id is None:
            record.active_root_id = path[0].node_id
        record.updated_at = utc_now()
        self.store.append(record)
        return _conversation_response(record)

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
        if job is None:
            logger.info("conversation_job.cancel_missing conversation_id=%s", conversation_id)
            return False
        with job.condition:
            if job.done:
                logger.info("conversation_job.cancel_missing conversation_id=%s", conversation_id)
                return False
            job.cancel_requested = True
            job.condition.notify_all()
        try:
            node = self._finalize_job_node(job, status="cancelled")
        except Exception:
            logger.exception("conversation_job.cancel_persist_failed conversation_id=%s", conversation_id)
            node = None
        logger.info(
            "conversation_job.cancel_requested conversation_id=%s node=%s",
            conversation_id,
            node.node_id if node else None,
        )
        return True

    def stream_existing_job(self, conversation_id: str) -> Iterator[str] | None:
        with self.jobs_lock:
            job = self.jobs.get(conversation_id)
        if job is None:
            logger.info("conversation_job.resume_missing conversation_id=%s", conversation_id)
            return None
        logger.info(
            "conversation_job.resume conversation_id=%s done=%s event_count=%s",
            conversation_id,
            job.done,
            len(job.events),
        )
        return job.stream()

    def stream_branch(
        self,
        conversation_id: str,
        payload: BranchRequest,
        *,
        expert_count: int,
        agents: list[AgentDefinition],
        providers: list[ProviderProfile],
        secrets: dict[str, str],
    ) -> Iterator[str]:
        record, user_node, assistant_node = self._prepare_branch(
            conversation_id,
            payload,
            expert_count=expert_count,
        )
        job = ConversationJob(
            conversation_id,
            user_node_id=user_node.node_id,
            assistant_node_id=assistant_node.node_id,
            question=user_node.content,
            expert_count=expert_count,
        )
        with self.jobs_lock:
            self.jobs[conversation_id] = job
            logger.info(
                "conversation_job.start conversation_id=%s role=%s level=%s deep_think=%s parent=%s",
                conversation_id,
                payload.role,
                payload.level,
                payload.deep_think,
                payload.parent_id,
            )
            thread = threading.Thread(
                target=self._run_job,
                args=(job, payload, record, agents, providers, secrets),
                daemon=True,
            )
            thread.start()
        return job.stream()

    def _prepare_branch(
        self,
        conversation_id: str,
        payload: BranchRequest,
        *,
        expert_count: int,
    ) -> tuple[ConversationRecord, MessageNode, MessageNode]:
        self._cancel_running_job(conversation_id)
        record = self.store.get_record(conversation_id)
        if record is None:
            if payload.parent_id is not None:
                raise HTTPException(status_code=404, detail="Conversation not found")
            if payload.role != "user":
                raise HTTPException(status_code=422, detail="A new conversation must start with a user message")
            title = payload.content.strip()
            record = ConversationRecord(
                conversation_id=conversation_id,
                title=title[:30] + ("..." if len(title) > 30 else ""),
                expert_count=expert_count,
            )

        by_id = {node.node_id: node for node in record.nodes}
        parent = by_id.get(payload.parent_id) if payload.parent_id else None
        if payload.parent_id and parent is None:
            raise HTTPException(status_code=404, detail="Message node not found")

        if payload.role == "user":
            if parent is not None and parent.role != "assistant":
                raise HTTPException(status_code=422, detail="A user message can only follow an assistant reply")
            user_node = MessageNode(
                node_id=str(uuid4()),
                parent_id=parent.node_id if parent else None,
                role="user",
                content=payload.content.strip(),
            )
            assistant_node = MessageNode(
                node_id=str(uuid4()),
                parent_id=user_node.node_id,
                role="assistant",
                status="streaming",
            )
            record.nodes.extend([user_node, assistant_node])
            user_node.active_child_id = assistant_node.node_id
            if parent is None:
                record.active_root_id = user_node.node_id
            else:
                parent.active_child_id = user_node.node_id
        else:
            if parent is None or parent.role != "user":
                raise HTTPException(status_code=422, detail="A retry must branch from a user message")
            user_node = parent
            assistant_node = MessageNode(
                node_id=str(uuid4()),
                parent_id=user_node.node_id,
                role="assistant",
                status="streaming",
            )
            record.nodes.append(assistant_node)
            user_node.active_child_id = assistant_node.node_id

        record.updated_at = utc_now()
        if expert_count:
            record.expert_count = expert_count
        self.store.append(record)
        return record, user_node, assistant_node

    def _cancel_running_job(self, conversation_id: str) -> None:
        with self.jobs_lock:
            job = self.jobs.get(conversation_id)
        if job is not None and not job.done:
            logger.info("conversation_job.replace_running conversation_id=%s", conversation_id)
            self.cancel_conversation(conversation_id)

    def _run_job(
        self,
        job: ConversationJob,
        payload: BranchRequest,
        record: ConversationRecord,
        agents: list[AgentDefinition],
        providers: list[ProviderProfile],
        secrets: dict[str, str],
    ) -> None:
        try:
            for event in self._generate_conversation_events(job, payload, record, agents, providers, secrets):
                if job.cancel_requested:
                    logger.info("conversation_job.cancelled_before_append conversation_id=%s", job.conversation_id)
                    break
                logger.debug(
                    "conversation_job.event conversation_id=%s event=%s",
                    job.conversation_id,
                    _sse_event_name(event),
                )
                job.append(event)
        except Exception as exc:
            logger.exception("conversation_job.error conversation_id=%s", job.conversation_id)
            try:
                node = self._finalize_job_node(job, status="error", error=str(exc))
            except Exception:
                logger.exception("conversation_job.error_persist_failed conversation_id=%s", job.conversation_id)
                node = None
            if node is not None:
                job.append(
                    self._sse(
                        "node_complete",
                        {
                            "conversation_id": job.conversation_id,
                            "node": node.model_dump(mode="json"),
                        },
                    )
                )
            else:
                job.finish(exc)
                return
        logger.info(
            "conversation_job.complete conversation_id=%s event_count=%s",
            job.conversation_id,
            len(job.events),
        )
        job.finish()

    def _finalize_job_node(
        self,
        job: ConversationJob,
        *,
        status: str,
        error: str | None = None,
    ) -> MessageNode | None:
        if not job.assistant_node_id or not job.claim_finalization():
            return None
        record = self.store.get_record(job.conversation_id)
        if record is None:
            return None
        node = next((item for item in record.nodes if item.node_id == job.assistant_node_id), None)
        if node is None:
            return None
        node.status = status  # type: ignore[assignment]
        node.content = job.partial_body
        node.stage_summaries = _merge_streamed_summaries(job.partial_summaries)
        node.discussion_messages = job.partial_messages
        node.delegation = job.delegation
        node.error = error
        node.elapsed_ms = max(node.elapsed_ms, self._job_elapsed_ms(job))
        record.updated_at = utc_now()
        self.store.append(record)
        return node

    def _generate_conversation_events(
        self,
        job: ConversationJob,
        payload: BranchRequest,
        record: ConversationRecord,
        agents: list[AgentDefinition],
        providers: list[ProviderProfile],
        secrets: dict[str, str],
    ) -> Iterator[str]:
        def _cancelled() -> bool:
            if job.cancel_requested:
                logger.info("conversation_job.generation_cancelled conversation_id=%s", job.conversation_id)
                return True
            return False

        conversation_id = record.conversation_id
        user_node = next((item for item in record.nodes if item.node_id == job.user_node_id), None)
        assistant_node = next((item for item in record.nodes if item.node_id == job.assistant_node_id), None)
        if user_node is None or assistant_node is None:
            raise RuntimeError("branch nodes missing")

        path = _path_to(record.nodes, user_node.node_id)
        history = path[:-1]
        question = user_node.content
        question_to_ask = _history_prefix(history) + "User: " + question
        request = ConversationRequest(
            question=question,
            level=payload.level,
            conversation_id=conversation_id,
            deep_think=payload.deep_think,
            custom_max_rounds=payload.custom_max_rounds,
        )
        agent_contexts = (
            self.memory_store.build_contexts(agents, question) if self.memory_store is not None else None
        )

        try:
            yield self._sse(
                "branch_started",
                {
                    "conversation_id": conversation_id,
                    "title": record.title,
                    "active_root_id": record.active_root_id,
                    "nodes": [
                        user_node.model_dump(mode="json"),
                        assistant_node.model_dump(mode="json"),
                    ],
                },
            )
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
                    question=question,
                    agents=agents,
                    providers=providers,
                    secrets=secrets,
                    has_history=bool(history),
                )
            logger.info(
                "conversation_route conversation_id=%s kind=%s reason=%s max_rounds=%s has_history=%s",
                conversation_id,
                route_decision.kind,
                route_decision.reason_code,
                route_decision.max_rounds,
                bool(history),
            )
            delegation = _build_delegation_metadata(request, route_decision, agents, providers, secrets)
            job.delegation = delegation
            yield self._sse("delegation_complete", delegation.model_dump(mode="json"))
            if _cancelled():
                return

            if route_decision.kind == "solo_thinking":
                for sse_event in _async_gen_to_sync(
                    run_solo_thinking_stream,
                    question=question_to_ask,
                    agents=agents,
                    providers=providers,
                    secrets=secrets,
                    agent_contexts=agent_contexts,
                ):
                    self._track_event(job, sse_event)
                    yield sse_event
                    if _cancelled():
                        return
            elif route_decision.kind == "direct":
                for sse_event in run_direct_answer_stream(
                    question=question_to_ask,
                    agents=agents,
                    providers=providers,
                    secrets=secrets,
                    agent_contexts=agent_contexts,
                ):
                    self._track_event(job, sse_event)
                    yield sse_event
                    if _cancelled():
                        return
            else:
                for sse_event in run_discussion_stream(
                    question=question_to_ask,
                    agents=agents,
                    providers=providers,
                    secrets=secrets,
                    max_rounds=route_decision.max_rounds,
                    agent_contexts=agent_contexts,
                ):
                    self._track_event(job, sse_event)
                    yield sse_event
                    if _cancelled():
                        return
                    if sse_event.startswith("event: early_stop_detected"):
                        try:
                            early_stop_data = json.loads(sse_event.split("data: ", 1)[1])
                            delegation.actual_rounds = early_stop_data.get("actual_rounds", 0)
                            delegation.early_stop = True
                            delegation.early_stop_reason = early_stop_data.get("early_stop_reason")
                            delegation.convergence_score = early_stop_data.get("convergence_score")
                        except (json.JSONDecodeError, KeyError, IndexError):
                            pass

            if _cancelled():
                return

            if not job.claim_finalization():
                return
            completed = self._store_completed_node(job, delegation)
            if completed is None:
                raise RuntimeError("assistant node disappeared before completion")
            self._remember_round(
                conversation_id=conversation_id,
                question=question,
                final_answer=completed.content,
                summaries=completed.stage_summaries,
                delegation=delegation,
                agents=agents,
                providers=providers,
                secrets=secrets,
            )
            yield self._sse(
                "node_complete",
                {
                    "conversation_id": conversation_id,
                    "title": record.title,
                    "active_root_id": record.active_root_id,
                    "node": completed.model_dump(mode="json"),
                },
            )
        except GeneratorExit:
            logger.info(
                "conversation_job.client_disconnected conversation_id=%s summaries=%s final_chars=%s",
                conversation_id,
                len(job.partial_summaries),
                len(job.partial_body),
            )
            raise

    def _track_event(self, job: ConversationJob, sse_event: str) -> None:
        if sse_event.startswith("event: thinking_complete"):
            elapsed_ms = 0
            try:
                elapsed_ms = int(json.loads(sse_event.split("data: ", 1)[1]).get("elapsed_ms") or 0)
            except (json.JSONDecodeError, ValueError, AttributeError):
                elapsed_ms = 0
            # Discussion/direct routes omit elapsed_ms; fall back to the job clock
            if elapsed_ms <= 0:
                elapsed_ms = int((time.monotonic() - job.started_at) * 1000)
            job.thinking_elapsed_ms = max(job.thinking_elapsed_ms, elapsed_ms)
        elif sse_event.startswith("event: final_delta"):
            try:
                job.partial_body += json.loads(sse_event.split("data: ", 1)[1])["delta"]
            except (json.JSONDecodeError, KeyError, IndexError):
                pass
        elif sse_event.startswith("event: summary_complete"):
            try:
                job.partial_summaries.append(
                    StageSummary.model_validate(json.loads(sse_event.split("data: ", 1)[1]))
                )
            except (json.JSONDecodeError, KeyError, IndexError, ValueError):
                pass
        elif sse_event.startswith("event: discussion_message"):
            try:
                job.partial_messages.append(
                    DiscussionMessage.model_validate(json.loads(sse_event.split("data: ", 1)[1]))
                )
            except (json.JSONDecodeError, KeyError, IndexError, ValueError):
                pass

    def _store_completed_node(
        self,
        job: ConversationJob,
        delegation: DelegationMetadata | None,
    ) -> MessageNode | None:
        record = self.store.get_record(job.conversation_id)
        if record is None:
            return None
        node = next((item for item in record.nodes if item.node_id == job.assistant_node_id), None)
        if node is None:
            return None
        node.status = "complete"
        node.content = job.partial_body
        node.stage_summaries = _merge_streamed_summaries(job.partial_summaries)
        node.discussion_messages = job.partial_messages
        node.delegation = delegation
        node.error = None
        node.elapsed_ms = max(node.elapsed_ms, self._job_elapsed_ms(job))
        record.updated_at = utc_now()
        self.store.append(record)
        return node

    @staticmethod
    def _job_elapsed_ms(job: ConversationJob) -> int:
        return job.thinking_elapsed_ms or max(1, int((time.monotonic() - job.started_at) * 1000))

    def _remember_round(
        self,
        *,
        conversation_id: str,
        question: str,
        final_answer: str,
        summaries: list[StageSummary],
        delegation: DelegationMetadata | None,
        agents: list[AgentDefinition],
        providers: list[ProviderProfile],
        secrets: dict[str, str],
    ) -> None:
        """Persist a visible-only episode card, then let at most one agent consolidate it."""
        if self.memory_store is None or delegation is None:
            return

        role_by_name = {agent.name: agent.role for agent in agents}
        participants: list[str] = []
        for delegated in delegation.agents:
            if delegated.role == "summarizer" or role_by_name.get(delegated.name) == "summarizer":
                continue
            if delegated.name not in participants:
                participants.append(delegated.name)
        if not participants:
            return

        try:
            episode_id = self.memory_store.record_round(
                conversation_id=conversation_id,
                question=question,
                final_answer=final_answer,
                summaries=summaries,
                agents=participants,
            )
        except Exception:
            logger.exception("memory.record_failed conversation_id=%s", conversation_id)
            return
        if not episode_id or not self.memory_store.auto_dream:
            return

        definitions = {agent.name: agent for agent in agents}
        for name in participants:
            try:
                if not self.memory_store.should_dream(name):
                    continue
                definition = definitions.get(name)
                provider = next(
                    (
                        item
                        for item in providers
                        if definition is not None and item.provider_id == definition.provider_profile
                    ),
                    None,
                )
                if definition is None or provider is None or not provider_is_reachable(provider, secrets):
                    continue
                profile = provider.model_copy(update={"default_model": definition.model})
            except Exception:
                logger.exception("memory.dream_prepare_failed agent=%s", name)
                continue

            thread = threading.Thread(
                target=self._dream_agent,
                args=(name, profile, dict(secrets)),
                daemon=True,
            )
            thread.start()
            break

    def _dream_agent(self, agent_name: str, provider: ProviderProfile, secrets: dict[str, str]) -> None:
        try:
            assert self.memory_store is not None
            report = self.memory_store.dream(agent_name, provider, secrets, apply=True)
            logger.info(
                "memory.dream_applied agent=%s stats=%s",
                agent_name,
                report.get("stats"),
            )
        except Exception:
            logger.exception("memory.dream_failed agent=%s", agent_name)

    def _sse(self, event: str, payload: dict) -> str:
        return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
