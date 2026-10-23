from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, model_validator


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


CANCELLED_ROUND_LIMITATION = "Conversation was paused by the user."


class ProviderType(str, Enum):
    openai = "openai"
    anthropic = "anthropic"
    deepseek = "deepseek"
    bigmodel = "bigmodel"
    kimi = "kimi"
    minimax = "minimax"
    ollama = "ollama"
    bailian = "bailian"
    qianwen = "qianwen"
    xiaomi = "xiaomi"
    openrouter = "openrouter"
    custom = "custom"


BillingType = Literal["pay_as_you_go", "token_plan", "coding_plan", "local", "custom"]
ValidateStatus = Literal[
    "valid",
    "invalid_base_url",
    "missing_key",
    "unauthorized",
    "unreachable",
    "not_found",
    "rejected",
    "error",
]


class ManagedModel(BaseModel):
    """One model a user added under a provider slot."""

    model_config = ConfigDict(extra="forbid")

    id: str
    label: str = ""
    enabled: bool = True
    capabilities: list[str] = Field(default_factory=list)


class ProviderProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")

    provider_id: str = Field(pattern=r"^[a-z0-9-]+$")
    label: str
    provider_type: ProviderType
    base_url: str
    api_style: str
    default_model: str
    env_key_name: str
    enabled: bool = True
    capabilities: list[str] = Field(default_factory=list)
    catalog_id: str = ""
    billing_type: BillingType = "pay_as_you_go"
    models: list[ManagedModel] = Field(default_factory=list)


class ProviderProfileUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    label: str
    provider_type: ProviderType
    base_url: str
    api_style: str
    default_model: str
    env_key_name: str
    enabled: bool = True
    capabilities: list[str] = Field(default_factory=list)
    catalog_id: str = ""
    billing_type: BillingType = "pay_as_you_go"
    models: list[ManagedModel] = Field(default_factory=list)


class ProviderValidateRequest(BaseModel):
    """Pre-save probe: the profile is not persisted yet, so it carries its own fields."""

    model_config = ConfigDict(extra="forbid")

    base_url: str
    api_style: str = "openai"
    provider_type: ProviderType = ProviderType.custom
    api_key: str | None = Field(default=None, max_length=4096)
    provider_id: str | None = Field(default=None, pattern=r"^[a-z0-9-]+$")
    env_key_name: str = ""
    models: list[str] = Field(default_factory=list)


class ProviderValidateResponse(BaseModel):
    ok: bool
    status: ValidateStatus
    message: str
    discovered_models: list[str] = Field(default_factory=list)
    missing_models: list[str] = Field(default_factory=list)
    latency_ms: int = 0


class ProviderSecretUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    api_key: str = Field(min_length=1, max_length=4096)


class ProviderSecretStatus(BaseModel):
    """`configured` is the locally saved key; `env_configured` is the fallback the runtime can use."""

    provider_id: str
    configured: bool
    env_configured: bool = False


class AgentDefinition(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(pattern=r"^[a-z][a-z0-9-]*$")
    nickname: str
    role: Literal["expert", "critic", "summarizer", "synthesizer"] = "expert"
    provider_profile: str
    model: str
    system_prompt: str
    allowed_global_skills: list[str] = Field(default_factory=list)
    disabled_global_skills: list[str] = Field(default_factory=list)
    priority: int = Field(default=0, ge=0, le=100)


class AgentCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(pattern=r"^[a-z][a-z0-9-]*$")
    nickname: str
    role: Literal["expert", "critic", "summarizer", "synthesizer"] = "expert"
    provider_profile: str
    model: str
    system_prompt: str
    allowed_global_skills: list[str] = Field(default_factory=list)
    disabled_global_skills: list[str] = Field(default_factory=list)
    priority: int = Field(default=0, ge=0, le=100)


class AgentUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    nickname: str | None = None
    role: Literal["expert", "critic", "summarizer", "synthesizer"] | None = None
    provider_profile: str | None = None
    model: str | None = None
    system_prompt: str | None = None
    allowed_global_skills: list[str] | None = None
    disabled_global_skills: list[str] | None = None
    priority: int | None = None


class AgentView(BaseModel):
    name: str
    nickname: str
    role: str
    provider_profile: str
    model: str
    system_prompt: str
    allowed_global_skills: list[str]
    disabled_global_skills: list[str]
    private_skill_count: int
    priority: int = 0


class ThinkingTreeNode(BaseModel):
    id: str
    title: str
    summary: str
    parent_id: str | None = None
    status: Literal["active", "complete", "done", "cancelled"] = "complete"
    children: list[ThinkingTreeNode] = Field(default_factory=list)


class StageSummary(BaseModel):
    id: str
    stage: str
    title: str
    snippet: str
    details: str
    confidence: float = Field(ge=0.0, le=1.0)
    tree_nodes: list[ThinkingTreeNode] = Field(default_factory=list)


class FinalAnswer(BaseModel):
    title: str
    body: str
    confidence: float = Field(ge=0.0, le=1.0)
    limitations: list[str] = Field(default_factory=list)


class DelegatedAgent(BaseModel):
    name: str
    nickname: str
    role: str
    provider_profile: str
    model: str


class DelegationMetadata(BaseModel):
    route_kind: Literal["direct", "solo_thinking", "panel"]
    reason_code: str
    discussion_level: str
    deep_think: bool
    participant_count: int
    max_rounds: int = 0
    agents: list[DelegatedAgent] = Field(default_factory=list)
    # Early stop metadata
    actual_rounds: int = 0
    early_stop: bool = False
    early_stop_reason: str | None = None
    convergence_score: float | None = None


class DiscussionMessage(BaseModel):
    id: str
    round: int
    speaker: str
    nickname: str
    role: str
    text: str


class ToolSource(BaseModel):
    """One page a web tool surfaced: search hit or fetched document."""

    title: str
    url: str
    domain: str = ""
    snippet: str = ""


class ToolTrace(BaseModel):
    """A single visible tool call, streamed while it runs and persisted with the node."""

    id: str
    tool: Literal["search", "fetch"]
    status: Literal["running", "complete", "error"] = "running"
    query: str = ""
    url: str = ""
    title: str = ""
    error: str | None = None
    duration_ms: int = Field(default=0, ge=0)
    sources: list[ToolSource] = Field(default_factory=list)
    excerpt: str = ""
    source_count: int = Field(default=0, ge=0)


class ConversationRequest(BaseModel):
    """Routing inputs for one generation; built server-side from the branch being answered."""

    question: str = Field(min_length=1, max_length=4000)
    level: str = Field(default="auto", pattern=r"^(off|auto|low|medium|high)$")
    conversation_id: str | None = Field(default=None)
    deep_think: bool = False
    custom_max_rounds: int | None = Field(default=None, ge=1, le=12)


class BranchRequest(BaseModel):
    """One createBranch(parentNode, message) call: send, edit, or retry."""

    model_config = ConfigDict(extra="forbid")

    parent_id: str | None = None
    role: Literal["user", "assistant"]
    content: str = ""
    level: str = Field(default="auto", pattern=r"^(off|auto|low|medium|high)$")
    deep_think: bool = False
    custom_max_rounds: int | None = Field(default=None, ge=1, le=12)
    web_search: bool = False

    @model_validator(mode="after")
    def content_matches_role(self) -> "BranchRequest":
        if self.role == "user" and not self.content.strip():
            raise ValueError("a user branch needs content")
        if self.role == "assistant" and self.content.strip():
            raise ValueError("an assistant branch is generated, not supplied")
        return self


class ActivePathRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    node_id: str


class ConversationRenameRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)


class MessageNode(BaseModel):
    node_id: str
    parent_id: str | None = None
    role: Literal["user", "assistant"]
    content: str = ""
    status: Literal["streaming", "complete", "error", "cancelled"] = "complete"
    error: str | None = None
    elapsed_ms: int = Field(default=0, ge=0)
    created_at: datetime = Field(default_factory=utc_now)
    stage_summaries: list[StageSummary] = Field(default_factory=list)
    delegation: DelegationMetadata | None = None
    discussion_messages: list[DiscussionMessage] = Field(default_factory=list)
    tool_traces: list[ToolTrace] = Field(default_factory=list)
    active_child_id: str | None = None


class MessageNodeView(MessageNode):
    """Wire shape: children are derived from parent_id so storage has one source of truth."""

    children: list[str] = Field(default_factory=list)


class ConversationResponse(BaseModel):
    conversation_id: str
    created_at: datetime
    updated_at: datetime
    title: str
    expert_count: int
    nodes: list[MessageNodeView] = Field(default_factory=list)
    active_root_id: str | None = None
    active_path: list[str] = Field(default_factory=list)


class ConversationListItem(BaseModel):
    conversation_id: str
    title: str
    created_at: datetime
    updated_at: datetime
    expert_count: int


class DeveloperRuntimeResponse(BaseModel):
    app_env: str
    api_base_url: str = ""
    conversation_store_path: str
    conversation_count: int
    jobs_total: int
    jobs_running: int
    log_level: Literal["ERROR", "INFO", "DEBUG"]


class LogLevelUpdate(BaseModel):
    level: Literal["ERROR", "INFO", "DEBUG"]


class LogLevelResponse(BaseModel):
    level: Literal["ERROR", "INFO", "DEBUG"]


class ConversationRecord(BaseModel):
    conversation_id: str
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    title: str
    expert_count: int
    nodes: list[MessageNode] = Field(default_factory=list)
    active_root_id: str | None = None

    @model_validator(mode="before")
    @classmethod
    def upgrade_legacy_rounds(cls, data: object) -> object:
        """Fold pre-tree stored conversations into a single linear branch."""
        if not isinstance(data, dict) or data.get("nodes") or not data.get("rounds"):
            return data
        nodes: list[dict] = []
        root_id: str | None = None
        previous_id: str | None = None
        for round_item in data["rounds"]:
            if not isinstance(round_item, dict):
                continue
            base = str(round_item.get("round_id") or uuid4())
            user_id, assistant_id = f"{base}-user", f"{base}-assistant"
            limitation = (round_item.get("final_answer") or {}).get("limitations") or []
            cancelled = round_item.get("status") == "cancelled" or CANCELLED_ROUND_LIMITATION in limitation
            if previous_id is not None:
                for node in nodes:
                    if node["node_id"] == previous_id:
                        node["active_child_id"] = user_id
            else:
                root_id = user_id
            nodes.append(
                {
                    "node_id": user_id,
                    "parent_id": previous_id,
                    "role": "user",
                    "content": str(round_item.get("question") or ""),
                    "status": "complete",
                    "created_at": round_item.get("created_at") or utc_now(),
                    "active_child_id": assistant_id,
                }
            )
            nodes.append(
                {
                    "node_id": assistant_id,
                    "parent_id": user_id,
                    "role": "assistant",
                    "content": str((round_item.get("final_answer") or {}).get("body") or ""),
                    "status": "cancelled" if cancelled else "complete",
                    "created_at": round_item.get("created_at") or utc_now(),
                    "stage_summaries": round_item.get("stage_summaries") or [],
                    "delegation": round_item.get("delegation"),
                    "discussion_messages": round_item.get("discussion_messages") or [],
                }
            )
            previous_id = assistant_id
        upgraded = {key: value for key, value in data.items() if key != "rounds"}
        upgraded["nodes"] = nodes
        upgraded["active_root_id"] = root_id
        return upgraded


class MemoryFactView(BaseModel):
    id: str
    scope: Literal["private", "shared"]
    text: str
    tags: list[str] = Field(default_factory=list)
    confidence: float
    importance: float
    pinned: bool = False
    source: str = ""
    status: str = "active"
    promoted_to: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class MemoryRememberRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=2, max_length=600)
    tags: list[str] = Field(default_factory=list, max_length=8)
    scope: Literal["private", "shared"] = "private"
    pinned: bool = False
    confidence: float = Field(default=0.85, ge=0.0, le=1.0)
    importance: float = Field(default=0.65, ge=0.0, le=1.0)


class MemoryFactUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str | None = Field(default=None, min_length=2, max_length=600)
    pinned: bool | None = None
    importance: float | None = Field(default=None, ge=0.0, le=1.0)
    confidence: float | None = Field(default=None, ge=0.0, le=1.0)
    status: Literal["active", "archived"] | None = None


class MemoryDreamRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    apply: bool = False
    provider_id: str | None = None


class MemoryDreamResponse(BaseModel):
    agent: str
    applied: bool
    journal: str = ""
    stats: dict[str, int] = Field(default_factory=dict)
    added_facts: list[str] = Field(default_factory=list)
    added_hunches: list[str] = Field(default_factory=list)
    shared_promotions: list[str] = Field(default_factory=list)
    rejected: list[str] = Field(default_factory=list)
    self_narrative: str = ""
    proposal: dict | None = None


class MemoryStatusResponse(BaseModel):
    agent: str
    fact_count: int
    shared_fact_count: int
    episode_count: int
    hunch_count: int
    pending_episodes: int
    last_dream_at: datetime | None = None
    self_narrative: str = ""
    preview: str = ""
    budget_tokens: int
    auto_dream: bool = True
    dream_min_episodes: int = 6
    dream_min_hours: int = 24


class MemoryHunchView(BaseModel):
    id: str
    text: str
    confidence: float
    tags: list[str] = Field(default_factory=list)
    status: str = "active"
    created_at: datetime | None = None
    updated_at: datetime | None = None


class MemoryEpisodeView(BaseModel):
    id: str
    question: str
    answer_gist: str = ""
    summaries: list[str] = Field(default_factory=list)
    participants: list[str] = Field(default_factory=list)
    importance: float = 0.5
    created_at: datetime | None = None


class MemoryDreamView(BaseModel):
    id: str
    created_at: datetime | None = None
    journal: str = ""
    stats: dict[str, int] = Field(default_factory=dict)


class MemoryDetailResponse(BaseModel):
    agent: str
    self_narrative: str = ""
    private_facts: list[MemoryFactView] = Field(default_factory=list)
    shared_facts: list[MemoryFactView] = Field(default_factory=list)
    hunches: list[MemoryHunchView] = Field(default_factory=list)
    episodes: list[MemoryEpisodeView] = Field(default_factory=list)
    dreams: list[MemoryDreamView] = Field(default_factory=list)
    status: MemoryStatusResponse


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    app: str
