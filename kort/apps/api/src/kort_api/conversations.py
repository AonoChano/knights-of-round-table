"""Visible conversation service composed from store, stream and memory layers."""

from __future__ import annotations

import json
import logging
import threading
import time
from collections.abc import Iterator
from uuid import uuid4

from fastapi import HTTPException

from .conversation_helpers import (
    _async_gen_to_sync,
    _attachment_block,
    _build_delegation_metadata,
    _conversation_response,
    _history_prefix,
    _image_data_urls,
    _merge_streamed_summaries,
    _path_to,
    _resolve_harness_agents,
    _search_context,
    _sse_event_name,
)
from .conversation_memory import ConversationMemoryMixin
from .conversation_store import ConversationJob, ConversationStore
from .conversation_stream import ConversationStreamMixin
from .memory import MemoryStore
from .orchestration import (
    classify_auto_route,
    run_direct_answer_stream,
    run_discussion_stream,
    run_solo_thinking_stream,
)
from .request_router import route_request
from .schemas import (
    AgentDefinition,
    BranchRequest,
    ConversationListItem,
    ConversationRecord,
    ConversationRequest,
    ConversationResponse,
    ConversationSearchHit,
    ConversationSearchResponse,
    DelegationMetadata,
    MessageNode,
    ProviderProfile,
    utc_now,
)

logger = logging.getLogger(__name__)


class VisibleConversationService(ConversationStreamMixin, ConversationMemoryMixin):
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
        images = _image_data_urls(user_node.attachments)
        question = user_node.content.strip() or (
            "Describe the attached image(s) in detail." if images else ""
        )
        question_to_ask = (
            _history_prefix(history) + "User: " + question + _attachment_block(user_node.attachments)
        )
        search_context = _search_context(history)
        request = ConversationRequest(
            question=question,
            level=payload.level,
            conversation_id=conversation_id,
            deep_think=payload.deep_think,
            custom_max_rounds=payload.custom_max_rounds,
            model_override=payload.model_override,
        )
        harness_mode = request.level == "off"
        answer_agents = (
            _resolve_harness_agents(
                payload, agents, providers, secrets, require_vision=bool(images)
            )
            if harness_mode
            else agents
        )
        preferred_agent = None if harness_mode else payload.preferred_agent
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
            delegation: DelegationMetadata | None = None
            if not harness_mode:
                delegation = _build_delegation_metadata(request, route_decision, agents, providers, secrets)
                job.delegation = delegation
                yield self._sse("delegation_complete", delegation.model_dump(mode="json"))
                if _cancelled():
                    return

            answer_stream = None
            if payload.web_search != "disabled":
                def answer_stream(prompt: str) -> Iterator[str]:
                    return self._stream_agent_answer(
                        job=job,
                        prompt=prompt,
                        deep_think=request.deep_think,
                        agents=answer_agents,
                        providers=providers,
                        secrets=secrets,
                        agent_contexts=agent_contexts,
                        require_search=payload.web_search == "required",
                        search_query=question,
                        search_context=search_context,
                        preferred_agent=preferred_agent,
                        images=images,
                    )

            if route_decision.kind == "solo_thinking":
                events = (
                    answer_stream(question_to_ask)
                    if answer_stream is not None
                    else _async_gen_to_sync(
                        run_solo_thinking_stream,
                        question=question_to_ask,
                        agents=answer_agents,
                        providers=providers,
                        secrets=secrets,
                        agent_contexts=agent_contexts,
                        preferred_agent=preferred_agent,
                    )
                )
                for sse_event in events:
                    self._track_event(job, sse_event)
                    yield sse_event
                    if _cancelled():
                        return
            elif route_decision.kind == "direct":
                for sse_event in run_direct_answer_stream(
                    question=question_to_ask,
                    agents=answer_agents,
                    providers=providers,
                    secrets=secrets,
                    agent_contexts=agent_contexts,
                    answer_stream=answer_stream,
                    preferred_agent=preferred_agent,
                    images=images,
                ):
                    self._track_event(job, sse_event)
                    yield sse_event
                    if _cancelled():
                        return
            else:
                for sse_event in run_discussion_stream(
                    question=question_to_ask,
                    agents=answer_agents,
                    providers=providers,
                    secrets=secrets,
                    max_rounds=route_decision.max_rounds,
                    agent_contexts=agent_contexts,
                    answer_stream=answer_stream,
                    preferred_agent=preferred_agent,
                ):
                    self._track_event(job, sse_event)
                    yield sse_event
                    if _cancelled():
                        return
                    if delegation is not None and sse_event.startswith("event: early_stop_detected"):
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

    def search_conversations(
        self,
        query: str,
        *,
        scope: str = "all",
        limit: int = 20,
        cursor: str | None = None,
    ) -> ConversationSearchResponse:
        started = time.perf_counter()
        try:
            page = self.store.search(query, scope=scope, limit=limit, cursor=cursor)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        logger.info(
            "conversations.search query=%s scope=%s hits=%s total=%s duration_ms=%.1f",
            page.query[:40],
            page.scope,
            len(page.results),
            page.total,
            (time.perf_counter() - started) * 1000,
        )
        return ConversationSearchResponse(
            query=page.query,
            scope=page.scope,  # type: ignore[arg-type]
            results=[
                ConversationSearchHit(
                    conversation_id=hit.conversation_id,
                    conversation_title=hit.conversation_title,
                    node_id=hit.node_id,
                    match_type=hit.match_type,  # type: ignore[arg-type]
                    role=hit.role,  # type: ignore[arg-type]
                    snippet=hit.snippet,
                    matches=[list(pair) for pair in hit.matches],
                    matched_at=hit.message_time,
                    score=hit.score,
                )
                for hit in page.results
            ],
            next_cursor=page.next_cursor,
            total=page.total,
            took_ms=page.took_ms,
        )

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
        if (
            payload.role == "user"
            and payload.level == "off"
            and any(item.kind == "image" for item in payload.attachments)
        ):
            # Fail before recording the branch when no vision-capable model can take the image.
            _resolve_harness_agents(payload, agents, providers, secrets, require_vision=True)
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
            title = payload.content.strip() or next(
                (item.name for item in payload.attachments if item.kind == "image"),
                "Image conversation",
            )
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
                attachments=list(payload.attachments),
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
        node.tool_traces = list(job.partial_traces.values())
        node.delegation = job.delegation
        node.error = error
        node.elapsed_ms = max(node.elapsed_ms, self._job_elapsed_ms(job))
        record.updated_at = utc_now()
        self.store.append(record)
        return node


__all__ = ["ConversationJob", "ConversationStore", "VisibleConversationService"]
