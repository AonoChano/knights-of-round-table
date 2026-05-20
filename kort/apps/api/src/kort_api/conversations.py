from __future__ import annotations

from pathlib import Path
from uuid import uuid4

from .model_client import ModelCallError, OpenAICompatibleClient
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
)
from .storage import read_json, write_json


class ConversationStore:
    def __init__(self, path: Path) -> None:
        self.path = path

    def list_records(self) -> list[ConversationRecord]:
        raw = read_json(self.path, default=[])
        return [ConversationRecord.model_validate(item) for item in raw]

    def save_records(self, records: list[ConversationRecord]) -> None:
        write_json(self.path, [record.model_dump(mode="json") for record in records])

    def append(self, record: ConversationRecord) -> None:
        records = self.list_records()
        records.insert(0, record)
        self.save_records(records)


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

    def _build_visible_summaries(self, question: str) -> list[StageSummary]:
        focus = question.strip().replace("\n", " ")
        return [
            StageSummary(
                id="stage-initial",
                stage="initial-analysis",
                title="理解问题",
                snippet=f"我正在确认问题边界：{focus[:80]}",
                details="我先把问题拆成可回答的目标、隐含约束和需要避免的误区。",
                confidence=0.74,
                tree_nodes=[
                    ThinkingTreeNode(id="initial-1", title="拆解目标", summary="我把问题转换成几个可回答的子问题。"),
                    ThinkingTreeNode(id="initial-2", title="检查假设", summary="我检查哪些前提会影响答案可靠性。"),
                ],
            ),
            StageSummary(
                id="stage-critique",
                stage="critique",
                title="检查薄弱点",
                snippet="我正在寻找可能过度概括、证据不足或遗漏限制的地方。",
                details="我会避免把听起来合理但未经支撑的说法直接写进最终答案。",
                confidence=0.7,
                tree_nodes=[
                    ThinkingTreeNode(id="critique-1", title="查找缺口", summary="我检查回答是否有明显证据缺口。"),
                    ThinkingTreeNode(id="critique-2", title="压缩歧义", summary="我把宽泛判断改成更具体的建议。"),
                ],
            ),
            StageSummary(
                id="stage-convergence",
                stage="convergence",
                title="形成答案",
                snippet="我正在把保留下来的判断组织成清晰、可直接使用的回答。",
                details="我会把结论、理由和限制分清楚，只输出用户需要看到的正文。",
                confidence=0.81,
                tree_nodes=[
                    ThinkingTreeNode(id="converge-1", title="保留稳健结论", summary="我只保留经过检查后仍成立的建议。"),
                    ThinkingTreeNode(id="converge-2", title="组织表达", summary="我把最终回答整理成易读结构。"),
                ],
            ),
        ]

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
                title="还不能发起真实模型调用",
                body=(
                    "没有找到已保存 API Key 且兼容 OpenAI Chat Completions 的启用模型。"
                    "请在设置里为 DeepSeek/OpenAI 这类 provider 保存 API Key 后再发送。"
                ),
                confidence=0.35,
                limitations=["没有调用真实模型。"],
            )

        prompt = (
            "请直接回答用户问题。要求：中文、结构清晰、实用；不要提及内部专家讨论；"
            "不要输出隐藏思考过程。\n\n用户问题：\n"
            f"{question.strip()}"
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
                title="真实模型调用失败",
                body="所有已配置 provider 都调用失败：\n" + "\n\n".join(failures),
                confidence=0.2,
                limitations=["这不是模拟答案；后端已尝试调用真实模型，但 provider 返回失败。"],
            )

        return FinalAnswer(
            title=f"{selected_provider.label} · {selected_provider.default_model}",
            body=body,
            confidence=0.82,
            limitations=["当前是首个真实调用切片：先调用一个已配置模型，完整 LangGraph 多专家流程还未接入。"],
        )
