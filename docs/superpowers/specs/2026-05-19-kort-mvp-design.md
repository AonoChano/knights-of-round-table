# KORT MVP Design

Date: 2026-05-19

## Goal

Build the first end-to-end MVP of the Knights of the Round Table multi-model expert discussion product under the rules defined in `AGENTS.md`.

This MVP must:

- use `LangGraph` as the orchestration core
- keep all raw expert discussion hidden from users
- use a dedicated `Summarizer` model for visible staged summaries
- let users see only staged thinking summaries and the final answer
- use `LiteLLM` as the provider abstraction layer
- follow a `structured monolith` layout for fast development and long-term maintainability

## Scope

This specification covers the first MVP only.

Included:

- one runnable product subtree under `./kort`
- chat UI with ChatGPT-like visual structure
- fixed 4-round discussion flow
- provider management UI and backend profiles
- agent management UI and filesystem-backed agent definitions
- global skill selection and agent-local private skill support
- visible staged summaries with a collapsible thinking block and right-side thinking tree
- final answer generation
- SQLite-backed visible conversation persistence
- Docker Compose-based local deployment

Excluded from MVP:

- dynamic early stop discussion
- configurable 4-12 round discussions
- production-grade encrypted key storage
- multi-user auth
- raw discussion replay tooling
- GUI editing for agent-private skills

## Product Layout

All product code must live under a new isolated subtree:

```text
./kort/
  apps/
    web/
    api/
  packages/
    shared/
  runtime/
    agents/
    skills/
    data/
    providers/
  docs/
```

Rules:

- workspace root remains for docs, references, images, and non-product artifacts
- product code must not be added directly into the workspace root
- runtime content is separated from app code for clarity and handoff

## Architecture Choice

Chosen approach: `structured monolith`

Why:

- preserves clean boundaries without over-splitting into fragile services
- keeps development speed high for MVP
- makes hidden-CoT boundaries auditable
- supports future extension for more providers, more rounds, and stronger security

## High-Level Components

### Web App

`kort/apps/web`

Responsibilities:

- render chat sessions
- render staged thinking summaries only
- render final answers
- manage provider settings UI
- manage expert group UI
- render right-side thinking tree drawer
- call backend APIs only through visible projections

Stack:

- `Next.js 15`
- `Tailwind CSS`
- `shadcn/ui`

### API App

`kort/apps/api`

Responsibilities:

- orchestrate LangGraph runs
- manage provider profile resolution
- load agent definitions from filesystem
- resolve allowed global and private skills
- generate visible summaries through a dedicated summarizer node
- generate final answer through synthesizer or future answerer selector
- persist only visible projections and safe metadata

Stack:

- `FastAPI`
- `LangGraph`
- `LiteLLM`
- `Pydantic`
- `SQLite`

### Shared Package

`kort/packages/shared`

Responsibilities:

- define stable schemas for frontend/backend exchange
- mirror visible data contracts across Python and TypeScript
- prevent drift between API payloads and frontend expectations

Core shared contracts:

- provider profile
- agent definition view
- discussion stage summary
- thinking tree node
- final answer payload
- conversation list and detail views

## Discussion Orchestration

MVP uses a fixed 4-round state machine in LangGraph.

### Round Model

#### Round 0: Session Setup

- receive user question
- load active agents
- load provider profiles
- resolve skill visibility
- build graph state

#### Round 1: Expert Analysis

- each expert produces an internal analysis
- raw outputs remain internal only

#### Round 2: Critique

- critics or peer-review passes challenge prior reasoning
- identify missing evidence, weak claims, and errors

#### Round 3: Revision and Convergence

- experts revise positions based on critique
- graph state moves toward a converged internal result

#### Round 4: Summary and Final Answer

- `Summarizer` reads internal state and emits a visible structured summary
- `Synthesizer` emits the final user-facing answer

### Future Extension Point

MVP still reserves an `answerer_selector` decision point in architecture, even if the initial implementation always uses `Synthesizer`.

This preserves the path toward:

- cheap model output for simple tasks
- stronger final model output for complex tasks
- eventual early-stop decisions

## Hidden CoT Security Boundary

This is the core system rule.

### Raw Discussion Handling

Raw expert discussion includes:

- expert drafts
- critic drafts
- peer review content
- intermediate tool/skill reasoning text
- any unprojected internal chain content

These must:

- exist only inside `LangGraph state` during execution
- never be returned by API responses
- never be written into SQLite
- never be displayed in frontend components
- never be emitted in default logs

### Visible Projection Rule

Only these items may cross the user-facing boundary:

- user messages
- structured stage summaries from `Summarizer`
- final answer
- safe metadata like round number, stage status, expert count, timestamps, confidence

### Summary Style Rule

The summarizer must:

- present staged thinking as first-person internal thought
- hide the fact that multiple models are discussing
- avoid model names and expert names in visible thought content
- output only approved schema fields

### Validation Rule

Every visible summary and final answer must pass `Pydantic` validation before persistence or API return.

If validation fails:

- do not fall back to raw internal content
- return a safe stage failure status
- allow retry at the orchestration layer

### Logging Rule

Default logs must not include:

- API keys
- raw prompts and raw completions for expert discussion
- full stack traces returned to UI

Development logging must prefer:

- run ids
- stage names
- provider profile ids
- latency
- token/cost metadata when available
- validation results

## Provider Model

MVP provider support must be designed around `LiteLLM` with domestic common providers treated as first-class targets.

Expected first-class coverage:

- `OpenAI`
- `Anthropic`
- `DeepSeek`
- `BigModel / Zhipu`
- `Kimi`
- `MiniMax`
- `Ollama`

### Development Key Strategy

For MVP development:

- secrets come from `.env`
- runtime and database store only non-secret provider metadata

Future production hardening is deferred.

### Provider Profile

Provider profiles are safe configuration records without secrets.

Suggested fields:

- `provider_id`
- `label`
- `provider_type`
- `base_url`
- `api_style`
- `default_model`
- `model_options`
- `enabled`
- `capabilities`
- `env_key_name`

The actual secret is resolved from the corresponding environment variable at runtime.

### Connectivity Test

Each provider card supports an isolated connectivity test.

Rules:

- test only the current card
- isolate frontend state by provider profile id
- return concise human-readable results
- never expose raw secrets or full backend traces

## Agent and Skill Filesystem Protocol

### Global Runtime Locations

```text
kort/runtime/agents/
kort/runtime/skills/
kort/runtime/providers/
kort/runtime/data/
```

### Agent Folder Rule

Each agent is a folder under:

```text
kort/runtime/agents/<agent-name>/
```

Where `<agent-name>`:

- must use lowercase English letters and hyphens only
- acts as the stable id and folder name

### Agent Definition

Each agent contains:

```text
agent.yaml
skills/   # optional, private to this agent
```

Suggested `agent.yaml` fields:

- `name`
- `nickname`
- `role`
- `provider_profile`
- `model`
- `system_prompt`
- `allowed_global_skills`
- `disabled_global_skills`

### Global Skills

Global skills live under:

```text
kort/runtime/skills/
```

These are selectable in GUI.

### Private Skills

Private agent-only skills live under:

```text
kort/runtime/agents/<agent-name>/skills/
```

Rules:

- they are visible only to that agent
- they are not editable in GUI for MVP
- they require explicit local configuration by advanced users

### Agent Loading Validation

Backend agent loading must validate:

1. `agent.yaml` schema correctness
2. referenced provider profile exists
3. referenced skills exist and permission intersections are valid

Invalid agents must not crash the whole product. They should surface as configuration errors.

### Handoff Doc Requirement

The project must include a `How To Make A Agent.md` guide for manual agent creation and import.

This guide should explain:

- folder naming
- yaml schema
- nickname vs stable name
- global skill allow/deny behavior
- private skill folder behavior

## Frontend UX

The UI direction should closely follow the supplied reference:

- restrained, minimal, ChatGPT-like layout
- left conversation sidebar
- central answer area
- bottom input composer
- lower-left expert status card
- ChatGPT-style settings center
- right-side thinking tree drawer

### Main Chat Layout

Left side:

- brand/app entry
- new conversation
- conversation history
- expert group status card
- user card and settings entry

Center:

- user messages
- staged summary blocks
- final answer
- composer with expert-group related actions

Right side:

- hidden by default
- opens on demand as a thinking tree drawer

### Thinking Block UX

Visible thinking is not raw thought.

Rules:

- block is collapsed by default
- show bold title plus a short snippet of about 20 words
- allow click to open the right-side tree drawer
- use a subtle breathing cue on the thought teaser
- never expose raw expert discussion

### Settings Center

Settings center should use a left navigation rail and right detail panel.

MVP sections:

- `General`
- `Providers`
- `Expert Group`
- `Skills`
- `Data & Logs`

### Providers Page

Requirements:

- multiple provider cards
- isolated API key inputs
- isolated save and test actions
- convenient human workflow
- support custom provider entries

### Expert Group Page

Requirements:

- card list of experts
- click card to edit details
- add flow asks for `name` then `nickname`
- details page edits provider, model, prompt, and skill permissions

### Expert Status Card

Visible fields only:

- stage status
- round progress
- expert count
- access to configuration

No internal text is shown here.

## Persistence Model

SQLite stores visible state only.

Persisted items:

- conversation metadata
- user messages
- stage summaries
- thinking tree projections
- final answers
- provider profiles without secrets
- safe agent metadata cache if needed

Not persisted:

- raw expert internal messages
- critique drafts
- internal chain content
- API keys

## API Shape

The backend should expose projection-oriented APIs only.

Suggested API groups:

- conversation list
- conversation detail
- send message / start run
- run status stream or polling
- provider profile CRUD
- provider connectivity test
- expert list / detail / create / update
- visible skill list

The conversation detail response should only contain visible projections.

## Data Flow

1. frontend sends user prompt
2. API creates a conversation run
3. LangGraph executes internal discussion rounds
4. after each visible stage, backend emits a summary projection
5. frontend appends timeline/thinking blocks
6. final answer projection is emitted
7. visible projections are persisted for reload

Page refresh must reconstruct from projections only.

## Testing and Acceptance Criteria

### Security

- no raw expert discussion in API, logs, or SQLite
- no API keys leaked to logs or database

### Contract

- all visible outputs validated with `Pydantic`

### Functionality

- user can configure providers
- user can create experts
- user can run a fixed 4-round discussion
- user can see staged summaries
- user can see a final answer

### Compatibility

At minimum, validate:

- one OpenAI-compatible path
- Anthropic
- DeepSeek-style OpenAI-compatible path
- Ollama

Other domestic providers should fit through LiteLLM profile strategy.

### UI

- desktop layout complete and usable
- mobile layout does not break core chat and settings flows

### Maintainability

- boundaries documented
- runtime directory protocol documented
- product tree remains isolated under `./kort`

## Implementation Notes

The implementation should begin by scaffolding the `./kort` subtree and shared schemas first, then build:

1. provider profile system
2. agent loader and agent filesystem protocol
3. LangGraph orchestration and visible projection layer
4. API endpoints
5. frontend shell and settings center
6. chat timeline and thinking drawer
7. Docker Compose integration

## Open Deferred Items

Deferred after MVP:

- encrypted local secret storage
- configurable round count
- early stop logic
- dynamic answerer selection
- richer skill GUI
- multi-user support
