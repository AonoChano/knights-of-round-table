from __future__ import annotations

from pathlib import Path

import yaml

from .schemas import AgentDefinition, AgentView


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

    def list_agents(self) -> list[AgentView]:
        if not self.agents_root.exists():
            return []

        global_skills = set(self.list_global_skills())
        results: list[AgentView] = []

        for agent_dir in sorted(item for item in self.agents_root.iterdir() if item.is_dir()):
            config_path = agent_dir / "agent.yaml"
            if not config_path.exists():
                continue

            content = yaml.safe_load(config_path.read_text(encoding="utf-8"))
            definition = AgentDefinition.model_validate(content)
            private_root = agent_dir / "skills"
            private_count = 0

            if private_root.exists():
                private_count = sum(
                    1 for item in private_root.iterdir() if item.is_dir() and (item / "SKILL.md").exists()
                )

            results.append(
                AgentView(
                    name=definition.name,
                    nickname=definition.nickname,
                    role=definition.role,
                    provider_profile=definition.provider_profile,
                    model=definition.model,
                    allowed_global_skills=[
                        item for item in definition.allowed_global_skills if item in global_skills
                    ],
                    disabled_global_skills=[
                        item for item in definition.disabled_global_skills if item in global_skills
                    ],
                    private_skill_count=private_count,
                )
            )

        return results

    def list_definitions(self) -> list[AgentDefinition]:
        if not self.agents_root.exists():
            return []

        definitions: list[AgentDefinition] = []
        for agent_dir in sorted(item for item in self.agents_root.iterdir() if item.is_dir()):
            config_path = agent_dir / "agent.yaml"
            if not config_path.exists():
                continue

            content = yaml.safe_load(config_path.read_text(encoding="utf-8"))
            definitions.append(AgentDefinition.model_validate(content))

        return definitions
