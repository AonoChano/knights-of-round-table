"""Memory recording hooks for completed conversation turns."""

from __future__ import annotations

import logging
import threading

from .providers import provider_is_reachable
from .schemas import AgentDefinition, DelegationMetadata, ProviderProfile, StageSummary

logger = logging.getLogger(__name__)


class ConversationMemoryMixin:
    def _remember_round(
        self,
        *,
        conversation_id: str,
        question: str,
        final_answer: str,
        summaries: list[StageSummary],
        delegation: DelegationMetadata | None,
        agents: list[AgentDefinition],
        providers: list[ProviderProfile],
        secrets: dict[str, str],
    ) -> None:
        """Persist a visible-only episode card, then let at most one agent consolidate it."""
        if self.memory_store is None or delegation is None:
            return

        role_by_name = {agent.name: agent.role for agent in agents}
        participants: list[str] = []
        for delegated in delegation.agents:
            if delegated.role == "summarizer" or role_by_name.get(delegated.name) == "summarizer":
                continue
            if delegated.name not in participants:
                participants.append(delegated.name)
        if not participants:
            return

        try:
            episode_id = self.memory_store.record_round(
                conversation_id=conversation_id,
                question=question,
                final_answer=final_answer,
                summaries=summaries,
                agents=participants,
            )
        except Exception:
            logger.exception("memory.record_failed conversation_id=%s", conversation_id)
            return
        if not episode_id or not self.memory_store.auto_dream:
            return

        definitions = {agent.name: agent for agent in agents}
        for name in participants:
            try:
                if not self.memory_store.should_dream(name):
                    continue
                definition = definitions.get(name)
                provider = next(
                    (
                        item
                        for item in providers
                        if definition is not None and item.provider_id == definition.provider_profile
                    ),
                    None,
                )
                if definition is None or provider is None or not provider_is_reachable(provider, secrets):
                    continue
                profile = provider.model_copy(update={"default_model": definition.model})
            except Exception:
                logger.exception("memory.dream_prepare_failed agent=%s", name)
                continue

            thread = threading.Thread(
                target=self._dream_agent,
                args=(name, profile, dict(secrets)),
                daemon=True,
            )
            thread.start()
            break

    def _dream_agent(self, agent_name: str, provider: ProviderProfile, secrets: dict[str, str]) -> None:
        try:
            assert self.memory_store is not None
            report = self.memory_store.dream(agent_name, provider, secrets, apply=True)
            logger.info(
                "memory.dream_applied agent=%s stats=%s",
                agent_name,
                report.get("stats"),
            )
        except Exception:
            logger.exception("memory.dream_failed agent=%s", agent_name)
