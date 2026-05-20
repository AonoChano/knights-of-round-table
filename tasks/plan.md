# KORT MVP Implementation Plan

Date: 2026-05-19

## Goal

Implement the first runnable MVP under `./kort` following the approved design spec and architecture rules.

## Principles

- work only inside the isolated `./kort` product subtree for product code
- preserve the hidden-CoT boundary from the first backend endpoint onward
- build vertical slices, not disconnected layers
- prefer visible projection contracts before deeper orchestration complexity
- keep `role/system_prompt` separate from Skills; Skills must remain reusable capability modules

## Phase 1: Product Skeleton and Safe Contracts

Scope:

- scaffold `kort/apps/web`
- scaffold `kort/apps/api`
- scaffold `kort/packages/shared`
- scaffold `kort/runtime/*`
- define visible schemas and runtime config models

Acceptance criteria:

- product tree exists under `./kort`
- runtime directories exist and are documented
- backend and frontend have minimal bootable project files
- shared visible contracts are defined

Verification:

- directory inspection
- backend import check
- frontend config file presence

## Phase 2: Backend Visible-Only MVP Slice

Scope:

- provider profile model and file-backed store
- agent yaml model and loader
- safe conversation schemas
- visible-only conversation endpoints
- initial in-memory/fake orchestration path that returns staged summaries and final answer

Acceptance criteria:

- backend starts
- provider CRUD works with non-secret fields only
- agent listing loads from runtime filesystem
- conversation start endpoint returns summary projections and final answer only
- no raw internal discussion appears in API payloads

Verification:

- backend tests
- route smoke checks

## Phase 3: Frontend Chat and Settings Shell

Scope:

- ChatGPT-like layout shell
- sidebar, expert status card, composer
- thinking summary blocks and right drawer
- settings shell with provider and expert pages
- API integration against backend visible endpoints

Acceptance criteria:

- frontend starts
- chat shell renders
- settings pages render
- provider form state is isolated per card
- conversation response displays visible summary blocks and final answer

Verification:

- frontend build
- manual UI smoke check

## Phase 4: Runtime Content and Handoff Docs

Scope:

- seed runtime example agents and provider profiles
- add `How To Make A Agent.md`
- update root compose/readme for new tree

Acceptance criteria:

- runtime examples present
- handoff docs match real structure
- compose points to `./kort` apps instead of legacy `src`

Verification:

- file inspection
- compose config check

## Phase 5: Replace Fake Orchestration with LangGraph Flow

Scope:

- introduce real LangGraph graph nodes
- keep visible contracts stable
- preserve hidden-CoT boundaries

Acceptance criteria:

- graph executes fixed 4 rounds
- summaries remain schema-validated
- API contract unchanged for frontend

Verification:

- backend tests
- manual run with configured provider
