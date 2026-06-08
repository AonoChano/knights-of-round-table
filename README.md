<div align="center">
  <img src="kort/apps/web/public/kort-readme-logo.svg" alt="KORT logo" width="300" height="96" />

  <h1>Knights of the Round Table</h1>

  <p>
    A hidden-CoT, multi-model expert panel for structured AI discussion.
  </p>

  <p>
    <a href="README.zh-CN.md">简体中文</a>
    ·
    <a href="#quick-start">Quick start</a>
    ·
    <a href="#api-surface">API</a>
    ·
    <a href="kort/docs/architecture-rules.md">Architecture rules</a>
  </p>

  <p>
    <img alt="Backend" src="https://img.shields.io/badge/backend-FastAPI-009688?style=flat-square" />
    <img alt="Frontend" src="https://img.shields.io/badge/frontend-Next.js_15-111111?style=flat-square" />
    <img alt="Orchestration" src="https://img.shields.io/badge/orchestration-LangGraph-2F6FEB?style=flat-square" />
    <img alt="Privacy boundary" src="https://img.shields.io/badge/Hidden_CoT-visible_summaries_only-6A5ACD?style=flat-square" />
  </p>
</div>

---

## What KORT Is

KORT is a web chat application where a user's question can be routed through a panel of AI agents:

1. Expert agents reason independently.
2. Critic agents review and challenge the work.
3. The graph may continue for multiple rounds.
4. A summarizer projects only user-visible stage summaries.
5. A synthesizer produces the final answer.

The product boundary is intentional: raw expert discussion, provider reasoning content, and internal transcripts stay inside backend runtime state. Users see the visible projection only: staged thinking summaries and the final answer.

## Highlights

| Area | Current capability |
| --- | --- |
| Chat UX | ChatGPT-like shell with sidebar history, fixed composer, streamed answer output, and Markdown/KaTeX rendering |
| Thinking UX | Collapsed visible thinking row, right-side thinking drawer, completed-thinking state, and structured summary tree nodes |
| Orchestration | LangGraph discussion flow with experts, critics, summarizer, synthesizer, and configurable discussion depth |
| Request routing | Simple prompts can be routed away from full panel orchestration to avoid overreaction |
| Agents | File-backed agents with roles, prompts, provider profile, priority, and Skill access controls |
| Providers | Runtime provider profiles, local key status, connectivity checks, and OpenAI-compatible model calls |
| Persistence | Visible conversation projections are persisted and reloadable; raw hidden discussion is not exposed |

## Quick Start

The fastest path is Docker Compose:

```bash
docker compose up --build
```

Then open:

| Service | URL |
| --- | --- |
| Web app | <http://localhost:3000> |
| API | <http://localhost:8000> |
| Health check | <http://localhost:8000/health> |

## Local Development

### Backend

```bash
cd kort/apps/api
pip install -e ".[dev]"
python -m uvicorn kort_api.main:app --reload --port 8000
```

Optional `.env` values:

```env
RUNTIME_ROOT=../../runtime
DATA_ROOT=../../runtime/data
PROVIDERS_FILE=../../runtime/providers/profiles.json
CONVERSATION_DB=../../runtime/data/conversations.json
```

### Frontend

```bash
cd kort/apps/web
pnpm install
pnpm dev
```

The web app expects `NEXT_PUBLIC_API_BASE_URL` to point at the backend. Docker Compose sets it to `http://localhost:8000`.

## Project Layout

```text
kort/
├── apps/
│   ├── api/                    # FastAPI backend
│   │   ├── src/kort_api/
│   │   │   ├── app.py          # API routes
│   │   │   ├── agents.py       # File-backed agent loader and CRUD
│   │   │   ├── conversations.py # Visible conversation store and SSE service
│   │   │   ├── model_client.py # OpenAI-compatible model client
│   │   │   ├── orchestration.py # LangGraph discussion runtime
│   │   │   ├── providers.py    # Provider profiles and local secret status
│   │   │   ├── request_router.py
│   │   │   └── schemas.py      # Pydantic contracts
│   │   └── tests/
│   └── web/                    # Next.js 15 frontend
│       └── app/
│           ├── page.tsx        # Chat shell, settings, sidebar, drawer
│           ├── locale.ts       # Locale access
│           └── globals.css     # Product styling
├── runtime/
│   ├── agents/                 # Agent folders and agent.yaml files
│   ├── providers/              # Provider profile metadata
│   ├── skills/                 # Global Skills
│   └── data/                   # Local runtime persistence, ignored by git
└── docs/
    └── architecture-rules.md
```

## Architecture

```text
User question
  -> request router
  -> direct answer | solo thinking | expert panel
  -> LangGraph expert / critic rounds
  -> summarizer visible projection
  -> synthesizer final answer
  -> streamed UI response
```

Core rules:

- Hidden CoT is a product boundary, not a UI label.
- Only summarizer projections and final answers are user-visible.
- Runtime data lives under `kort/runtime`; product code lives under `kort/apps`.
- Provider secrets are stored locally under runtime data or read from environment variables. They are not committed.
- API payloads are validated with Pydantic before use.

See [architecture-rules.md](kort/docs/architecture-rules.md) for the full rule set.

## API Surface

### Providers

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/providers` | List provider profiles |
| `PUT` | `/api/providers/{provider_id}` | Create or update a provider profile |
| `POST` | `/api/providers/{provider_id}/test` | Validate profile readiness and key availability |
| `GET` | `/api/provider-secrets` | Return configured/not-configured secret status |
| `PUT` | `/api/providers/{provider_id}/secret` | Save a local runtime API key |

Provider profile example:

```json
{
  "provider_id": "deepseek",
  "label": "DeepSeek",
  "provider_type": "deepseek",
  "base_url": "https://api.deepseek.com",
  "api_style": "openai",
  "default_model": "deepseek-chat",
  "env_key_name": "DEEPSEEK_API_KEY",
  "enabled": true,
  "capabilities": ["chat", "reasoning"]
}
```

### Agents

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/agents` | List agents |
| `POST` | `/api/agents` | Create an agent |
| `PUT` | `/api/agents/{name}` | Update an agent |
| `DELETE` | `/api/agents/{name}` | Delete an agent |
| `GET` | `/api/skills` | List global Skills |

Agent folders live at `kort/runtime/agents/{name}/agent.yaml`.

```yaml
name: research-lead
nickname: Research Lead
role: expert
provider_profile: deepseek
model: deepseek-chat
system_prompt: |
  You are the lead research expert...
allowed_global_skills:
  - structured-analysis
  - evidence-grounding
disabled_global_skills:
  - stage-summary-projection
priority: 20
```

Read [How To Make A Agent](kort/runtime/agents/How%20To%20Make%20A%20Agent.md) for the file protocol.

### Conversations

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/conversations` | List visible conversation records |
| `GET` | `/api/conversations/{conversation_id}` | Load one persisted visible conversation |
| `GET` | `/api/conversations/{conversation_id}/stream` | Reattach to a running conversation stream |
| `PATCH` | `/api/conversations/{conversation_id}` | Rename a conversation |
| `DELETE` | `/api/conversations/{conversation_id}` | Delete a conversation |
| `POST` | `/api/conversations/stream` | Start or continue an SSE conversation |

Conversation request:

```json
{
  "question": "What is quantum entanglement?",
  "level": "auto",
  "conversation_id": null,
  "deep_think": false
}
```

Discussion levels:

| Level | Behavior |
| --- | --- |
| `off` | Direct answer unless `deep_think` is enabled |
| `auto` | Router decides between direct and panel |
| `low` | Lightweight panel |
| `medium` | Focused panel |
| `high` | Deeper panel |

## Built-in Agents

| Agent | Role | Default model |
| --- | --- | --- |
| `research-lead` | expert | `deepseek-chat` |
| `creative-thinker` | expert | `deepseek-chat` |
| `logician-main` | expert | `deepseek-chat` |
| `critic-main` | critic | `deepseek-chat` |
| `summarizer-main` | summarizer | `deepseek-chat` |
| `synthesizer-main` | synthesizer | `deepseek-chat` |

System agents are protected from GUI deletion or editing.

## Built-in Skills

| Skill | Purpose |
| --- | --- |
| `structured-analysis` | Structured reasoning framework |
| `evidence-grounding` | Evidence and citation discipline |
| `gap-analysis` | Missing-information detection |
| `hidden-cot-guard` | Hidden-CoT boundary guard |
| `stage-summary-projection` | User-visible stage summary format |
| `final-answer-structure` | Final answer structure template |

Global Skills are shared. Private agent Skills can be added under `kort/runtime/agents/{name}/skills/` and are managed through the filesystem, not the GUI.

## Tech Stack

| Layer | Stack |
| --- | --- |
| Backend | Python 3.12, FastAPI, Uvicorn |
| Orchestration | LangGraph |
| Current model client | OpenAI-compatible HTTP client |
| Planned provider unification | LiteLLM |
| Validation | Pydantic v2 |
| Frontend | Next.js 15, React 19, Tailwind CSS 3 |
| Rendering | react-markdown, KaTeX |
| Deployment | Docker Compose |

## Verification

Useful one-shot checks:

```bash
cd kort/apps/api
python -m pytest tests
```

```bash
pnpm --dir kort/apps/web exec tsc --noEmit
pnpm --dir kort/apps/web build
```

## Repository Notes

- `kort/runtime/data/` is local runtime state and should not be committed.
- `.trae/`, `.codex/`, `.claude/`, `AGENTS.md`, and `HARNESS.md` are local agent context files and are intentionally ignored.
- The public README should describe the product surface, not local agent-operational details.
