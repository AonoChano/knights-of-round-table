# KORT Todo

Updated: 2026-05-21

## Done

- [x] Scaffold isolated `./kort` product tree
- [x] Build backend provider profile store and local secret save/test flow
- [x] Build runtime-backed agent loader
- [x] Add visible-only conversation response contracts
- [x] Build frontend chat shell, settings shell, and reasoning drawer
- [x] Add real SSE streaming for visible stage summaries and final answer
- [x] Make visible thinking title update from streamed `### heading`
- [x] Render Markdown and LaTeX in visible thinking and final answer
- [x] Keep the main conversation area scrollable while side regions and composer stay fixed
- [x] Preserve hidden-CoT boundary in current visible APIs

## Current Known Gaps

- [ ] Replace sidebar sample prompts with real conversation history
- [ ] Add conversation detail API for projection-based reload
- [ ] Reopen persisted conversations from the sidebar
- [ ] Unify live-stream state and historical reload state in the frontend
- [ ] Add expert create/update/delete APIs
- [ ] Add expert create/edit GUI flow
- [ ] Replace synthetic visible summaries with LangGraph orchestration
- [ ] Replace direct OpenAI-compatible provider path with LiteLLM
- [ ] Expand domestic-first provider support under one abstraction
- [ ] Tighten summarizer style so visible thinking stays concise and product-grade

## Next Work Order

1. Real conversation history in the left sidebar
2. Conversation detail loading and state reconstruction
3. Expert CRUD
4. LangGraph orchestration
5. LiteLLM provider unification
