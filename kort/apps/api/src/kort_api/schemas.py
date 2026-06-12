from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Literal

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
    custom = "custom"


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


class ProviderConnectivityRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    api_key: str | None = Field(default=None, max_length=4096)


class ProviderConnectivityResponse(BaseModel):
    provider_id: str
    ok: bool
    status: Literal["ready", "disabled", "missing_key", "invalid_base_url", "not_found"]
    message: str


class ProviderSecretUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    api_key: str = Field(min_length=1, max_length=4096)


class ProviderSecretStatus(BaseModel):
    provider_id: str
    configured: bool


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


class ConversationRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    level: str = Field(default="auto", pattern=r"^(off|auto|low|medium|high)$")
    conversation_id: str | None = Field(default=None)
    deep_think: bool = False


class ConversationRenameRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)


class ConversationRound(BaseModel):
    round_id: str
    created_at: datetime = Field(default_factory=utc_now)
    question: str
    stage_summaries: list[StageSummary]
    final_answer: FinalAnswer
    delegation: DelegationMetadata | None = None
    status: Literal["complete", "cancelled"] = "complete"

    @model_validator(mode="after")
    def infer_cancelled_status_from_legacy_limitation(self) -> "ConversationRound":
        if CANCELLED_ROUND_LIMITATION in self.final_answer.limitations:
            self.status = "cancelled"
        return self


class ConversationResponse(BaseModel):
    conversation_id: str
    created_at: datetime
    updated_at: datetime
    title: str
    expert_count: int
    rounds: list[ConversationRound]


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
    rounds: list[ConversationRound] = Field(default_factory=list)


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    app: str
