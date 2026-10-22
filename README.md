<div align="center">
  <img src="kort/apps/web/public/kort-readme-logo-inverted.svg" alt="KORT logo" width="300" height="96" />

  <h1>Knights of the Round Table</h1>

  <p>A hidden-CoT, multi-model expert panel for structured AI discussion.</p>

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

KORT routes a user's question to a configurable panel of AI agents:

1. Experts reason independently.
2. Critics review and challenge.
3. The graph may continue for multiple rounds.
4. A summarizer projects only user-visible stage summaries.
5. A synthesizer produces the final answer.

Product boundary: raw expert discussion, provider reasoning content, and internal transcripts stay inside backend runtime state. Users see only the summarizer's projections and the final answer.

## Highlights

| Area | Current capability |
| --- | --- |
| Chat UX | ChatGPT-like shell with sidebar history, fixed composer, streamed answer output, Markdown/KaTeX |
| Thinking UX | Collapsed thinking entry, right-side drawer, completed state, structured summary nodes |
| Orchestration | LangGraph discussion flow with experts, critics, summarizer, synthesizer, configurable depth |
| Request routing | Simple prompts can skip full panel orchestration |
| Agents | File‑backed agents with role, prompt, persona, provider profile, priority, Skill access |
| Memory | Per-agent episodic/semantic memory with audit-friendly dream consolidation, shared/private scopes, token-budgeted retrieval |
| Providers | Runtime provider profiles, local key status, connectivity checks, OpenAI‑compatible calls |
| Persistence | Only visible projections are persisted; raw hidden discussion never exposed |

## Quick Start

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
py -3.13 -m venv .venv
.venv\Scripts\activate
cd kort/apps/api
pip install -e ".[dev]"
python -m uvicorn kort_api.main:app --reload --port 8000
```

`pnpm dev` uses `.venv\Scripts\python.exe` directly, so activation is only needed for manual commands.

Optional `.env`:

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
│   │   └── src/kort_api/
│   │       ├── app.py          # API routes
│   │       ├── agents.py       # Agent loader and CRUD
│   │       ├── conversations.py # Visible conversation store and SSE service
│   │       ├── model_client.py # OpenAI-compatible model client
│   │       ├── memory.py       # Agent memory, retrieval and dream consolidation
│   │       ├── orchestration.py # LangGraph runtime
│   │       ├── prompting.py    # Persona, Skills and memory prompt assembly
│   │       ├── providers.py    # Provider profiles and local secrets
│   │       ├── request_router.py
│   │       └── schemas.py      # Pydantic contracts
│   └── web/                    # Next.js 15 frontend
│       └── app/
│           ├── page.tsx        # Chat shell, sidebar, settings, drawer
│           ├── locale.ts
│           └── globals.css
├── runtime/
│   ├── agents/                 # Agent folders and agent.yaml files
│   ├── providers/              # Provider metadata
│   ├── skills/                 # Global Skills
│   ├── memory_seed/            # Shared seed facts copied on first use
│   ├── memory/                 # Personal runtime memory (git-ignored)
│   └── data/                   # Local runtime data
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

- Hidden CoT is never shown to the user.
- Users see only summarizer stage summaries and the final answer.
- Product code lives under `kort/apps`, runtime data under `kort/runtime`.
- API keys are stored locally in runtime data or environment variables, never committed.
- All API payloads are validated with Pydantic.

See [architecture-rules.md](kort/docs/architecture-rules.md).

## API Surface

### Providers

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/providers` | List provider profiles |
| `PUT` | `/api/providers/{provider_id}` | Create or update a provider profile |
| `POST` | `/api/providers/{provider_id}/test` | Validate profile and key status |
| `GET` | `/api/provider-secrets` | Return key configured status |
| `PUT` | `/api/providers/{provider_id}/secret` | Save a local runtime API key |

### Agents

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/agents` | List agents |
| `POST` | `/api/agents` | Create an agent |
| `PUT` | `/api/agents/{name}` | Update an agent |
| `DELETE` | `/api/agents/{name}` | Delete an agent |
| `GET` | `/api/skills` | List global Skills |

Agent folders live at `kort/runtime/agents/{name}/agent.yaml`:

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

### Memory

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/memory` | Status for every agent |
| `GET` | `/api/memory/{agent_name}?query=` | Counts plus a retrieval preview |
| `GET` | `/api/memory/{agent_name}/detail` | Facts, hunches, episodes and dream journal for the settings panel |
| `POST` | `/api/memory/{agent_name}/remember` | Save a fact (private by default, optional shared/pinned) |
| `PATCH` | `/api/memory/{agent_name}/facts/{fact_id}` | Edit text, pin state, confidence/importance or status |
| `DELETE` | `/api/memory/{agent_name}/facts/{fact_id}` | Archive a fact (kept on disk for audit) |
| `POST` | `/api/memory/{agent_name}/facts/{fact_id}/promote` | Promote a private fact to shared user memory |
| `POST` | `/api/memory/{agent_name}/dream` | Propose (`apply: false`) or apply a consolidation pass |

Dream responses include a journal, per-operation stats and, for proposals, the
strict-JSON payload the model returned. Applied dreams snapshot the agent folder
first; raw expert transcripts are never written to memory.

The web app exposes the same surface under **Settings → Memory**: pick an expert,
inspect facts, hunches, episodes and the dream journal, add or archive memories,
pin them, promote private facts to shared memory, and run a dream dry-run or a
real consolidation pass.

### Conversations

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/conversations` | List visible conversation records |
| `GET` | `/api/conversations/{conversation_id}` | Load one persisted conversation |
| `GET` | `/api/conversations/{conversation_id}/stream` | Reattach to a running conversation stream |
| `PATCH` | `/api/conversations/{conversation_id}` | Rename a conversation |
| `DELETE` | `/api/conversations/{conversation_id}` | Delete a conversation |
| `POST` | `/api/conversations/stream` | Start or continue an SSE conversation |

Request example:

```json
{
  "question": "What is quantum entanglement?",
  "level": "auto",
  "conversation_id": null,
  "deep_think": false
}
```

## Built-in Agents

| Agent | Role | Default model |
| --- | --- | --- |
| `research-lead` | expert | `deepseek-chat` |
| `creative-thinker` | expert | `deepseek-chat` |
| `logician-main` | expert | `deepseek-chat` |
| `critic-main` | critic | `deepseek-chat` |
| `archivist` | expert | `deepseek-v4-flash` |
| `dream-weaver` | expert | `deepseek-v4-flash` |
| `field-scribe` | expert | `deepseek-v4-flash` |
| `gardener` | critic | `deepseek-v4-flash` |
| `summarizer-main` | summarizer | `deepseek-chat` |
| `synthesizer-main` | synthesizer | `deepseek-chat` |

System agents are protected from GUI deletion or editing.

## Built-in Skills

| Skill | Purpose |
| --- | --- |
| `structured-analysis` | Structured reasoning framework |
| `evidence-grounding` | Evidence and citation discipline |
| `gap-analysis` | Missing‑information detection |
| `hidden-cot-guard` | Hidden‑CoT boundary guard |
| `stage-summary-projection` | User‑visible stage summary format |
| `final-answer-structure` | Final answer structure template |

Global Skills are shared. Private agent Skills can be added under `kort/runtime/agents/{name}/skills/` and are managed through the filesystem.

The four newer agents also carry a `persona.md`, `self_seed.md` and
`memory_seed.jsonl`, plus one private Skill each. Their memory is consolidated by
the dream cycle described in the agent guide.

## Tech Stack

| Layer | Stack |
| --- | --- |
| Backend | Python 3.12, FastAPI, Uvicorn |
| Orchestration | LangGraph |
| Current model client | OpenAI‑compatible HTTP client |
| Planned provider unification | LiteLLM |
| Validation | Pydantic v2 |
| Frontend | Next.js 15, React 19, Tailwind CSS 3 |
| Rendering | react-markdown, KaTeX |
| Deployment | Docker Compose |

## Verification

```bash
cd kort/apps/api
python -m pytest tests
```

```bash
pnpm --dir kort/apps/web exec tsc --noEmit
pnpm --dir kort/apps/web build
```
