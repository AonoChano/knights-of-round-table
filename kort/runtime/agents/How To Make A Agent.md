# How To Make A Agent

## Folder Rule

Each agent must live in:

`runtime/agents/<agent-name>/`

`<agent-name>` must use lowercase English letters and hyphens only.

## Required File

Each agent needs an `agent.yaml`.

Example:

```yaml
name: research-lead
nickname: Research Lead
role: expert
provider_profile: deepseek
model: deepseek-chat
system_prompt: |
  You are the lead research expert.
allowed_global_skills:
  - structured-analysis
  - evidence-grounding
disabled_global_skills:
  - stage-summary-projection
```

## Fields

- `name`: stable id and folder name
- `nickname`: display name in GUI
- `role`: `expert`, `critic`, `summarizer`, or `synthesizer`
- `provider_profile`: provider profile id from `runtime/providers/profiles.json`
- `model`: model name for that provider
- `system_prompt`: system prompt for this agent
- `allowed_global_skills`: reusable capability modules the agent can access
- `disabled_global_skills`: global skills explicitly denied

## Role vs Skill

`role` and `system_prompt` define who the agent is.

`Skills` define reusable ways of working, such as:

- structured analysis
- evidence grounding
- gap analysis
- stage summary projection
- hidden CoT guarding

Do not turn persona labels like `expert` or `critic` into Skills.

## Private Skills

If you want skills visible only to one agent, create:

`runtime/agents/<agent-name>/skills/`

Each private skill should be a subdirectory with its own `SKILL.md`.

These private skills are not edited in the MVP GUI.
