from __future__ import annotations

import logging
import time

from fastapi import FastAPI, HTTPException, Query, Request, Response, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from .agents import AgentLoader
from .config import settings
from .conversations import ConversationStore, VisibleConversationService
from .memory import MemoryStore
from .model_client import ModelCallError
from .probe import probe_upstream
from .providers import ProviderStore, provider_is_reachable
from .schemas import (
    ActivePathRequest,
    AgentCreateRequest,
    AgentDefinition,
    AgentUpdateRequest,
    AgentView,
    BranchRequest,
    ConversationListItem,
    ConversationRenameRequest,
    ConversationResponse,
    ConversationSearchResponse,
    DeveloperRuntimeResponse,
    HealthResponse,
    LogLevelResponse,
    LogLevelUpdate,
    MemoryDreamRequest,
    MemoryDreamResponse,
    MemoryDetailResponse,
    MemoryFactUpdateRequest,
    MemoryFactView,
    MemoryRememberRequest,
    MemoryStatusResponse,
    ProviderProfile,
    ProviderProfileUpdate,
    ProviderSecretStatus,
    ProviderSecretUpdate,
    ProviderValidateRequest,
    ProviderValidateResponse,
)

LOG_LEVELS = {
    "ERROR": logging.ERROR,
    "INFO": logging.INFO,
    "DEBUG": logging.DEBUG,
}


def _normalize_log_level(level: str) -> str:
    upper = level.upper()
    return upper if upper in LOG_LEVELS else "INFO"


def _set_log_level(level: str) -> str:
    normalized = _normalize_log_level(level)
    logging.getLogger().setLevel(LOG_LEVELS[normalized])
    for logger_name in ("kort_api", "uvicorn.error", "uvicorn.access"):
        logging.getLogger(logger_name).setLevel(LOG_LEVELS[normalized])
    return normalized


logging.basicConfig(
    level=LOG_LEVELS[_normalize_log_level(settings.log_level)],
    format="%(asctime)s %(levelname)s %(name)s %(message)s",
)
logger = logging.getLogger("kort_api.app")
current_log_level = _set_log_level(settings.log_level)

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
memory_store = MemoryStore(
    settings.runtime_root,
    budget_tokens=settings.memory_budget_tokens,
    auto_dream=settings.memory_auto_dream,
    dream_min_episodes=settings.memory_dream_min_episodes,
    dream_min_hours=settings.memory_dream_min_hours,
)
conversation_service = VisibleConversationService(
    ConversationStore(settings.conversation_db),
    memory_store,
)


@app.middleware("http")
async def log_request_metadata(request: Request, call_next):
    started = time.perf_counter()
    logger.debug("request.start method=%s path=%s", request.method, request.url.path)
    try:
        response = await call_next(request)
    except Exception:
        duration_ms = (time.perf_counter() - started) * 1000
        logger.exception(
            "request.error method=%s path=%s duration_ms=%.1f",
            request.method,
            request.url.path,
            duration_ms,
        )
        raise

    duration_ms = (time.perf_counter() - started) * 1000
    message = "request.end method=%s path=%s status=%s duration_ms=%.1f"
    if duration_ms >= settings.slow_request_ms:
        logger.warning(message, request.method, request.url.path, response.status_code, duration_ms)
    else:
        logger.info(message, request.method, request.url.path, response.status_code, duration_ms)
    return response


@app.get("/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(app=settings.app_name)


@app.get("/api/developer/runtime", response_model=DeveloperRuntimeResponse)
def developer_runtime() -> DeveloperRuntimeResponse:
    with conversation_service.jobs_lock:
        jobs_total = len(conversation_service.jobs)
        jobs_running = sum(1 for job in conversation_service.jobs.values() if not job.done)
    records = conversation_service.store.list_records()
    return DeveloperRuntimeResponse(
        app_env=settings.app_env,
        conversation_store_path=str(conversation_service.store.path.resolve()),
        conversation_count=len(records),
        jobs_total=jobs_total,
        jobs_running=jobs_running,
        log_level=current_log_level,
    )


@app.put("/api/developer/log-level", response_model=LogLevelResponse)
def update_log_level(payload: LogLevelUpdate) -> LogLevelResponse:
    global current_log_level
    current_log_level = _set_log_level(payload.level)
    logger.info("developer.log_level_updated level=%s", current_log_level)
    return LogLevelResponse(level=current_log_level)


@app.get("/api/providers", response_model=list[ProviderProfile])
def list_providers() -> list[ProviderProfile]:
    return provider_store.list_profiles()


@app.put("/api/providers/{provider_id}", response_model=ProviderProfile)
def upsert_provider(provider_id: str, payload: ProviderProfileUpdate) -> ProviderProfile:
    return provider_store.upsert(provider_id=provider_id, update=payload)


@app.post("/api/providers/{provider_id}", response_model=ProviderProfile, status_code=201)
def create_provider(provider_id: str, payload: ProviderProfileUpdate) -> ProviderProfile:
    try:
        return provider_store.create(provider_id=provider_id, update=payload)
    except ValueError:
        raise HTTPException(status_code=409, detail=f"Provider '{provider_id}' already exists")


@app.post("/api/model-probes", response_model=ProviderValidateResponse)
def probe_model_endpoint(payload: ProviderValidateRequest) -> ProviderValidateResponse:
    """Validate an endpoint before it is saved; provider_id, when given, unlocks its stored key."""
    return probe_upstream(payload, saved_key=provider_store.get_saved_key(payload.provider_id or ""))


@app.delete("/api/providers/{provider_id}")
def delete_provider(provider_id: str) -> Response:
    if not provider_store.delete_profile(provider_id):
        raise HTTPException(status_code=404, detail=f"Provider '{provider_id}' not found")
    return Response(status_code=204)


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
    if reason == "system_role_locked":
        raise HTTPException(status_code=409, detail=f"Agent '{name}' is a system agent; its role cannot change")
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


def _require_agent(name: str) -> AgentDefinition:
    for definition in agent_loader.list_definitions():
        if definition.name == name:
            return definition
    raise HTTPException(status_code=404, detail=f"Agent '{name}' not found")


@app.get("/api/memory", response_model=list[MemoryStatusResponse])
def list_memory_statuses() -> list[MemoryStatusResponse]:
    return [
        MemoryStatusResponse.model_validate(memory_store.status(definition.name))
        for definition in agent_loader.list_definitions()
    ]


@app.get("/api/memory/{agent_name}", response_model=MemoryStatusResponse)
def get_memory_status(agent_name: str, query: str = "") -> MemoryStatusResponse:
    _require_agent(agent_name)
    return MemoryStatusResponse.model_validate(memory_store.status(agent_name, query=query))


@app.get("/api/memory/{agent_name}/detail", response_model=MemoryDetailResponse)
def get_memory_detail(agent_name: str) -> MemoryDetailResponse:
    _require_agent(agent_name)
    return MemoryDetailResponse.model_validate(memory_store.detail(agent_name))


@app.post("/api/memory/{agent_name}/remember", response_model=MemoryFactView)
def remember_for_agent(agent_name: str, payload: MemoryRememberRequest) -> MemoryFactView:
    _require_agent(agent_name)
    try:
        record = memory_store.remember(
            agent_name,
            payload.text,
            tags=payload.tags,
            scope=payload.scope,
            pinned=payload.pinned,
            confidence=payload.confidence,
            importance=payload.importance,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    return MemoryFactView.model_validate(record)


@app.patch("/api/memory/{agent_name}/facts/{fact_id}", response_model=MemoryFactView)
def update_agent_fact(
    agent_name: str,
    fact_id: str,
    payload: MemoryFactUpdateRequest,
) -> MemoryFactView:
    _require_agent(agent_name)
    try:
        record = memory_store.update_fact(
            agent_name,
            fact_id,
            text=payload.text,
            pinned=payload.pinned,
            importance=payload.importance,
            confidence=payload.confidence,
            status=payload.status,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    if record is None:
        raise HTTPException(status_code=404, detail=f"Memory fact '{fact_id}' not found")
    return MemoryFactView.model_validate(record)


@app.delete("/api/memory/{agent_name}/facts/{fact_id}", response_model=MemoryFactView)
def archive_agent_fact(agent_name: str, fact_id: str) -> MemoryFactView:
    _require_agent(agent_name)
    record = memory_store.update_fact(agent_name, fact_id, status="archived")
    if record is None:
        raise HTTPException(status_code=404, detail=f"Memory fact '{fact_id}' not found")
    return MemoryFactView.model_validate(record)


@app.post("/api/memory/{agent_name}/facts/{fact_id}/promote", response_model=MemoryFactView)
def promote_agent_fact(agent_name: str, fact_id: str) -> MemoryFactView:
    _require_agent(agent_name)
    record = memory_store.promote_fact(agent_name, fact_id)
    if record is None:
        raise HTTPException(status_code=404, detail=f"Private fact '{fact_id}' not found")
    return MemoryFactView.model_validate(record)


@app.post("/api/memory/{agent_name}/dream", response_model=MemoryDreamResponse)
def dream_for_agent(agent_name: str, payload: MemoryDreamRequest) -> MemoryDreamResponse:
    definition = _require_agent(agent_name)
    provider_id = payload.provider_id or definition.provider_profile
    provider = provider_store.get_profile(provider_id)
    if provider is None:
        raise HTTPException(status_code=404, detail=f"Provider '{provider_id}' not found")
    secrets = provider_store.read_secrets()
    if not provider_is_reachable(provider, secrets):
        raise HTTPException(
            status_code=422,
            detail=f"Provider '{provider_id}' is disabled or has no saved API key",
        )
    profile = provider
    if not payload.provider_id or payload.provider_id == definition.provider_profile:
        profile = provider.model_copy(update={"default_model": definition.model})

    try:
        report = memory_store.dream(
            agent_name,
            profile,
            secrets,
            apply=payload.apply,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc))
    except ModelCallError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return MemoryDreamResponse.model_validate(report)


@app.get("/api/conversations", response_model=list[ConversationListItem])
def list_conversations() -> list[ConversationListItem]:
    return conversation_service.list_conversations()


@app.get("/api/conversations/search", response_model=ConversationSearchResponse)
def search_conversations(
    query: str = Query(..., min_length=1, max_length=200),
    scope: str = Query("all", max_length=12),
    limit: int = Query(20, ge=1, le=50),
    cursor: str | None = Query(None, max_length=400),
) -> ConversationSearchResponse:
    return conversation_service.search_conversations(query, scope=scope, limit=limit, cursor=cursor)


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


@app.post("/api/conversations/{conversation_id}/cancel")
def cancel_conversation(conversation_id: str) -> dict:
    cancelled = conversation_service.cancel_conversation(conversation_id)
    return {"ok": True, "cancelled": cancelled}


@app.post("/api/conversations/{conversation_id}/branches")
def create_branch(conversation_id: str, payload: BranchRequest) -> StreamingResponse:
    definitions = agent_loader.list_definitions()
    events = conversation_service.stream_branch(
        conversation_id,
        payload,
        expert_count=len(definitions),
        agents=definitions,
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


@app.post("/api/conversations/{conversation_id}/active-path", response_model=ConversationResponse)
def select_active_path(conversation_id: str, payload: ActivePathRequest) -> ConversationResponse:
    result = conversation_service.set_active_path(conversation_id, payload.node_id)
    if result is None:
        raise HTTPException(status_code=404, detail="Conversation not found")
    return result
