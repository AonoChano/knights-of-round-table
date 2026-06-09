from __future__ import annotations

import logging
import time

from fastapi import FastAPI, HTTPException, Request, Response, status
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
    DeveloperRuntimeResponse,
    HealthResponse,
    LogLevelResponse,
    LogLevelUpdate,
    ProviderConnectivityRequest,
    ProviderConnectivityResponse,
    ProviderProfile,
    ProviderProfileUpdate,
    ProviderSecretStatus,
    ProviderSecretUpdate,
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
conversation_service = VisibleConversationService(ConversationStore(settings.conversation_db))


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


@app.post("/api/conversations/{conversation_id}/cancel")
def cancel_conversation(conversation_id: str) -> dict:
    cancelled = conversation_service.cancel_conversation(conversation_id)
    return {"ok": True, "cancelled": cancelled}


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
