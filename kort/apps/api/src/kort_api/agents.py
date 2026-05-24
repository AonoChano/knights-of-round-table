from __future__ import annotations

import logging
import re
import shutil
from pathlib import Path

import yaml
from pydantic import ValidationError

from .schemas import AgentCreateRequest, AgentDefinition, AgentUpdateRequest, AgentView

logger = logging.getLogger(__name__)

SYSTEM_AGENTS: set[str] = {"summarizer-main", "synthesizer-main"}
AGENT_NAME_RE = re.compile(r"^[a-z][a-z0-9-]*$")


class AgentLoader:
    def __init__(self, runtime_root: Path) -> None:
        self.agents_root = runtime_root / "agents"
        self.skills_root = runtime_root / "skills"

    def list_global_skills(self) -> list[str]:
        if not self.skills_root.exists():
            return []
        return sorted(
            item.name for item in self.skills_root.iterdir() if item.is_dir() and (item / "SKILL.md").exists()
        )

    # ------------------------------------------------------------------
    # internal helpers
    # ------------------------------------------------------------------

    def _read_definition(self, agent_dir: Path) -> AgentDefinition | None:
        config_path = agent_dir / "agent.yaml"
        if not config_path.exists():
            return None
        try:
            content = yaml.safe_load(config_path.read_text(encoding="utf-8"))
            return AgentDefinition.model_validate(content)
        except (yaml.YAMLError, ValidationError) as exc:
            logger.warning("Skipping invalid agent config %s: %s", agent_dir.name, exc)
            return None

    def _count_private_skills(self, agent_dir: Path) -> int:
        private_root = agent_dir / "skills"
        if not private_root.exists():
            return 0
        return sum(
            1 for item in private_root.iterdir() if item.is_dir() and (item / "SKILL.md").exists()
        )

    def _build_agent_view(self, definition: AgentDefinition, agent_dir: Path) -> AgentView:
        global_skills = set(self.list_global_skills())
        return AgentView(
            name=definition.name,
            nickname=definition.nickname,
            role=definition.role,
            provider_profile=definition.provider_profile,
            model=definition.model,
            system_prompt=definition.system_prompt,
            allowed_global_skills=[
                item for item in definition.allowed_global_skills if item in global_skills
            ],
            disabled_global_skills=[
                item for item in definition.disabled_global_skills if item in global_skills
            ],
            private_skill_count=self._count_private_skills(agent_dir),
            priority=definition.priority,
        )

    @staticmethod
    def _write_agent_yaml(definition: AgentDefinition, target_path: Path) -> None:
        data: dict = {
            "name": definition.name,
            "nickname": definition.nickname,
            "role": definition.role,
            "provider_profile": definition.provider_profile,
            "model": definition.model,
            "system_prompt": definition.system_prompt,
            "allowed_global_skills": definition.allowed_global_skills,
            "disabled_global_skills": definition.disabled_global_skills,
            "priority": definition.priority,
        }
        target_path.write_text(
            yaml.dump(data, default_flow_style=False, allow_unicode=True, sort_keys=False),
            encoding="utf-8",
        )

    # ------------------------------------------------------------------
    # public methods
    # ------------------------------------------------------------------

    def list_agents(self) -> list[AgentView]:
        if not self.agents_root.exists():
            return []

        results: list[AgentView] = []
        for agent_dir in sorted(item for item in self.agents_root.iterdir() if item.is_dir()):
            definition = self._read_definition(agent_dir)
            if definition is None:
                continue
            results.append(self._build_agent_view(definition, agent_dir))

        return results

    def list_definitions(self) -> list[AgentDefinition]:
        if not self.agents_root.exists():
            return []

        definitions: list[AgentDefinition] = []
        for agent_dir in sorted(item for item in self.agents_root.iterdir() if item.is_dir()):
            definition = self._read_definition(agent_dir)
            if definition is not None:
                definitions.append(definition)

        return definitions

    def create_agent(self, data: AgentCreateRequest) -> AgentView:
        agent_dir = self.agents_root / data.name
        if agent_dir.exists():
            raise FileExistsError(f"Agent '{data.name}' already exists")

        definition = AgentDefinition(
            name=data.name,
            nickname=data.nickname,
            role=data.role,
            provider_profile=data.provider_profile,
            model=data.model,
            system_prompt=data.system_prompt,
            allowed_global_skills=data.allowed_global_skills,
            disabled_global_skills=data.disabled_global_skills,
            priority=data.priority,
        )

        agent_dir.mkdir(parents=True, exist_ok=False)
        try:
            self._write_agent_yaml(definition, agent_dir / "agent.yaml")
        except Exception:
            shutil.rmtree(agent_dir, ignore_errors=True)
            raise

        return self._build_agent_view(definition, agent_dir)

    def update_agent(self, name: str, data: AgentUpdateRequest) -> tuple[AgentView | None, str]:
        if not AGENT_NAME_RE.fullmatch(name):
            return None, "not_found"
        if name in SYSTEM_AGENTS:
            return None, "system_protected"

        agent_dir = self.agents_root / name
        existing = self._read_definition(agent_dir)
        if existing is None:
            return None, "not_found"

        update_data = data.model_dump(exclude_none=True)
        if not update_data:
            return self._build_agent_view(existing, agent_dir), ""

        merged = existing.model_copy(update=update_data)
        self._write_agent_yaml(merged, agent_dir / "agent.yaml")
        return self._build_agent_view(merged, agent_dir), ""

    def delete_agent(self, name: str) -> tuple[bool, str]:
        if not AGENT_NAME_RE.fullmatch(name):
            return False, "not_found"
        if name in SYSTEM_AGENTS:
            return False, "system_protected"

        agent_dir = self.agents_root / name
        if not agent_dir.exists():
            return False, "not_found"

        shutil.rmtree(agent_dir)
        return True, ""
