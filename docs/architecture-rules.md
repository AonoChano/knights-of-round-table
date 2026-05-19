# KORT Architecture Rules

Date: 2026-05-19

This document is a stable implementation and handoff guide for the KORT MVP.

It complements the formal design spec in:

- `docs/superpowers/specs/2026-05-19-kort-mvp-design.md`

## Non-Negotiable Rules

### 1. Product Code Isolation

All actual software code must live under `./kort`.

Do not place product application code in the workspace root.

Allowed top-level root content:

- docs
- screenshots
- notes
- logs
- references

### 2. Hidden CoT Boundary

Raw expert discussion is internal-only.

Never:

- expose raw expert messages through API
- store raw expert messages in SQLite
- render raw expert messages in frontend
- print raw expert discussion in default logs

Only these may cross the user boundary:

- user input
- summarizer-produced staged summaries
- final answer
- safe metadata

### 3. Summarizer-Only Visible Thinking

Any visible "thinking" UI must be driven only by a validated summarizer projection.

The UI must never read internal graph messages directly.

### 4. Schema-First Contracts

Every visible payload must be schema-validated.

Backend:

- use `Pydantic`

Frontend:

- mirror backend contract types exactly

If a payload does not validate, fail safely. Do not leak internal content as fallback.

### 5. Runtime Content Separation

Keep runtime content separate from code:

```text
kort/runtime/agents/
kort/runtime/skills/
kort/runtime/providers/
kort/runtime/data/
```

Do not mix these with app source files.

### 6. Provider Secret Rule

During MVP development, secrets come from `.env`.

Do not:

- write API keys into YAML
- write API keys into SQLite
- return API keys from API responses

### 7. Agent Naming Rule

Agent stable name:

- lowercase English letters and hyphens only
- used as folder name
- used as stable id

Agent nickname:

- human-facing label
- may be more flexible

Do not use nickname as filesystem identity.

## Product Tree

Recommended structure:

```text
kort/
  apps/
    web/
    api/
  packages/
    shared/
  runtime/
    agents/
    skills/
    providers/
    data/
  docs/
```

## App Responsibilities

### `apps/web`

Owns:

- chat shell
- session sidebar
- settings center
- expert group management UI
- thinking tree drawer

Must not own:

- orchestration logic
- provider secret resolution
- raw expert discussion state

### `apps/api`

Owns:

- LangGraph orchestration
- provider resolution
- agent and skill loading
- visible projection generation
- persistence

Must not:

- persist raw expert discussion
- expose raw internal graph messages

### `packages/shared`

Owns:

- stable cross-app contracts
- shared ids and shape definitions

Keep these contracts small and versionable.

## Agent Protocol

Each agent directory:

```text
runtime/agents/<agent-name>/
  agent.yaml
  skills/   # optional private skills
```

`agent.yaml` should include:

- `name`
- `nickname`
- `role`
- `provider_profile`
- `model`
- `system_prompt`
- `allowed_global_skills`
- `disabled_global_skills`

Validation is required before agent activation.

Invalid agent definitions should surface as config errors, not fatal startup crashes.

## Skill Visibility Rules

### Global Skills

Path:

```text
runtime/skills/
```

Visible to GUI and available for allow/deny selection.

### Private Agent Skills

Path:

```text
runtime/agents/<agent-name>/skills/
```

Rules:

- available only to that agent
- not shown in MVP GUI
- configured by filesystem only

## Provider Profile Rules

Provider profiles are non-secret metadata records.

They should describe:

- provider type
- base URL
- API style
- default model
- supported capabilities
- environment variable name for secret lookup

Frontend state must be isolated per provider card to avoid API key field contamination.

## Frontend Interaction Rules

### Chat Layout

The default chat view should feel ChatGPT-like:

- restrained visual language
- strong spacing
- left session rail
- centered content area
- bottom composer

### Thinking UI

Thinking blocks:

- collapsed by default
- preview title plus short snippet
- open right-side thinking tree drawer on interaction

The right-side drawer uses only summarizer-provided tree nodes.

### Settings

Use a left-side navigation layout.

Core sections:

- general
- providers
- expert group
- skills
- data and logs

## Persistence Rules

SQLite may store:

- conversations
- visible summaries
- final answers
- safe metadata
- provider profiles without secrets

SQLite may not store:

- raw expert discussion
- prompt internals
- API keys

## Logging Rules

Default logs should prefer structured metadata:

- run id
- conversation id
- stage
- provider profile id
- agent id
- latency
- validation outcome

Avoid logging prompt bodies and completion bodies for expert discussion.

## Testing Rules

Minimum required test categories:

- provider profile validation
- agent yaml validation
- skill resolution rules
- visible summary schema validation
- hidden CoT leak prevention on API responses
- frontend settings state isolation

## Handoff Rules

Any future contributor should be able to understand the system by reading:

1. design spec
2. this rules document
3. agent creation guide

If implementation diverges from these rules, update the docs in the same change.
