"""Streaming pipeline for visible conversation turns."""

from __future__ import annotations

import asyncio
import json
import logging
import queue
import threading
import time
from collections.abc import Iterator

from fastapi import HTTPException

from .agent_loop import AgentEvent, run_agent_stream
from .conversation_helpers import (
    _attachment_block,
    _async_gen_to_sync,
    _build_delegation_metadata,
    _enabled_agent,
    _history_prefix,
    _image_data_urls,
    _merge_streamed_summaries,
    _model_has_vision,
    _panel_delegates,
    _path_to,
    _provider_by_id,
    _resolve_harness_agents,
    _search_context,
    _single_model_delegate,
    _sse_event_name,
    _vision_fallback_seat,
)
from .conversation_store import ConversationJob
from .orchestration import (
    THINK_CHUNK_SIZE,
    THINK_MIN_CHARS,
    select_summarizer,
    thinking_projection_events,
)
from .schemas import (
    AgentDefinition,
    BranchRequest,
    ConversationRecord,
    ConversationRequest,
    DelegationMetadata,
    DiscussionMessage,
    MessageNode,
    ProviderProfile,
    StageSummary,
    ToolTrace,
    utc_now,
)
from .web_research import CITATION_RULES, TOOLS, SourceNumbers, make_tool_executor

logger = logging.getLogger(__name__)


class ConversationStreamMixin:
    def _stream_agent_answer(
        self,
        *,
        job: ConversationJob,
        prompt: str,
        deep_think: bool,
        agents: list[AgentDefinition],
        providers: list[ProviderProfile],
        secrets: dict[str, str],
        agent_contexts: dict[str, str] | None,
        require_search: bool = False,
        search_query: str = "",
        search_context: str = "",
        preferred_agent: str | None = None,
        images: list[str] | None = None,
    ) -> Iterator[str]:
        """Run one tool-capable answer turn and translate its events into this API's SSE stream.

        The loop drives reasoning -> tool call -> tool result -> reasoning inside the same
        streamed turn. Every event emitted here comes from a provider stream or a tool that
        actually ran: no timers, no assumed search counts, and raw provider reasoning never
        reaches the browser — deep think still goes through the summarizer projection.
        """
        numbers = SourceNumbers()
        channel: queue.Queue[tuple[str, object]] = queue.Queue()

        def emit(trace: ToolTrace) -> None:
            channel.put(("trace", trace))

        agents_dicts = [agent.model_dump(mode="json") for agent in agents]
        providers_dicts = [provider.model_dump(mode="json") for provider in providers]
        summarizer_agent, summarizer_provider = (
            select_summarizer(agents_dicts, providers_dicts, secrets) if deep_think else (None, None)
        )
        summarizer_context = (
            str((agent_contexts or {}).get(str((summarizer_agent or {}).get("name") or ""), ""))
            if summarizer_agent
            else ""
        )

        stream = run_agent_stream(
            question=prompt,
            agents=agents_dicts,
            providers=providers_dicts,
            secrets=secrets,
            tools=TOOLS,
            execute=make_tool_executor(emit=emit, numbers=numbers),
            agent_contexts=agent_contexts,
            enable_thinking=deep_think,
            extra_policy=CITATION_RULES,
            preferred_agent=preferred_agent,
            require_search=require_search,
            search_query=search_query,
            search_context=search_context,
            should_cancel=lambda: job.cancel_requested,
            images=images,
        )

        def worker() -> None:
            async def pump() -> None:
                async for event in stream:
                    channel.put(("event", event))

            try:
                asyncio.run(pump())
            except Exception as exc:
                logger.exception("conversation_job.tool_loop_failed conversation_id=%s", job.conversation_id)
                channel.put(("error", exc))
            finally:
                channel.put(("done", None))

        threading.Thread(target=worker, daemon=True).start()

        yield self._sse("thinking_active", {"conversation_id": job.conversation_id})

        reasoning = ""
        stage_index = 0
        thinking_closed = False
        started = time.monotonic()

        def elapsed_ms() -> int:
            return max(1, int((time.monotonic() - started) * 1000))

        def project() -> Iterator[str]:
            """Hand one accumulated reasoning stretch to the projection writer, then forget it."""
            nonlocal reasoning, stage_index
            text, reasoning = reasoning.strip(), ""
            if summarizer_agent is None or summarizer_provider is None or len(text) < THINK_MIN_CHARS:
                return
            for event in thinking_projection_events(
                summarizer_agent, summarizer_provider, secrets, text, stage_index, summarizer_context
            ):
                yield event
            stage_index += 1

        def close_thinking() -> Iterator[str]:
            nonlocal thinking_closed
            if thinking_closed:
                return
            thinking_closed = True
            yield self._sse(
                "thinking_complete",
                {"conversation_id": job.conversation_id, "elapsed_ms": elapsed_ms()},
            )

        while True:
            try:
                kind, value = channel.get(timeout=600)
            except queue.Empty:
                yield from close_thinking()
                raise RuntimeError("Tool loop timed out") from None
            if kind == "done":
                break
            if kind == "error":
                yield from close_thinking()
                raise value  # type: ignore[misc]
            if kind == "trace":
                assert isinstance(value, ToolTrace)
                if not value.order:
                    value.order = job.next_order()
                job.partial_traces[value.id] = value
                yield self._sse("tool_trace", value.model_dump(mode="json"))
                continue
            assert isinstance(value, AgentEvent)
            if value.type == "reasoning_delta":
                if summarizer_agent is not None:
                    reasoning += str(value.data.get("text") or "")
                    if len(reasoning) >= THINK_CHUNK_SIZE:
                        yield from project()
                continue
            if value.type == "answer_delta":
                yield from project()
                yield from close_thinking()
                yield self._sse("final_delta", {"delta": str(value.data.get("text") or "")})
                continue
            if value.type == "answer_reset":
                yield self._sse(
                    "final_reset",
                    {"conversation_id": job.conversation_id, "reason": value.data.get("reason")},
                )
                continue
            if value.type in {
                "tool_call_started",
                "tool_call_completed",
                "tool_call_failed",
                "tool_call_skipped",
            }:
                yield from project()
                yield self._sse(
                    value.type,
                    {"conversation_id": job.conversation_id, "seq": value.seq, **value.data},
                )
                continue
            if value.type == "task_completed":
                yield from project()
                yield from close_thinking()
                yield self._sse(
                    "task_completed",
                    {
                        "conversation_id": job.conversation_id,
                        "source_count": numbers.count,
                        **value.data,
                    },
                )
                continue
            if value.type == "task_failed":
                yield from close_thinking()
                yield self._sse(
                    "error",
                    {
                        "conversation_id": job.conversation_id,
                        "message": str(value.data.get("error") or "tool loop failed"),
                    },
                )
                continue

        yield from close_thinking()

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
        elif sse_event.startswith("event: final_reset"):
            # The turn that narrated before calling a tool never became the answer.
            job.partial_body = ""
        elif sse_event.startswith("event: summary_complete"):
            try:
                summary = StageSummary.model_validate(json.loads(sse_event.split("data: ", 1)[1]))
                summary.order = job.next_order()
                job.partial_summaries.append(summary)
            except (json.JSONDecodeError, KeyError, IndexError, ValueError):
                pass
        elif sse_event.startswith("event: discussion_message"):
            try:
                job.partial_messages.append(
                    DiscussionMessage.model_validate(json.loads(sse_event.split("data: ", 1)[1]))
                )
            except (json.JSONDecodeError, KeyError, IndexError, ValueError):
                pass
        elif sse_event.startswith("event: tool_trace"):
            try:
                trace = ToolTrace.model_validate(json.loads(sse_event.split("data: ", 1)[1]))
                existing = job.partial_traces.get(trace.id)
                trace.order = existing.order if existing and existing.order else (trace.order or job.next_order())
                job.partial_traces[trace.id] = trace
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
        node.tool_traces = list(job.partial_traces.values())
        node.delegation = delegation
        node.error = None
        node.elapsed_ms = max(node.elapsed_ms, self._job_elapsed_ms(job))
        record.updated_at = utc_now()
        self.store.append(record)
        return node

    @staticmethod
    def _job_elapsed_ms(job: ConversationJob) -> int:
        return job.thinking_elapsed_ms or max(1, int((time.monotonic() - job.started_at) * 1000))

    def _sse(self, event: str, payload: dict) -> str:
        return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
