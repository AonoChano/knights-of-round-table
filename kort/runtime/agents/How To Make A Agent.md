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

## Optional Persona

An agent may carry a `persona.md` next to `agent.yaml`:

```markdown
---
nickname: 档案员
lens: 连续性与来源
voice: 冷静、具体
hobbies: [装帧, 城市徒步, 泡茶]
interests: [版本史, 档案馆]
---

这里写这个人的经历、信念和说话习惯。
```

The persona is appended to `system_prompt` as an identity block. Keep the body
short: it is clipped to roughly 150 tokens. Hobbies are for choosing analogies,
not for hijacking the discussion.

## Memory Files

Agents keep their memory outside the repo history:

- `runtime/memory_seed/shared.jsonl` — user-level seed facts shared by everyone
- `runtime/agents/<agent-name>/memory_seed.jsonl` — private seed facts
- `runtime/agents/<agent-name>/self_seed.md` — initial self narrative
- `runtime/memory/` — runtime memory, git-ignored

On first use the seed files are copied into `runtime/memory/`; afterwards the
runtime copy is authoritative. Do not edit `runtime/memory/` by hand unless you
are repairing data.

Memory has three layers:

1. **Episodes** — one card per completed round, built only from the question,
   the visible final answer and visible stage summaries. Raw expert transcripts
   are never stored.
2. **Facts** — shared user facts plus private facts each agent believes.
3. **Hunches / self narrative** — low-confidence associations and a slowly
   changing first-person story produced by consolidation ("dreaming").

### Dreaming

A dream reads recent episodes and active facts, then writes a strict-JSON
proposal: new facts (each must cite an `E-` episode id), fact updates,
hunches, soft-forget requests and a new self narrative. Before applying a dream
the store snapshots the agent folder. Nothing is overwritten in place.
Unevidenced claims are downgraded to hunches. Pinned facts cannot be archived.
If two agents independently dream the same fact, it is promoted to shared memory
as a consensus fact; a single agent cannot rewrite shared memory.

Auto-dream runs at most one agent per completed round, and only when that agent
has enough new episodes or enough elapsed time. Configure it in `.env`:

```dotenv
MEMORY_BUDGET_TOKENS=320
MEMORY_AUTO_DREAM=true
MEMORY_DREAM_MIN_EPISODES=6
MEMORY_DREAM_MIN_HOURS=24
```

## Prompt Assembly

The final system prompt is built in this order, stable first for prompt caching:

`system_prompt` → persona → self narrative → skills → retrieved memory → memory discipline

Each block has a hard token cap. Summarizers never receive user memory, because
their output is user-visible. Only summaries of what the user could already see
are allowed to become memories.

