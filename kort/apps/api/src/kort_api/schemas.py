from __future__ import annotations

from datetime import datetime, timezone
from enum import Enum
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


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
    allowed_global_skills: list[str]
    disabled_global_skills: list[str]
    private_skill_count: int
    priority: int = 0


class ThinkingTreeNode(BaseModel):
    id: str
    title: str
    summary: str


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


class ConversationRequest(BaseModel):
    question: str = Field(min_length=1, max_length=4000)
    level: str = Field(default="auto", pattern=r"^(off|auto|low|medium|high)$")


class ConversationRenameRequest(BaseModel):
    question: str = Field(min_length=1, max_length=200)


class ConversationResponse(BaseModel):
    conversation_id: str
    created_at: datetime
    question: str
    expert_count: int
    status: Literal["completed"]
    stage_summaries: list[StageSummary]
    final_answer: FinalAnswer


class ConversationListItem(BaseModel):
    conversation_id: str
    question: str
    created_at: datetime
    updated_at: datetime
    expert_count: int


class ConversationRecord(BaseModel):
    conversation_id: str
    created_at: datetime = Field(default_factory=utc_now)
    updated_at: datetime = Field(default_factory=utc_now)
    question: str
    expert_count: int
    status: Literal["completed"]
    stage_summaries: list[StageSummary]
    final_answer: FinalAnswer


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    app: str
