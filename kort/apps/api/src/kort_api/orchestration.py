from __future__ import annotations

import asyncio
import json
import re
import time
from collections.abc import AsyncIterator, Iterator
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Annotated, Callable, TypedDict
from uuid import uuid4

from langgraph.graph import END, StateGraph

from .model_client import ModelCallError, OpenAICompatibleClient
from .providers import model_is_selected, provider_is_reachable
from .request_router import LEVEL_MAX_ROUNDS, RouteDecision
from .schemas import AgentDefinition, ProviderProfile

SUMMARY_TITLE_RE = re.compile(r"^###\s+(.+)$", re.MULTILINE)
SUMMARY_BODY_RE = re.compile(r"^###\s+.+\n+", re.MULTILINE)


class DiscussionState(TypedDict):
    question: str
    current_round: int
    max_rounds: int
    expert_outputs: Annotated[dict[str, str], lambda left, right: {**left, **right}]
    critic_reviews: Annotated[dict[str, str], lambda left, right: {**left, **right}]
    discussion_transcript: Annotated[list[str], lambda left, right: left + right]
    stage_summaries: Annotated[list[dict], lambda left, right: left + right]
    should_continue: bool
    final_answer_text: str
    agents: list[dict]
    providers: list[dict]
    secrets: dict[str, str]
    agent_contexts: dict[str, str]


def _agent_by_role(agents: list[dict], role: str) -> list[dict]:
    return [a for a in agents if a.get("role") == role]


def _provider_by_id(providers: list[dict], provider_id: str) -> dict | None:
    for p in providers:
        if p.get("provider_id") == provider_id:
            return p
    return None


def _profile_for_agent(agent: dict, provider: dict) -> ProviderProfile:
    profile = ProviderProfile.model_validate(provider)
    model = str(agent.get("model") or "").strip()
    if model:
        return profile.model_copy(update={"default_model": model})
    return profile


def _compose_system(agent: dict, agent_contexts: dict[str, str] | None) -> str:
    base = str(agent.get("system_prompt") or "")
    extra = str((agent_contexts or {}).get(str(agent.get("name") or ""), "")).strip()
    return f"{base}\n\n{extra}".strip() if extra else base


def _agent_system(agent: dict, state: DiscussionState) -> str:
    return _compose_system(agent, state.get("agent_contexts"))


def _call_model(
    agent: dict,
    provider: dict,
    system_prompt: str,
    user_prompt: str,
    secrets: dict[str, str],
    *,
    disable_thinking: bool = False,
) -> str:
    profile = _profile_for_agent(agent, provider)
    client = OpenAICompatibleClient(secrets)
    return client.chat(provider=profile, prompt=user_prompt, system_prompt=system_prompt, disable_thinking=disable_thinking)


def _call_model_stream(
    agent: dict,
    provider: dict,
    system_prompt: str,
    user_prompt: str,
    secrets: dict[str, str],
    *,
    disable_thinking: bool = False,
) -> Iterator[str]:
    profile = _profile_for_agent(agent, provider)
    client = OpenAICompatibleClient(secrets)
    yield from client.stream_chat(provider=profile, prompt=user_prompt, system_prompt=system_prompt, disable_thinking=disable_thinking)


def _enabled_candidates(
    agents: list[dict],
    providers: list[dict],
    secrets: dict[str, str],
    preferred_roles: tuple[str, ...] = ("synthesizer", "expert", "summarizer", "critic"),
) -> list[tuple[dict, dict]]:
    collected: list[tuple[dict, dict, int]] = []
    for role in preferred_roles:
        for agent in agents:
            if agent.get("role") != role:
                continue
            raw_provider = _provider_by_id(providers, agent.get("provider_profile", ""))
            if not raw_provider:
                continue
            try:
                provider = ProviderProfile.model_validate(raw_provider)
            except Exception:
                continue
            if not provider_is_reachable(provider, secrets):
                continue
            if not model_is_selected(provider, str(agent.get("model") or "")):
                continue
            collected.append((agent, raw_provider, int(agent.get("priority") or 0)))
    collected.sort(key=lambda item: item[2], reverse=True)
    return [(agent, provider) for agent, provider, _ in collected]


def _clip(text: str, limit: int = 200) -> str:
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _call_first_working(
    candidates: list[tuple[dict, dict]],
    *,
    user_prompt: str,
    secrets: dict[str, str],
    system_prompt: str | None = None,
    agent_contexts: dict[str, str] | None = None,
    disable_thinking: bool = False,
) -> str:
    """Run the first candidate that answers; one rejected key must not sink the whole reply.

    ``system_prompt`` stays None for persona-driven calls so each candidate speaks as its own
    agent; a fixed prompt is passed for machinery like the route classifier.
    """
    errors: list[str] = []
    for agent, provider in candidates:
        try:
            return _call_model(
                agent=agent,
                provider=provider,
                system_prompt=(
                    _compose_system(agent, agent_contexts) if system_prompt is None else system_prompt
                ),
                user_prompt=user_prompt,
                secrets=secrets,
                disable_thinking=disable_thinking,
            )
        except ModelCallError as exc:
            errors.append(f"{provider.get('provider_id')}: {exc}")
    raise ModelCallError("; ".join(errors) or "no enabled provider is available")


def _stream_first_working(
    candidates: list[tuple[dict, dict]],
    *,
    user_prompt: str,
    secrets: dict[str, str],
    system_prompt: str | None = None,
    agent_contexts: dict[str, str] | None = None,
    disable_thinking: bool = False,
) -> Iterator[str]:
    errors: list[str] = []
    for agent, provider in candidates:
        started = False
        try:
            for chunk in _call_model_stream(
                agent=agent,
                provider=provider,
                system_prompt=(
                    _compose_system(agent, agent_contexts) if system_prompt is None else system_prompt
                ),
                user_prompt=user_prompt,
                secrets=secrets,
                disable_thinking=disable_thinking,
            ):
                started = True
                yield chunk
        except ModelCallError as exc:
            # Only a candidate that never opened its stream is safe to replace.
            if started:
                raise
            errors.append(f"{provider.get('provider_id')}: {exc}")
            continue
        return
    raise ModelCallError("; ".join(errors) or "no enabled provider is available")


async def _stream_thinking_first_working(
    client: OpenAICompatibleClient,
    candidates: list[tuple[dict, dict]],
    *,
    question: str,
    agent_contexts: dict[str, str] | None = None,
) -> AsyncIterator[dict[str, str]]:
    errors: list[str] = []
    for agent, provider in candidates:
        profile = _profile_for_agent(agent, provider)
        opened = False
        try:
            async for chunk in client.stream_model_with_thinking(
                provider=profile,
                prompt=question,
                system_prompt=_compose_system(agent, agent_contexts),
                disable_thinking=False,
                enable_thinking=True,
            ):
                opened = True
                yield chunk
        except ModelCallError as exc:
            if opened:
                raise
            errors.append(f"{provider.get('provider_id')}: {exc}")
            continue
        return
    raise ModelCallError("; ".join(errors) or "no enabled provider is available")


def _summarize_round(state: DiscussionState) -> dict:
    agents = state["agents"]
    providers = state["providers"]
    secrets = state["secrets"]
    question = state["question"]
    current_round = state.get("current_round", 0)
    round_number = current_round + 1

    summarizers = _agent_by_role(agents, "summarizer")
    transcript = "\n\n---\n\n".join(state.get("discussion_transcript", []))

    if not summarizers or not transcript.strip():
        return {
            "current_round": round_number,
            "stage_summaries": [
                {
                    "id": f"summary-round-{round_number}",
                    "title": f"Round {round_number} summary",
                    "body": "Discussion summary unavailable.",
                    "confidence": 0.5,
                }
            ],
        }

    summarizers.sort(key=lambda a: a.get("priority", 0), reverse=True)

    summarizer_agent: dict | None = None
    provider: dict | None = None
    for agent in summarizers:
        p = _provider_by_id(providers, agent.get("provider_profile", ""))
        if p and p.get("enabled"):
            summarizer_agent = agent
            provider = p
            break

    if not summarizer_agent or not provider:
        return {
            "current_round": round_number,
            "stage_summaries": [
                {
                    "id": f"summary-round-{round_number}",
                    "title": f"Round {round_number} summary",
                    "body": "No enabled provider for any summarizer.",
                    "confidence": 0.3,
                }
            ],
        }

    summarizer_prompt = (
        "Below is a transcript of expert discussions for the question. "
        "Write a concise first-person stage summary in the format:\n\n"
        "### Short Descriptive Title\n\n"
        "First-person summary paragraph.\n\n"
        "Rules:\n"
        "- Write ENTIRELY in first person (\"I\").\n"
        "- NEVER mention multiple models, experts, AI agents, or the discussion process.\n"
        "- Sound like a single person thinking through the problem.\n"
        "- Capture intellectual progression: what was considered, challenged, refined.\n"
        "- Keep to 2-4 sentences.\n\n"
        f"Question: {question}\n\n"
        f"Discussion transcript:\n{transcript}\n\n"
        "Now produce your summary:"
    )

    try:
        raw = _call_model(
            agent=summarizer_agent,
            provider=provider,
            system_prompt=_agent_system(summarizer_agent, state),
            user_prompt=summarizer_prompt,
            secrets=secrets,
            disable_thinking=True,
        )
    except ModelCallError:
        raw = f"### Round {round_number} summary\n\nDiscussion complete."

    title_match = SUMMARY_TITLE_RE.search(raw)
    title = title_match.group(1).strip() if title_match else f"Round {round_number} summary"
    body = SUMMARY_BODY_RE.sub("", raw).strip() or raw

    return {
        "current_round": round_number,
        "stage_summaries": [
            {
                "id": f"summary-round-{round_number}",
                "title": title,
                "body": body,
                "confidence": 0.78,
            }
        ],
    }


def _merge_state(state: DiscussionState, update: dict) -> DiscussionState:
    merged = dict(state)
    for key, value in update.items():
        if key in ("discussion_transcript", "stage_summaries") and key in state:
            merged[key] = state[key] + value
        elif key == "expert_outputs":
            merged[key] = {**state.get("expert_outputs", {}), **value}
        else:
            merged[key] = value
    return merged


def select_summarizer(
    agents: list[dict], providers: list[dict], secrets: dict[str, str]
) -> tuple[dict | None, dict | None]:
    """Public alias so the streaming layer can reach the same projection writer."""
    return _pick_summarizer(agents, providers, secrets)


def _pick_summarizer(
    agents: list[dict], providers: list[dict], secrets: dict[str, str]
) -> tuple[dict | None, dict | None]:
    summarizers = _agent_by_role(agents, "summarizer")
    if not summarizers:
        return None, None
    summarizers.sort(key=lambda a: a.get("priority", 0), reverse=True)
    for agent in summarizers:
        p = _provider_by_id(providers, agent.get("provider_profile", ""))
        if p and p.get("enabled"):
            return agent, p
    return None, None


def _build_summarizer_prompt(question: str, transcript: str) -> str:
    return (
        "Below is a transcript of expert discussions for the question. "
        "Transform it into a safe user-visible thinking projection. "
        "Do not quote, preserve, or expose the transcript. "
        "Write a concise first-person stage summary in the format:\n\n"
        "### Short Descriptive Title\n\n"
        "First-person summary paragraph.\n\n"
        "Rules:\n"
        "- Write ENTIRELY in first person (\"I\").\n"
        "- NEVER mention multiple models, experts, AI agents, or the discussion process.\n"
        "- NEVER reveal hidden chain-of-thought, raw transcript lines, speaker names, or internal messages.\n"
        "- Sound like a single person thinking through the problem.\n"
        "- Capture intellectual progression: what was considered, challenged, refined.\n"
        "- Keep to 2-4 sentences.\n\n"
        f"Question: {question}\n\n"
        f"Discussion transcript:\n{transcript}\n\n"
        "Now produce your summary:"
    )


def _experts_think(state: DiscussionState) -> dict:
    agents = state["agents"]
    providers = state["providers"]
    secrets = state["secrets"]
    question = state["question"]
    current_round = state.get("current_round", 0)

    experts = _agent_by_role(agents, "expert")
    if not experts:
        return {"discussion_transcript": ["[No experts configured]"]}

    previous_discussion = "\n\n---\n\n".join(state.get("discussion_transcript", []))

    def _invoke_expert(expert: dict) -> tuple[str, str, str]:
        name = expert.get("name", "unknown")
        nickname = expert.get("nickname", name)
        provider = _provider_by_id(providers, expert.get("provider_profile", ""))
        if not provider:
            return name, nickname, f"[{nickname} had no valid provider]"

        if current_round == 0:
            prompt = f'Analyze the following question thoroughly and provide your expert analysis.\n\nQuestion: {question}'
        else:
            prompt = (
                f"You are continuing a multi-round discussion on this question.\n\n"
                f"Previous discussion:\n{previous_discussion}\n\n"
                f"Based on the above, refine your analysis. Respond to any criticisms "
                f"and integrate insights from other perspectives.\n\n"
                f"Question: {question}"
            )

        try:
            output = _call_model(
                agent=expert,
                provider=provider,
                system_prompt=_agent_system(expert, state),
                user_prompt=prompt,
                secrets=secrets,
                disable_thinking=True,
            )
        except ModelCallError:
            output = f"[{nickname} was unavailable]"
        except Exception:
            output = f"[{nickname} encountered an unexpected error]"

        return name, nickname, output

    new_outputs: dict[str, str] = {}
    transcript_entries: list[str] = []

    with ThreadPoolExecutor(max_workers=len(experts)) as executor:
        future_map = {executor.submit(_invoke_expert, e): e for e in experts}
        for future in as_completed(future_map):
            name, nickname, output = future.result()
            new_outputs[name] = output
            transcript_entries.append(f"[{nickname} (Round {current_round + 1})]:\n{output}")

    return {
        "expert_outputs": new_outputs,
        "discussion_transcript": transcript_entries,
    }


def _critics_review(state: DiscussionState) -> dict:
    agents = state["agents"]
    providers = state["providers"]
    secrets = state["secrets"]
    question = state["question"]
    current_round = state.get("current_round", 0)
    expert_outputs = state.get("expert_outputs", {})

    critics = _agent_by_role(agents, "critic")
    if not critics or not expert_outputs:
        return {"discussion_transcript": ["[No critics available for review]"]}

    nickname_by_name = {
        agent.get("name", ""): agent.get("nickname", agent.get("name", ""))
        for agent in agents
    }

    combined_outputs = "\n\n---\n\n".join(
        f"[{nickname_by_name.get(name, name)}]:\n{text}"
        for name, text in expert_outputs.items()
    )

    def _invoke_critic(critic: dict) -> tuple[str, str, str]:
        name = critic.get("name", "unknown")
        nickname = critic.get("nickname", name)
        provider = _provider_by_id(providers, critic.get("provider_profile", ""))
        if not provider:
            return name, nickname, f"[{nickname} had no valid provider]"

        prompt = (
            f"You are a critical reviewer. Below are expert analyses for the question.\n\n"
            f"Question: {question}\n\n"
            f"Expert outputs:\n{combined_outputs}\n\n"
            f"Identify weak assumptions, unsupported claims, logical gaps, "
            f"and places where the analysis could mislead. Be specific."
        )

        try:
            review = _call_model(
                agent=critic,
                provider=provider,
                system_prompt=_agent_system(critic, state),
                user_prompt=prompt,
                secrets=secrets,
                disable_thinking=True,
            )
        except ModelCallError:
            review = f"[{nickname} review unavailable]"
        except Exception:
            review = f"[{nickname} encountered an unexpected error]"

        return name, nickname, review

    transcript_entries: list[str] = []
    reviews: dict[str, str] = {}

    with ThreadPoolExecutor(max_workers=len(critics)) as executor:
        future_map = {executor.submit(_invoke_critic, c): c for c in critics}
        for future in as_completed(future_map):
            name, nickname, review = future.result()
            reviews[name] = review
            transcript_entries.append(f"[{nickname} (Round {current_round + 1} review)]:\n{review}")

    return {
        "critic_reviews": reviews,
        "discussion_transcript": transcript_entries,
    }


def _calculate_text_similarity(texts_a: list[str], texts_b: list[str]) -> float:
    """
    Calculate similarity between two sets of texts using simple word overlap.

    Returns a score between 0.0 (completely different) and 1.0 (identical).
    Uses Jaccard similarity on word sets as a simple heuristic.
    """
    if not texts_a or not texts_b:
        return 0.0

    def _normalize_text(text: str) -> set[str]:
        """Convert text to normalized word set"""
        # Remove special characters, lowercase, split into words
        words = re.sub(r'[^\w\s]', ' ', text.lower()).split()
        # Filter out very short words (likely articles, prepositions)
        return set(word for word in words if len(word) > 2)

    # Combine all texts in each set into word sets
    words_a = set()
    for text in texts_a:
        words_a.update(_normalize_text(text))

    words_b = set()
    for text in texts_b:
        words_b.update(_normalize_text(text))

    if not words_a or not words_b:
        return 0.0

    # Calculate Jaccard similarity: intersection / union
    intersection = len(words_a & words_b)
    union = len(words_a | words_b)

    if union == 0:
        return 0.0

    return intersection / union


def _evaluate_convergence(state: DiscussionState) -> dict:
    """
    Evaluate whether the discussion has converged.

    Returns:
        {
            "convergence_score": float (0.0-1.0),
            "reason": str,
            "should_stop_early": bool
        }
    """
    current_round = state.get("current_round", 0)

    # Strategy 1: Minimum rounds protection (at least 2 rounds to compare)
    if current_round < 2:
        return {
            "convergence_score": 0.0,
            "reason": "minimum_rounds_not_met",
            "should_stop_early": False
        }

    # Strategy 2: Check expert outputs availability
    expert_outputs = state.get("expert_outputs", {})
    if len(expert_outputs) < 2:
        return {
            "convergence_score": 0.3,
            "reason": "insufficient_experts",
            "should_stop_early": False
        }

    # Strategy 3: Check if we have enough history to compare
    discussion_transcript = state.get("discussion_transcript", [])
    if len(discussion_transcript) < 2:
        return {
            "convergence_score": 0.4,
            "reason": "insufficient_history",
            "should_stop_early": False
        }

    # Strategy 4: Compare recent round with previous round
    # Extract texts from the last round
    expert_count = len(expert_outputs)
    if len(discussion_transcript) < expert_count * 2:
        # Not enough history for comparison (only one round completed)
        return {
            "convergence_score": 0.5,
            "reason": "first_round_only",
            "should_stop_early": False
        }

    # Get the most recent round's expert outputs
    last_round_texts = discussion_transcript[-expert_count:]
    # Get the previous round's expert outputs
    prev_round_texts = discussion_transcript[-(expert_count * 2):-expert_count]

    # Calculate similarity
    similarity = _calculate_text_similarity(last_round_texts, prev_round_texts)

    # Convergence threshold: 92% similarity (stricter to avoid premature stops)
    CONVERGENCE_THRESHOLD = 0.92
    should_stop = similarity >= CONVERGENCE_THRESHOLD

    return {
        "convergence_score": similarity,
        "reason": "high_similarity" if should_stop else "still_evolving",
        "should_stop_early": should_stop
    }


def _decide_continue(state: DiscussionState) -> dict:
    current = state.get("current_round", 0)
    max_rounds = state.get("max_rounds", 4)

    # Basic round limit check
    if current >= max_rounds:
        return {"should_continue": False}

    # Minimum rounds protection (at least 2 rounds before early stop)
    if current < 2:
        return {"should_continue": True}

    # Evaluate convergence
    convergence = _evaluate_convergence(state)

    if convergence["should_stop_early"]:
        return {
            "should_continue": False,
            "early_stop": True,
            "early_stop_reason": convergence["reason"],
            "convergence_score": convergence["convergence_score"]
        }

    return {"should_continue": True}


def _final_answer_prompt(state: DiscussionState) -> str:
    stage_summaries = state.get("stage_summaries", [])
    summary_context = ""
    for s in stage_summaries:
        if isinstance(s, dict):
            summary_context += f"\n### {s.get('title', '')}\n{s.get('body', '')}"

    prompt = (
        "Answer the user's question directly. Keep the answer clear, structured, and practical. "
        "Do not mention internal experts, orchestration, hidden reasoning, or chain-of-thought.\n\n"
        f"User question:\n{state['question'].strip()}"
    )

    if summary_context.strip():
        prompt += (
            "\n\nContext from prior analysis (use this to inform your answer, "
            "but do not reference it directly):\n"
            f"{summary_context[-3000:]}"
        )
    return prompt


def _produce_final_answer(state: DiscussionState) -> dict:
    candidates = _enabled_candidates(state["agents"], state["providers"], state["secrets"])
    if not candidates:
        return {
            "final_answer_text": (
                "No enabled OpenAI-compatible provider with a saved API key is available. "
                "Add a provider key in Settings, then try again."
            )
        }

    try:
        body = _call_first_working(
            candidates,
            user_prompt=_final_answer_prompt(state),
            secrets=state["secrets"],
            agent_contexts=state.get("agent_contexts"),
            disable_thinking=True,
        )
    except ModelCallError as exc:
        body = f"The final response could not be generated. Please check your provider configuration. ({_clip(str(exc))})"

    return {"final_answer_text": body}


def _stream_final_answer(state: DiscussionState) -> Iterator[str]:
    candidates = _enabled_candidates(state["agents"], state["providers"], state["secrets"])
    if not candidates:
        yield "No enabled provider available. Add a provider key in Settings."
        return

    try:
        yield from _stream_first_working(
            candidates,
            user_prompt=_final_answer_prompt(state),
            secrets=state["secrets"],
            agent_contexts=state.get("agent_contexts"),
            disable_thinking=True,
        )
    except ModelCallError as exc:
        yield f"The final response could not be generated. ({_clip(str(exc))})"


def _parse_route_classifier_output(text: str) -> str | None:
    cleaned = text.strip()
    if not cleaned:
        return None

    json_match = re.search(r"\{.*\}", cleaned, re.DOTALL)
    payload_text = json_match.group(0) if json_match else cleaned
    try:
        payload = json.loads(payload_text)
    except ValueError:
        lowered = cleaned.lower()
        if "direct" in lowered and "panel" not in lowered:
            return "direct"
        if "panel" in lowered:
            return "panel"
        return None

    route = payload.get("route")
    if route in {"direct", "panel"}:
        return route
    return None


def classify_auto_route(
    question: str,
    agents: list[AgentDefinition],
    providers: list[ProviderProfile],
    secrets: dict[str, str],
    *,
    has_history: bool = False,
) -> RouteDecision:
    agents_dicts = [a.model_dump(mode="json") for a in agents]
    providers_dicts = [p.model_dump(mode="json") for p in providers]
    candidates = _enabled_candidates(
        agents_dicts,
        providers_dicts,
        secrets,
        preferred_roles=("synthesizer", "expert", "summarizer"),
    )
    if not candidates:
        return RouteDecision(kind="panel", reason_code="auto_classifier_unavailable", max_rounds=LEVEL_MAX_ROUNDS["auto"])

    prompt = (
        "Classify the user's latest message for a chat product that can either answer directly "
        "or run a costly multi-agent expert panel. Return exactly one JSON object: "
        '{"route":"direct"} or {"route":"panel"}.\n\n'
        "Use direct for greetings, thanks, acknowledgements, casual small talk, simple personal check-ins, "
        "or very simple requests that do not benefit from multi-stage review. This must work across languages.\n"
        "Use panel for planning, debugging, coding, math, research, comparisons, high-stakes advice, nuanced decisions, "
        "ambiguous follow-ups that depend on prior work, or anything that benefits from critique.\n"
        "Do not explain your choice. Do not include hidden reasoning.\n\n"
        f"Has previous conversation context: {'yes' if has_history else 'no'}\n"
        f"Latest user message:\n{question.strip()[:1200]}"
    )

    try:
        raw = _call_first_working(
            candidates,
            system_prompt="You are a strict request router. Output only valid JSON.",
            user_prompt=prompt,
            secrets=secrets,
            disable_thinking=True,
        )
    except Exception:
        return RouteDecision(kind="panel", reason_code="auto_classifier_failed", max_rounds=LEVEL_MAX_ROUNDS["auto"])

    route = _parse_route_classifier_output(raw)
    if route == "direct":
        return RouteDecision(kind="direct", reason_code="auto_classifier_direct")
    return RouteDecision(kind="panel", reason_code="auto_classifier_panel", max_rounds=LEVEL_MAX_ROUNDS["auto"])


def build_discussion_graph() -> StateGraph:
    graph = StateGraph(DiscussionState)

    graph.add_node("experts_think", _experts_think)
    graph.add_node("critics_review", _critics_review)
    graph.add_node("summarize_round", _summarize_round)
    graph.add_node("decide_continue", _decide_continue)
    graph.add_node("produce_final", _produce_final_answer)

    graph.set_conditional_entry_point(
        lambda state: "produce_final" if state.get("max_rounds", 4) <= 0 else "experts_think",
        {"experts_think": "experts_think", "produce_final": "produce_final"},
    )
    graph.add_edge("experts_think", "critics_review")
    graph.add_edge("critics_review", "summarize_round")
    graph.add_edge("summarize_round", "decide_continue")

    graph.add_conditional_edges(
        "decide_continue",
        lambda state: "experts_think" if state.get("should_continue") else "produce_final",
        {"experts_think": "experts_think", "produce_final": "produce_final"},
    )

    graph.add_edge("produce_final", END)

    return graph


def run_discussion(
    question: str,
    agents: list[AgentDefinition],
    providers: list[ProviderProfile],
    secrets: dict[str, str],
    max_rounds: int = 4,
    agent_contexts: dict[str, str] | None = None,
) -> Iterator[dict]:
    graph = build_discussion_graph()
    compiled = graph.compile()

    agents_dicts = [a.model_dump(mode="json") for a in agents]
    providers_dicts = [p.model_dump(mode="json") for p in providers]

    initial_state: DiscussionState = {
        "question": question,
        "current_round": 0,
        "max_rounds": max_rounds,
        "expert_outputs": {},
        "critic_reviews": {},
        "discussion_transcript": [],
        "stage_summaries": [],
        "should_continue": True,
        "final_answer_text": "",
        "agents": agents_dicts,
        "providers": providers_dicts,
        "secrets": secrets,
        "agent_contexts": agent_contexts or {},
    }

    final_text = ""
    for event in compiled.stream(initial_state, stream_mode="updates"):
        for _node_name, node_output in event.items():
            if not isinstance(node_output, dict):
                continue

            if isinstance(node_output.get("final_answer_text"), str):
                final_text = node_output["final_answer_text"]

            summaries = node_output.get("stage_summaries")
            if summaries:
                for summary in summaries:
                    yield {
                        "type": "summary",
                        "id": summary.get("id", ""),
                        "title": summary.get("title", ""),
                        "body": summary.get("body", ""),
                        "confidence": summary.get("confidence", 0.0),
                    }

            transcript = node_output.get("discussion_transcript")
            if transcript:
                pass

    yield {
        "type": "final",
        "body": final_text,
    }


def run_direct_answer_stream(
    question: str,
    agents: list[AgentDefinition],
    providers: list[ProviderProfile],
    secrets: dict[str, str],
    agent_contexts: dict[str, str] | None = None,
    answer_stream: Callable[[str], Iterator[str]] | None = None,
) -> Iterator[str]:
    agents_dicts = [a.model_dump(mode="json") for a in agents]
    providers_dicts = [p.model_dump(mode="json") for p in providers]

    state: DiscussionState = {
        "question": question,
        "current_round": 0,
        "max_rounds": 0,
        "expert_outputs": {},
        "critic_reviews": {},
        "discussion_transcript": [],
        "stage_summaries": [],
        "should_continue": False,
        "final_answer_text": "",
        "agents": agents_dicts,
        "providers": providers_dicts,
        "secrets": secrets,
        "agent_contexts": agent_contexts or {},
    }

    def _sse(event: str, payload: dict) -> str:
        return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"

    if answer_stream is not None:
        yield from answer_stream(_final_answer_prompt(state))
        return

    for chunk in _stream_final_answer(state):
        yield _sse("final_delta", {"delta": chunk})


def run_discussion_stream(
    question: str,
    agents: list[AgentDefinition],
    providers: list[ProviderProfile],
    secrets: dict[str, str],
    max_rounds: int = 4,
    agent_contexts: dict[str, str] | None = None,
    answer_stream: Callable[[str], Iterator[str]] | None = None,
) -> Iterator[str]:
    agents_dicts = [a.model_dump(mode="json") for a in agents]
    providers_dicts = [p.model_dump(mode="json") for p in providers]

    state: DiscussionState = {
        "question": question,
        "current_round": 0,
        "max_rounds": max_rounds,
        "expert_outputs": {},
        "critic_reviews": {},
        "discussion_transcript": [],
        "stage_summaries": [],
        "should_continue": True,
        "final_answer_text": "",
        "agents": agents_dicts,
        "providers": providers_dicts,
        "secrets": secrets,
        "agent_contexts": agent_contexts or {},
    }

    def _sse(event: str, payload: dict) -> str:
        return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"

    agents_by_name = {a.get("name", ""): a for a in agents_dicts}

    def _message_events(round_number: int, outputs: dict[str, str]) -> list[str]:
        events = []
        for name, text in outputs.items():
            agent = agents_by_name.get(name, {})
            events.append(
                _sse(
                    "discussion_message",
                    {
                        "id": f"r{round_number}-{name}",
                        "round": round_number,
                        "speaker": name,
                        "nickname": agent.get("nickname", name),
                        "role": agent.get("role", "expert"),
                        "text": text,
                    },
                )
            )
        return events

    def _final_answer_events() -> Iterator[str]:
        """The user-facing answer: either the injected tool loop or a plain provider stream."""
        if answer_stream is not None:
            yield from answer_stream(_final_answer_prompt(state))
            return
        for chunk in _stream_final_answer(state):
            yield _sse("final_delta", {"delta": chunk})

    if max_rounds <= 0:
        if answer_stream is None:
            yield _sse("thinking_complete", {})
        yield from _final_answer_events()
        return

    while True:
        round_number = state.get("current_round", 0) + 1
        yield _sse("talking_active", {})
        expert_output = _experts_think(state)
        state = _merge_state(state, expert_output)
        for event in _message_events(round_number, expert_output.get("expert_outputs", {})):
            yield event

        critic_output = _critics_review(state)
        state = _merge_state(state, critic_output)
        for event in _message_events(round_number, critic_output.get("critic_reviews", {})):
            yield event

        sid = f"summary-round-{round_number}"

        summarizer_agent, provider_dict = _pick_summarizer(
            state["agents"], state["providers"], secrets
        )
        transcript = "\n\n---\n\n".join(state.get("discussion_transcript", []))

        if summarizer_agent and provider_dict and transcript.strip():
            prompt = _build_summarizer_prompt(question, transcript)

            yield _sse("summary_start", {"id": sid})

            streamed_text = ""
            profile = _profile_for_agent(summarizer_agent, provider_dict)
            client = OpenAICompatibleClient(secrets)
            try:
                for chunk in client.stream_chat(
                    provider=profile,
                    prompt=prompt,
                    system_prompt=_agent_system(summarizer_agent, state),
                    disable_thinking=True,
                ):
                    streamed_text += chunk
                    yield _sse("summary_delta", {"id": sid, "delta": chunk})
            except ModelCallError:
                streamed_text = f"### Round {round_number} summary\n\nDiscussion complete."

            title_match = SUMMARY_TITLE_RE.search(streamed_text)
            title = title_match.group(1).strip() if title_match else f"Round {round_number} summary"
            body = SUMMARY_BODY_RE.sub("", streamed_text).strip() or streamed_text

            yield _sse("summary_title", {"id": sid, "title": title})
            yield _sse("summary_complete", {
                "id": sid,
                "stage": "summary",
                "title": title,
                "snippet": body[:120],
                "details": f"### {title}\n\n{body}",
                "confidence": 0.78,
                "tree_nodes": [
                    {"id": f"{sid}-node", "title": title, "summary": body, "status": "complete"},
                ],
            })
            yield _sse("thinking_active", {})

            state["stage_summaries"] = state.get("stage_summaries", []) + [{
                "id": sid, "title": title, "body": body, "confidence": 0.78,
            }]
        else:
            state["stage_summaries"] = state.get("stage_summaries", []) + [{
                "id": sid, "title": f"Round {round_number} summary",
                "body": "Summary unavailable.", "confidence": 0.3,
            }]

        state["current_round"] = round_number
        decision = _decide_continue(state)
        state = _merge_state(state, decision)

        if not state.get("should_continue"):
            break

    # Emit early stop metadata if applicable
    actual_rounds = state.get("current_round", 0)
    if state.get("early_stop", False):
        yield _sse("early_stop_detected", {
            "actual_rounds": actual_rounds,
            "max_rounds": max_rounds,
            "early_stop_reason": state.get("early_stop_reason"),
            "convergence_score": state.get("convergence_score")
        })

    if answer_stream is None:
        yield _sse("thinking_complete", {})

    yield from _final_answer_events()


# ---------------------------------------------------------------------------
# Solo deep-think streaming (async)
# ---------------------------------------------------------------------------


class TimerContext:
    """Monotonic clock for measuring elapsed wall time."""

    __slots__ = ("_start",)

    def __init__(self) -> None:
        self._start = time.monotonic()

    @property
    def elapsed(self) -> float:
        return time.monotonic() - self._start

    @property
    def elapsed_ms(self) -> int:
        return int((time.monotonic() - self._start) * 1000)


def _make_sse(event: str, payload: dict) -> str:
    """Format a single SSE event string (no trailing newline needed at call-site)."""
    return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"


THINK_CHUNK_SIZE = 1500
THINK_MIN_CHARS = 500


def thinking_projection_events(
    summarizer_agent: dict,
    provider_dict: dict,
    secrets: dict[str, str],
    think_text: str,
    stage_index: int,
    agent_context: str = "",
) -> list[str]:
    """Project one internal reasoning stretch into a safe, user-visible stage summary.

    Raw provider reasoning never leaves this function: only the rewritten projection does.
    """
    summary_id = str(uuid4())

    prompt = (
        "Rewrite the following internal reasoning signal into a safe user-visible "
        "thinking projection. Do not quote or expose the source text. Use a ### "
        "heading and a brief first-person body. Never mention hidden reasoning, "
        "chain-of-thought, models, experts, agents, or internal messages.\n\n"
        f"{think_text}"
    )

    profile = _profile_for_agent(summarizer_agent, provider_dict)
    sclient = OpenAICompatibleClient(secrets)
    events: list[str] = []
    streamed = ""

    try:
        for chunk in sclient.stream_chat(
            provider=profile,
            prompt=prompt,
            system_prompt=(
                f"{summarizer_agent.get('system_prompt', '')}\n\n{agent_context}".strip()
                if agent_context
                else summarizer_agent.get("system_prompt", "")
            ),
            disable_thinking=True,
        ):
            streamed += chunk
            events.append(
                _make_sse(
                    "summary_delta",
                    {"id": summary_id, "delta": chunk, "stage_index": stage_index},
                )
            )
    except ModelCallError:
        streamed = f"### 思考阶段 {stage_index + 1}\n\n思考过程摘要生成失败。"
        events.append(
            _make_sse(
                "summary_delta",
                {"id": summary_id, "delta": streamed, "stage_index": stage_index},
            )
        )

    title_match = SUMMARY_TITLE_RE.search(streamed)
    title = title_match.group(1).strip() if title_match else f"思考阶段 {stage_index + 1}"
    body = SUMMARY_BODY_RE.sub("", streamed).strip() or streamed

    events.append(
        _make_sse(
            "summary_complete",
            {
                "id": summary_id,
                "stage": "summary",
                "title": title,
                "snippet": body[:120],
                "details": f"### {title}\n\n{body}",
                "confidence": 0.78,
                "stage_index": stage_index,
                "tree_nodes": [
                    {"id": f"{summary_id}-node", "title": title, "summary": body, "status": "complete"},
                ],
            },
        )
    )
    # Signal the next thinking phase
    events.append(_make_sse("thinking_active", {}))
    return events


async def _run_summarizer_task(
    summarizer_agent: dict,
    provider_dict: dict,
    secrets: dict[str, str],
    think_text: str,
    stage_index: int,
    output_queue: asyncio.Queue[str],
    agent_context: str = "",
) -> None:
    """Run a sync summarizer stream in a thread executor and push SSE events
    into *output_queue*.  The task is designed to be cancellable."""
    loop = asyncio.get_running_loop()

    try:
        events = await loop.run_in_executor(
            None,
            lambda: thinking_projection_events(
                summarizer_agent, provider_dict, secrets, think_text, stage_index, agent_context
            ),
        )
    except asyncio.CancelledError:
        return
    for evt in events:
        await output_queue.put(evt)


async def run_solo_thinking_stream(
    question: str,
    agents: list[AgentDefinition],
    providers: list[ProviderProfile],
    secrets: dict[str, str],
    agent_contexts: dict[str, str] | None = None,
) -> AsyncIterator[str]:
    """Async generator that streams a single model through visible summaries.

    Provider reasoning tokens never go to the frontend directly. They are only
    used as an internal signal for a summarizer to produce a safe projection.
    When the model starts producing answer tokens all in-flight summarizer tasks
    are cancelled and the answer is streamed to the frontend.
    """
    agents_dicts = [a.model_dump(mode="json") for a in agents]
    providers_dicts = [p.model_dump(mode="json") for p in providers]

    # -- resolve models ------------------------------------------------------
    candidates = _enabled_candidates(agents_dicts, providers_dicts, secrets)
    if not candidates:
        yield _make_sse("thinking_complete", {"elapsed_ms": 0})
        yield _make_sse("final_delta", {"delta": "No enabled provider available. Add a provider key in Settings."})
        return

    summarizer_agent, summarizer_provider_dict = _pick_summarizer(
        agents_dicts, providers_dicts, secrets
    )

    client = OpenAICompatibleClient(secrets)

    # -- shared state --------------------------------------------------------
    timer = TimerContext()
    output_queue: asyncio.Queue[str] = asyncio.Queue()
    summarizer_tasks: set[asyncio.Task[None]] = set()

    think_buffer = ""
    char_offset = 0
    stage_index = 0

    await output_queue.put(_make_sse("thinking_active", {}))

    # -- main model worker ---------------------------------------------------
    async def _main_worker() -> None:
        nonlocal think_buffer, char_offset, stage_index
        answer_started = False

        try:
            async for chunk in _stream_thinking_first_working(
                client,
                candidates,
                question=question,
                agent_contexts=agent_contexts,
            ):
                if chunk["type"] == "think":
                    think_buffer += chunk["text"]

                    if (
                        not answer_started
                        and len(think_buffer) - char_offset >= THINK_CHUNK_SIZE
                        and summarizer_agent
                        and summarizer_provider_dict
                    ):
                        chunk_text = think_buffer[char_offset:]
                        current_stage = stage_index
                        char_offset = len(think_buffer)
                        stage_index += 1

                        task = asyncio.create_task(
                            _run_summarizer_task(
                                summarizer_agent,
                                summarizer_provider_dict,
                                secrets,
                                chunk_text,
                                current_stage,
                                output_queue,
                                (agent_contexts or {}).get(
                                    str(summarizer_agent.get("name") or ""), ""
                                ),
                            )
                        )
                        summarizer_tasks.add(task)

                elif chunk["type"] == "answer":
                    if not answer_started:
                        answer_started = True

                        # Cancel every in-flight summarizer
                        for t in list(summarizer_tasks):
                            t.cancel()
                        summarizer_tasks.clear()

                        # If the thinking was too short, skip summaries
                        if len(think_buffer) >= THINK_MIN_CHARS:
                            # Drain any already-completed summary events
                            # before signalling completion
                            pass  # summaries already pushed to queue
                        # else: no summaries were generated, just complete

                        await output_queue.put(
                            _make_sse("thinking_complete", {"elapsed_ms": timer.elapsed_ms})
                        )

                    await output_queue.put(
                        _make_sse("final_delta", {"delta": chunk["text"]})
                    )

        except asyncio.CancelledError:
            raise
        except ModelCallError as exc:
            await output_queue.put(
                _make_sse("thinking_complete", {"elapsed_ms": timer.elapsed_ms})
            )
            await output_queue.put(
                _make_sse("final_delta", {"delta": f"Model error: {_clip(str(exc))}"})
            )
        except Exception:
            await output_queue.put(
                _make_sse("thinking_complete", {"elapsed_ms": timer.elapsed_ms})
            )
            await output_queue.put(
                _make_sse(
                    "final_delta",
                    {"delta": "An unexpected error occurred during model streaming."},
                )
            )
        finally:
            if not answer_started:
                await output_queue.put(
                    _make_sse("thinking_complete", {"elapsed_ms": timer.elapsed_ms})
                )
            for t in list(summarizer_tasks):
                t.cancel()
            summarizer_tasks.clear()
            await output_queue.put(None)

    worker_task = asyncio.create_task(_main_worker())

    try:
        while True:
            item = await output_queue.get()
            if item is None:
                break
            yield item
    except GeneratorExit:
        # Client disconnected – cancel everything
        worker_task.cancel()
        for t in list(summarizer_tasks):
            t.cancel()
        summarizer_tasks.clear()
        raise
    finally:
        if not worker_task.done():
            worker_task.cancel()
        for t in list(summarizer_tasks):
            t.cancel()
        summarizer_tasks.clear()
