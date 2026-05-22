# KORT Product Polish Roadmap

Date: 2026-05-21

## Current Product State

This file reflects the actual codebase state now, not the ideal target state.

What is already true:

- the product code is isolated under `./kort`
- the frontend has a restrained chat shell, fixed composer, collapsible thinking trigger, settings overlay, and right-side reasoning drawer
- Markdown and LaTeX rendering are enabled in the visible thinking preview and final answer
- the backend exposes visible-only conversation APIs and a new SSE stream endpoint
- the visible thinking title now updates from streamed summarizer Markdown headings like `### Title`
- the right-side reasoning timeline streams incrementally and shows active/completed thinking states
- the final answer streams like a normal assistant response instead of presenting itself as a separate summarizer

What is not true yet:

- the left sidebar is not a real conversation history browser yet
- the current sidebar sample items are placeholder prompts, not persisted conversations
- the backend is not yet using LangGraph for real multi-round orchestration
- the backend is not yet using LiteLLM as the provider abstraction
- the current visible summaries are still generated from a stubbed projection path
- provider coverage is not yet complete for domestic-first targets like Anthropic, BigModel/Zhipu, Kimi, MiniMax, and Ollama under one unified abstraction
- expert create/edit flows in GUI are incomplete
- the current conversation persistence shape is not yet a full history/detail model that drives the sidebar

## Product Gaps vs Original Plan

### Gap 1: Sidebar semantics

Expected:

- left sidebar stores and browses historical conversations
- selecting a history item reloads the visible projections for that conversation

Current:

- left sidebar shows sample prompts only
- no history list API is connected to the sidebar UI
- no conversation detail reload flow exists in the frontend

Impact:

- the product still feels like an MVP shell instead of a mature chat product

Priority:

- `P0`

### Gap 2: Real visible conversation persistence

Expected:

- visible projections are persisted and reloadable
- the UI can reconstruct old conversations from stored summaries and final answers only

Current:

- new streamed runs end in a saved record
- but there is no frontend history browser or detail page flow using that data

Impact:

- persistence exists technically but not as a user-facing product feature

Priority:

- `P0`

### Gap 3: LangGraph orchestration

Expected:

- real graph-driven expert -> critique -> convergence -> summary -> final answer flow

Current:

- visible-only staged summary projection is still synthetic
- hidden-CoT boundary is respected, but the actual orchestration engine is not yet implemented

Impact:

- the core product promise is still only partially implemented

Priority:

- `P0`

### Gap 4: LiteLLM and provider unification

Expected:

- one provider abstraction layer with domestic-first coverage

Current:

- the current model client uses an OpenAI-compatible path directly
- this is enough for first real calls, but it is not the final architecture

Impact:

- provider maintenance cost will rise if more vendors are added on the current shape

Priority:

- `P1`

### Gap 5: Expert and skills management depth

Expected:

- full expert group CRUD in GUI
- proper skill visibility and permission editing

Current:

- the settings UI can display loaded experts and providers
- create/edit flows for experts are not complete

Impact:

- configuration handoff still depends too much on manual file editing

Priority:

- `P1`

## Recommended Next Vertical Slices

### Slice 1: Real conversation history

Goal:

- turn the left sidebar into a real conversation navigator

Scope:

- list persisted conversations in the sidebar
- select a conversation and reload visible summaries/final answer
- replace sample prompts with real history groups

Acceptance criteria:

- left sidebar no longer uses placeholder sample prompts
- old conversations can be reopened after refresh
- only visible projections are shown during reload

Priority:

- `P0`

### Slice 2: Conversation detail API and projection-driven reload

Goal:

- support a proper chat product loop: ask, persist, revisit

Scope:

- add conversation detail endpoint
- wire frontend selection state
- render reconstructed thinking timeline and final answer from persisted projections

Acceptance criteria:

- selecting a history item fully reconstructs the visible chat state
- no internal discussion content is stored or rendered

Priority:

- `P0`

### Slice 3: Replace synthetic orchestration with LangGraph

Goal:

- make the core product architecture real

Scope:

- introduce LangGraph state and nodes
- keep the SSE projection contract stable
- ensure only summarizer-visible projections cross the user boundary

Acceptance criteria:

- staged visible summaries come from graph execution, not hardcoded branches
- API contracts stay compatible with the current frontend

Priority:

- `P0`

### Slice 4: LiteLLM migration

Goal:

- unify provider handling for maintainability

Scope:

- replace direct OpenAI-compatible model client path with LiteLLM-backed provider dispatch
- map domestic providers through stable profile configuration

Acceptance criteria:

- one abstraction handles OpenAI, Anthropic, DeepSeek, BigModel/Zhipu, Kimi, MiniMax, and Ollama
- secret handling remains local-only

Priority:

- `P1`

### Slice 5: Expert group CRUD

Goal:

- finish the intended product configuration loop

Scope:

- add expert create/update/delete APIs
- wire settings UI add/edit flow
- preserve filesystem-backed handoff format

Acceptance criteria:

- experts can be created and edited from GUI
- generated files remain compatible with `runtime/agents/How To Make A Agent.md`

Priority:

- `P1`
