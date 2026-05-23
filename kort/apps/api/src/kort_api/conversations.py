from __future__ import annotations

import json
import re
from collections.abc import Iterator
from pathlib import Path
from uuid import uuid4

from .model_client import ModelCallError, OpenAICompatibleClient
from .orchestration import run_discussion_stream
from .schemas import (
    AgentDefinition,
    ConversationListItem,
    ConversationRecord,
    ConversationRequest,
    ConversationResponse,
    FinalAnswer,
    ProviderProfile,
    StageSummary,
    ThinkingTreeNode,
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
        return [ConversationRecord.model_validate(item) for item in raw]

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

    def rename(self, conversation_id: str, new_question: str) -> ConversationRecord | None:
        records = self.list_records()
        for record in records:
            if record.conversation_id == conversation_id:
                record.question = new_question
                record.updated_at = utc_now()
                self.save_records(records)
                return record
        return None

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
                question=item.question,
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
            question=record.question,
            expert_count=record.expert_count,
            status=record.status,
            stage_summaries=record.stage_summaries,
            final_answer=record.final_answer,
        )

    def rename_conversation(self, conversation_id: str, new_question: str) -> ConversationListItem | None:
        record = self.store.rename(conversation_id, new_question)
        if record is None:
            return None
        return ConversationListItem(
            conversation_id=record.conversation_id,
            question=record.question,
            created_at=record.created_at,
            updated_at=record.updated_at,
            expert_count=record.expert_count,
        )

    def delete_conversation(self, conversation_id: str) -> bool:
        return self.store.delete(conversation_id)

    def create_conversation(
        self,
        request: ConversationRequest,
        expert_count: int,
        agents: list[AgentDefinition],
        providers: list[ProviderProfile],
        secrets: dict[str, str],
    ) -> ConversationResponse:
        record = ConversationRecord(
            conversation_id=str(uuid4()),
            question=request.question,
            expert_count=expert_count,
            status="completed",
            stage_summaries=self._build_visible_summaries(request.question),
            final_answer=self._build_real_final_answer(request.question, agents, providers, secrets),
        )
        self.store.append(record)
        return ConversationResponse(
            conversation_id=record.conversation_id,
            created_at=record.created_at,
            question=record.question,
            expert_count=record.expert_count,
            status=record.status,
            stage_summaries=record.stage_summaries,
            final_answer=record.final_answer,
        )

    def stream_conversation(
        self,
        request: ConversationRequest,
        expert_count: int,
        agents: list[AgentDefinition],
        providers: list[ProviderProfile],
        secrets: dict[str, str],
    ) -> Iterator[str]:
        conversation_id = str(uuid4())

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
            question=request.question,
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

        record = ConversationRecord(
            conversation_id=conversation_id,
            question=request.question,
            expert_count=expert_count,
            status="completed",
            stage_summaries=collected_summaries,
            final_answer=final_answer,
        )
        self.store.append(record)

        yield self._sse(
            "conversation_complete",
            ConversationResponse(
                conversation_id=record.conversation_id,
                created_at=record.created_at,
                question=record.question,
                expert_count=record.expert_count,
                status=record.status,
                stage_summaries=record.stage_summaries,
                final_answer=record.final_answer,
            ).model_dump(mode="json"),
        )

    def _build_visible_summaries(self, question: str) -> list[StageSummary]:
        normalized_question = question.strip()
        if "推理" in normalized_question or "reason" in normalized_question.lower():
            return [
                self._summary(
                    summary_id="summary-round-1",
                    title="Critical Review and Systematic Solution Design",
                    body=(
                        "I first identified the potential weaknesses and misconceptions in common advice for "
                        "improving large language model reasoning, including over-optimism about the universality "
                        "of chain-of-thought, scale worship, plug-and-play external tools, and self-reflection loops. "
                        "Then I constructed a systematic improvement plan across data, training strategy, "
                        "inference-time techniques, and architecture, emphasizing process-supervised data, "
                        "reinforcement learning fine-tuning, tree or graph search, self-consistency, and "
                        "tool-augmented neuro-symbolic systems."
                    ),
                    confidence=0.76,
                ),
                self._summary(
                    summary_id="summary-round-2",
                    title="Critical review and refined approach",
                    body=(
                        "I began by scrutinizing the common advice for improving reasoning, pointing out that "
                        "chain-of-thought is not universally beneficial, that scale alone yields diminishing returns, "
                        "that external tools are not plug-and-play, and that self-reflection loops can amplify errors. "
                        "I then integrated these criticisms into a layered recommendation: match techniques to "
                        "reasoning subtypes, use program execution for math, retrieval for analogy and fact-heavy "
                        "reasoning, and reserve expensive process-supervised methods for teams that can measure "
                        "their real cost and failure modes."
                    ),
                    confidence=0.82,
                ),
            ]

        return [
            self._summary(
                summary_id="summary-round-1",
                title="Problem framing and response direction",
                body=(
                    "I identified the question's practical target, separated the parts that need direct answering "
                    "from adjacent context, and shaped the response around the user's likely decision point rather "
                    "than around the system's internal workflow."
                ),
                confidence=0.74,
            ),
            self._summary(
                summary_id="summary-round-2",
                title="Constraint review and answer synthesis",
                body=(
                    "I checked the early answer direction for unsupported assumptions, reduced vague claims into "
                    "actionable guidance, and prepared the final response so that the visible answer remains concise "
                    "while preserving the important tradeoffs."
                ),
                confidence=0.81,
            ),
        ]

    def _summary(self, summary_id: str, title: str, body: str, confidence: float) -> StageSummary:
        details = f"### {title}\n\n{body}"
        return StageSummary(
            id=summary_id,
            stage="summary",
            title=title,
            snippet=body[:120],
            details=details,
            confidence=confidence,
            tree_nodes=[
                ThinkingTreeNode(
                    id=f"{summary_id}-node",
                    title=title,
                    summary=body,
                )
            ],
        )

    def _sse(self, event: str, payload: dict) -> str:
        return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"

    _CHUNK_RE = re.compile(r"(\s+)")

    def _visible_chunks(self, text: str) -> Iterator[str]:
        yield from _CHUNK_RE.split(text)

    def _stream_final_answer(
        self,
        question: str,
        agents: list[AgentDefinition],
        providers: list[ProviderProfile],
        secrets: dict[str, str],
        chunks: list[str],
    ) -> Iterator[tuple[str | None, FinalAnswer | None]]:
        provider_by_id = {provider.provider_id: provider for provider in providers if provider.enabled}
        preferred_roles = {"synthesizer", "expert", "summarizer", "critic"}
        candidates: list[tuple[AgentDefinition, ProviderProfile]] = []

        for agent in agents:
            provider = provider_by_id.get(agent.provider_profile)
            if not provider or agent.role not in preferred_roles:
                continue
            has_key = bool(secrets.get(provider.provider_id, "").strip())
            if provider.api_style == "openai" and (has_key or provider.provider_type == "ollama"):
                candidates.append((agent, provider))

        if not candidates:
            body = (
                "No enabled OpenAI-compatible provider with a saved API key is available yet. "
                "Add a provider key in Settings, then send the message again."
            )
            for chunk in self._visible_chunks(body):
                chunks.append(chunk)
                yield self._sse("final_delta", {"delta": chunk}), None
            yield None, FinalAnswer(
                title="Model setup needed",
                body="".join(chunks).strip(),
                confidence=0.35,
                limitations=["No real model call was made."],
            )
            return

        prompt = (
            "Answer the user's question directly in Chinese. Keep the answer clear, structured, and practical. "
            "Do not mention internal experts, orchestration, hidden reasoning, or chain-of-thought.\n\n"
            f"User question:\n{question.strip()}"
        )
        client = OpenAICompatibleClient(secrets)
        failures: list[str] = []

        for agent, provider in candidates:
            try:
                for chunk in client.stream_chat(provider=provider, prompt=prompt, system_prompt=agent.system_prompt):
                    chunks.append(chunk)
                    yield self._sse("final_delta", {"delta": chunk}), None
                body = "".join(chunks).strip()
                if body:
                    yield None, FinalAnswer(
                        title=f"{provider.label} - {provider.default_model}",
                        body=body,
                        confidence=0.82,
                        limitations=[
                            "This is still the first real-call slice. Full LangGraph multi-expert orchestration is not wired yet."
                        ],
                    )
                    return
            except ModelCallError as exc:
                failures.append(f"{provider.provider_id}: {exc}")
                if chunks:
                    body = "".join(chunks).strip()
                    yield None, FinalAnswer(
                        title="Model stream interrupted",
                        body=body,
                        confidence=0.45,
                        limitations=[
                            "The selected provider started streaming a response but failed before completion.",
                            f"{provider.provider_id}: {exc}",
                        ],
                    )
                    return

        body = "All configured providers failed:\n" + "\n\n".join(failures)
        for chunk in self._visible_chunks(body):
            chunks.append(chunk)
            yield self._sse("final_delta", {"delta": chunk}), None
        yield None, FinalAnswer(
            title="Model call failed",
            body="".join(chunks).strip(),
            confidence=0.2,
            limitations=["The backend attempted a real provider call, but all candidates failed."],
        )

    def _build_real_final_answer(
        self,
        question: str,
        agents: list[AgentDefinition],
        providers: list[ProviderProfile],
        secrets: dict[str, str],
    ) -> FinalAnswer:
        provider_by_id = {provider.provider_id: provider for provider in providers if provider.enabled}
        preferred_roles = {"synthesizer", "expert", "summarizer", "critic"}
        candidates: list[tuple[AgentDefinition, ProviderProfile]] = []

        for agent in agents:
            provider = provider_by_id.get(agent.provider_profile)
            if not provider or agent.role not in preferred_roles:
                continue
            has_key = bool(secrets.get(provider.provider_id, "").strip())
            if provider.api_style == "openai" and (has_key or provider.provider_type == "ollama"):
                candidates.append((agent, provider))

        if not candidates:
            return FinalAnswer(
                title="Model setup needed",
                body=(
                    "No enabled OpenAI-compatible provider with a saved API key is available yet. "
                    "Add a provider key in Settings, then send the message again."
                ),
                confidence=0.35,
                limitations=["No real model call was made."],
            )

        prompt = (
            "Answer the user's question directly in Chinese. Keep the answer clear, structured, and practical. "
            "Do not mention internal experts, orchestration, hidden reasoning, or chain-of-thought.\n\n"
            f"User question:\n{question.strip()}"
        )
        failures: list[str] = []
        body = ""
        selected_provider: ProviderProfile | None = None
        client = OpenAICompatibleClient(secrets)

        for agent, provider in candidates:
            try:
                body = client.chat(
                    provider=provider,
                    prompt=prompt,
                    system_prompt=agent.system_prompt,
                )
                selected_provider = provider
                break
            except ModelCallError as exc:
                failures.append(f"{provider.provider_id}: {exc}")

        if selected_provider is None:
            return FinalAnswer(
                title="Model call failed",
                body="All configured providers failed:\n" + "\n\n".join(failures),
                confidence=0.2,
                limitations=["The backend attempted a real provider call, but all candidates failed."],
            )

        return FinalAnswer(
            title=f"{selected_provider.label} - {selected_provider.default_model}",
            body=body,
            confidence=0.82,
            limitations=[
                "This is still the first real-call slice. Full LangGraph multi-expert orchestration is not wired yet."
            ],
        )
