# KORT Next Implementation Plan

Date: 2026-05-21

## Goal

Move from the current fast vertical MVP slice to the next product-correct slices without breaking the hidden-CoT boundary or the new streamed-thinking UX.

## Current Baseline

Already implemented:

- isolated product tree under `./kort`
- provider profile CRUD and local secret handling
- agent loading from runtime files
- visible-only conversation APIs
- SSE-based visible thinking/final-answer streaming
- Markdown and LaTeX rendering
- settings shell and reasoning drawer

Not yet implemented:

- real sidebar history browser
- conversation detail reload
- LangGraph orchestration
- LiteLLM provider abstraction
- full expert CRUD GUI

## Phase 1: Sidebar History Slice

Scope:

- add a conversation detail endpoint
- load historical conversation list into the left sidebar
- replace placeholder sample prompts with real persisted records
- allow selecting a past conversation from the sidebar

Acceptance criteria:

- the left sidebar is a real conversation history browser
- page refresh keeps visible history available
- selecting a history record rebuilds the visible chat state from persisted projections only

Verification:

- backend route smoke check
- frontend production build
- manual history selection check

## Phase 2: Projection Reload Slice

Scope:

- normalize frontend state so streamed sessions and loaded history use one rendering path
- ensure reasoning timeline, final answer, and metadata render consistently for both fresh and historical sessions

Acceptance criteria:

- a newly streamed conversation and a reloaded historical conversation look structurally identical
- no placeholder conversation content remains in the sidebar flow

Verification:

- frontend build
- API smoke checks

## Phase 3: Expert CRUD Slice

Scope:

- add create/update/delete APIs for runtime-backed experts
- build GUI add/edit flow in settings
- preserve filesystem compatibility with `runtime/agents/How To Make A Agent.md`

Acceptance criteria:

- experts can be created and edited from the UI
- resulting files remain valid and reloadable

Verification:

- backend validation smoke checks
- frontend build

## Phase 4: LangGraph Orchestration Slice

Scope:

- replace synthetic visible summary generation with real LangGraph orchestration
- keep raw expert discussion internal only
- preserve current SSE projection contract so the frontend stays stable

Acceptance criteria:

- staged summaries are produced from graph execution
- no raw internal discussion is emitted, logged, or persisted

Verification:

- backend smoke tests
- targeted hidden-CoT boundary checks

## Phase 5: LiteLLM Provider Unification Slice

Scope:

- replace direct OpenAI-compatible dispatch with LiteLLM-backed provider routing
- map domestic-first providers through stable profile definitions

Acceptance criteria:

- one abstraction handles the supported provider families
- current local secret boundary remains intact

Verification:

- provider connectivity smoke checks
- backend compile/import checks

## Dependency Order

1. Sidebar history slice
2. Projection reload slice
3. Expert CRUD slice
4. LangGraph orchestration slice
5. LiteLLM provider unification slice

Reason:

- history and reload are the most obvious product gap in the current UI
- they also make later orchestration work observable and testable without changing the chat surface again
