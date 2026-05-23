from __future__ import annotations

import json
import re
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Annotated, TypedDict

from langgraph.graph import END, StateGraph

from .model_client import ModelCallError, OpenAICompatibleClient
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


def _agent_by_role(agents: list[dict], role: str) -> list[dict]:
    return [a for a in agents if a.get("role") == role]


def _provider_by_id(providers: list[dict], provider_id: str) -> dict | None:
    for p in providers:
        if p.get("provider_id") == provider_id:
            return p
    return None


def _call_model(
    agent: dict,
    provider: dict,
    system_prompt: str,
    user_prompt: str,
    secrets: dict[str, str],
    *,
    disable_thinking: bool = False,
) -> str:
    profile = ProviderProfile.model_validate(provider)
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
    profile = ProviderProfile.model_validate(provider)
    client = OpenAICompatibleClient(secrets)
    yield from client.stream_chat(provider=profile, prompt=user_prompt, system_prompt=system_prompt, disable_thinking=disable_thinking)


def _find_enabled_candidate(
    agents: list[dict],
    providers: list[dict],
    secrets: dict[str, str],
    preferred_roles: tuple[str, ...] = ("synthesizer", "expert", "summarizer", "critic"),
) -> tuple[dict, dict] | None:
    candidates: list[tuple[dict, dict, int]] = []
    for role in preferred_roles:
        for agent in agents:
            if agent.get("role") != role:
                continue
            provider = _provider_by_id(providers, agent.get("provider_profile", ""))
            if not provider or not provider.get("enabled"):
                continue
            has_key = bool(secrets.get(provider["provider_id"], "").strip())
            if provider.get("api_style") == "openai" and (has_key or provider.get("provider_type") == "ollama"):
                candidates.append((agent, provider, agent.get("priority", 0)))
    if not candidates:
        return None
    candidates.sort(key=lambda item: item[2], reverse=True)
    best = candidates[0]
    return best[0], best[1]


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
            system_prompt=summarizer_agent.get("system_prompt", ""),
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
                system_prompt=expert.get("system_prompt", ""),
                user_prompt=prompt,
                secrets=secrets,
            )
        except ModelCallError:
            output = f"[{nickname} was unavailable]"

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

    combined_outputs = "\n\n---\n\n".join(
        f"[{name}]:\n{text}" for name, text in expert_outputs.items()
    )

    def _invoke_critic(critic: dict) -> tuple[str, str]:
        name = critic.get("name", "unknown")
        nickname = critic.get("nickname", name)
        provider = _provider_by_id(providers, critic.get("provider_profile", ""))
        if not provider:
            return nickname, f"[{nickname} had no valid provider]"

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
                system_prompt=critic.get("system_prompt", ""),
                user_prompt=prompt,
                secrets=secrets,
            )
        except ModelCallError:
            review = f"[{nickname} review unavailable]"

        return nickname, review

    transcript_entries: list[str] = []

    with ThreadPoolExecutor(max_workers=len(critics)) as executor:
        future_map = {executor.submit(_invoke_critic, c): c for c in critics}
        for future in as_completed(future_map):
            nickname, review = future.result()
            transcript_entries.append(f"[{nickname} (Round {current_round + 1} review)]:\n{review}")

    return {
        "critic_reviews": {},
        "discussion_transcript": transcript_entries,
    }


def _decide_continue(state: DiscussionState) -> dict:
    current = state.get("current_round", 0)
    max_rounds = state.get("max_rounds", 4)
    return {"should_continue": current < max_rounds}


def _produce_final_answer(state: DiscussionState) -> dict:
    agents = state["agents"]
    providers = state["providers"]
    secrets = state["secrets"]
    question = state["question"]

    candidate = _find_enabled_candidate(agents, providers, secrets)
    if not candidate:
        return {
            "final_answer_text": (
                "No enabled OpenAI-compatible provider with a saved API key is available. "
                "Add a provider key in Settings, then try again."
            )
        }

    agent, provider = candidate
    transcript = "\n\n---\n\n".join(state.get("discussion_transcript", []))
    stage_summaries = state.get("stage_summaries", [])

    summary_context = ""
    for s in stage_summaries:
        if isinstance(s, dict):
            summary_context += f"\n### {s.get('title', '')}\n{s.get('body', '')}"

    prompt = (
        "Answer the user's question directly. Keep the answer clear, structured, and practical. "
        "Do not mention internal experts, orchestration, hidden reasoning, or chain-of-thought.\n\n"
        f"User question:\n{question.strip()}"
    )

    if transcript.strip():
        prompt += (
            "\n\nContext from prior analysis (use this to inform your answer, "
            "but do not reference it directly):\n"
            f"{summary_context[-3000:]}"
        )

    try:
        body = _call_model(
            agent=agent,
            provider=provider,
            system_prompt=agent.get("system_prompt", ""),
            user_prompt=prompt,
            secrets=secrets,
            disable_thinking=True,
        )
    except ModelCallError:
        body = "The final response could not be generated. Please check your provider configuration."

    return {"final_answer_text": body}


def _stream_final_answer(state: DiscussionState) -> Iterator[str]:
    agents = state["agents"]
    providers = state["providers"]
    secrets = state["secrets"]
    question = state["question"]

    candidate = _find_enabled_candidate(agents, providers, secrets)
    if not candidate:
        yield "No enabled provider available. Add a provider key in Settings."
        return

    agent, provider = candidate
    stage_summaries = state.get("stage_summaries", [])
    summary_context = ""
    for s in stage_summaries:
        if isinstance(s, dict):
            summary_context += f"\n### {s.get('title', '')}\n{s.get('body', '')}"

    prompt = (
        "Answer the user's question directly. Keep the answer clear, structured, and practical. "
        "Do not mention internal experts, orchestration, hidden reasoning, or chain-of-thought.\n\n"
        f"User question:\n{question.strip()}"
    )

    if summary_context.strip():
        prompt += (
            "\n\nContext from prior analysis (use this to inform your answer, "
            "but do not reference it directly):\n"
            f"{summary_context[-3000:]}"
        )

    try:
        profile = ProviderProfile.model_validate(provider)
        client = OpenAICompatibleClient(secrets)
        for chunk in client.stream_chat(
            provider=profile,
            prompt=prompt,
            system_prompt=agent.get("system_prompt", ""),
            disable_thinking=True,
        ):
            yield chunk
    except ModelCallError:
        yield "The final response could not be generated."


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
    }

    for event in compiled.stream(initial_state, stream_mode="updates"):
        for _node_name, node_output in event.items():
            if not isinstance(node_output, dict):
                continue

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

    final_state = compiled.invoke(initial_state)
    final_text = final_state.get("final_answer_text", "")

    yield {
        "type": "final",
        "body": final_text,
    }


def run_discussion_stream(
    question: str,
    agents: list[AgentDefinition],
    providers: list[ProviderProfile],
    secrets: dict[str, str],
    max_rounds: int = 4,
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
    }

    def _sse(event: str, payload: dict) -> str:
        return f"event: {event}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"

    if max_rounds <= 0:
        yield _sse("thinking_complete", {})
        for chunk in _stream_final_answer(state):
            yield _sse("final_delta", {"delta": chunk})
        return

    while True:
        yield _sse("talking_active", {})
        expert_output = _experts_think(state)
        state = _merge_state(state, expert_output)

        critic_output = _critics_review(state)
        state = _merge_state(state, critic_output)

        round_number = state.get("current_round", 0) + 1
        sid = f"summary-round-{round_number}"

        summarizer_agent, provider_dict = _pick_summarizer(
            state["agents"], state["providers"], secrets
        )
        transcript = "\n\n---\n\n".join(state.get("discussion_transcript", []))

        if summarizer_agent and provider_dict and transcript.strip():
            prompt = _build_summarizer_prompt(question, transcript)

            yield _sse("summary_start", {"id": sid})

            streamed_text = ""
            profile = ProviderProfile.model_validate(provider_dict)
            client = OpenAICompatibleClient(secrets)
            try:
                for chunk in client.stream_chat(
                    provider=profile,
                    prompt=prompt,
                    system_prompt=summarizer_agent.get("system_prompt", ""),
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
                    {"id": f"{sid}-node", "title": title, "summary": body},
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

    yield _sse("thinking_complete", {})

    for chunk in _stream_final_answer(state):
        yield _sse("final_delta", {"delta": chunk})