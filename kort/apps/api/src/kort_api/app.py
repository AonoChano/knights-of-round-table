from __future__ import annotations

from fastapi import FastAPI, HTTPException, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .agents import AgentLoader
from .config import settings
from .conversations import ConversationStore, VisibleConversationService
from .providers import ProviderStore
from .schemas import (
    AgentCreateRequest,
    AgentUpdateRequest,
    AgentView,
    ConversationListItem,
    ConversationRenameRequest,
    ConversationRequest,
    ConversationResponse,
    HealthResponse,
    ProviderConnectivityRequest,
    ProviderConnectivityResponse,
    ProviderProfile,
    ProviderProfileUpdate,
    ProviderSecretStatus,
    ProviderSecretUpdate,
)

app = FastAPI(title=settings.app_name)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

provider_store = ProviderStore(settings.providers_file, settings.secrets_file)
agent_loader = AgentLoader(settings.runtime_root)
conversation_service = VisibleConversationService(ConversationStore(settings.conversation_db))


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(app=settings.app_name)


@app.get("/api/providers", response_model=list[ProviderProfile])
def list_providers() -> list[ProviderProfile]:
    return provider_store.list_profiles()


@app.put("/api/providers/{provider_id}", response_model=ProviderProfile)
def upsert_provider(provider_id: str, payload: ProviderProfileUpdate) -> ProviderProfile:
    return provider_store.upsert(provider_id=provider_id, update=payload)


@app.post("/api/providers/{provider_id}/test", response_model=ProviderConnectivityResponse)
def test_provider(provider_id: str, payload: ProviderConnectivityRequest) -> ProviderConnectivityResponse:
    return provider_store.test_connectivity(provider_id=provider_id, request=payload)


@app.get("/api/provider-secrets", response_model=list[ProviderSecretStatus])
def list_provider_secret_statuses() -> list[ProviderSecretStatus]:
    return provider_store.list_secret_statuses()


@app.put("/api/providers/{provider_id}/secret", response_model=ProviderSecretStatus)
def save_provider_secret(provider_id: str, payload: ProviderSecretUpdate) -> ProviderSecretStatus:
    return provider_store.save_secret(provider_id=provider_id, update=payload)


@app.get("/api/agents", response_model=list[AgentView])
def list_agents() -> list[AgentView]:
    return agent_loader.list_agents()


@app.post("/api/agents", response_model=AgentView, status_code=201)
def create_agent(payload: AgentCreateRequest) -> AgentView:
    try:
        return agent_loader.create_agent(payload)
    except FileExistsError:
        raise HTTPException(status_code=409, detail=f"Agent '{payload.name}' already exists")


@app.put("/api/agents/{name}", response_model=AgentView)
def update_agent(name: str, payload: AgentUpdateRequest) -> AgentView:
    result, reason = agent_loader.update_agent(name, payload)
    if reason == "system_protected":
        raise HTTPException(status_code=403, detail=f"Agent '{name}' is a system agent and cannot be updated")
    if result is None:
        raise HTTPException(status_code=404, detail=f"Agent '{name}' not found")
    return result


@app.delete("/api/agents/{name}")
def delete_agent(name: str) -> Response:
    ok, reason = agent_loader.delete_agent(name)
    if reason == "system_protected":
        raise HTTPException(status_code=403, detail=f"Agent '{name}' is a system agent and cannot be deleted")
    if not ok:
        raise HTTPException(status_code=404, detail=f"Agent '{name}' not found")
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@app.get("/api/skills", response_model=list[str])
def list_skills() -> list[str]:
    return agent_loader.list_global_skills()


@app.get("/api/conversations", response_model=list[ConversationListItem])
def list_conversations() -> list[ConversationListItem]:
    return conversation_service.list_conversations()


@app.get("/api/conversations/{conversation_id}/stream")
def stream_existing_conversation(conversation_id: str) -> StreamingResponse:
    events = conversation_service.stream_existing_job(conversation_id)
    if events is None:
        raise HTTPException(status_code=404, detail="Running conversation not found")
    return StreamingResponse(
        events,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@app.get("/api/conversations/{conversation_id}", response_model=ConversationResponse)
def get_conversation(conversation_id: str) -> ConversationResponse:
    result = conversation_service.get_conversation(conversation_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return result


@app.patch("/api/conversations/{conversation_id}", response_model=ConversationListItem)
def rename_conversation(conversation_id: str, payload: ConversationRenameRequest) -> ConversationListItem:
    result = conversation_service.rename_conversation(conversation_id, payload.title)
    if result is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return result


@app.delete("/api/conversations/{conversation_id}")
def delete_conversation(conversation_id: str) -> dict:
    ok = conversation_service.delete_conversation(conversation_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return {"ok": True}


@app.post("/api/conversations/stream")
def stream_conversation(payload: ConversationRequest) -> StreamingResponse:
    expert_count = len(agent_loader.list_agents())
    events = conversation_service.stream_conversation(
        payload,
        expert_count=expert_count,
        agents=agent_loader.list_definitions(),
        providers=provider_store.list_profiles(),
        secrets=provider_store.read_secrets(),
    )
    return StreamingResponse(
        events,
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )
