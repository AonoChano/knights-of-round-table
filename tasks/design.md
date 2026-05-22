# KORT Current Design State

Date: 2026-05-21

## Purpose of This File

This is not the ideal design spec.

This file records the current implemented UI/product state, what it already satisfies, what is still placeholder, and what must change next to align with the original product direction.

## Current Implemented UX

### Main layout

Implemented:

- left sidebar
- center conversation area
- fixed bottom composer
- collapsible right thinking drawer

Implemented behavior:

- the main conversation area is the only scrollable container
- the composer stays fixed and visible
- the side regions remain visually stable while the conversation grows

This matches the intended high-level layout direction.

### Thinking presentation

Implemented:

- visible thinking is streamed separately from the final answer
- the thinking title is parsed from streamed summarizer Markdown heading syntax
- the title updates as soon as `### <title>` is detected
- the right drawer shows a reasoning timeline with active/completed states
- the final answer streams like a normal assistant answer

This now matches the correction in `tasks/思考方式纠正.md` more closely than the earlier placeholder implementation.

### Markdown and LaTeX

Implemented:

- Markdown rendering in visible thinking preview
- Markdown rendering in the timeline drawer
- Markdown rendering in final answer
- LaTeX support through `remark-math` and `rehype-katex`

### Settings shell

Implemented:

- ChatGPT-like settings overlay shape
- provider cards
- expert group page shell
- local provider secret save/test flow

This is functional as an MVP shell, but not yet complete product behavior.

## Current Placeholder Areas

### Left sidebar

Current state:

- the sidebar is still partially placeholder
- the list under "today" is sample prompts, not historical conversations

What it should become:

- a real history browser backed by persisted visible conversations

Conclusion:

- the current left sidebar is a temporary stand-in, not the intended finished behavior

### Expert status entry

Current state:

- there is a lightweight expert/discussion entry in the sidebar
- it still acts more like a shell entry point than a fully mature product surface

What it should become:

- a minimal status/config gateway that does not feel like a backend dashboard

### Thinking abstraction level

Current state:

- the transport layer now behaves correctly for streamed heading/body updates
- but the content examples are still more verbose than the final target aesthetic in some paths

What it should become:

- even tighter summarizer output control so the thinking surface feels like refined product reasoning, not debug prose

## Current Architecture State

### Frontend

True today:

- the frontend is already wired for streaming visible projections
- it can handle staged summary deltas and final answer deltas separately
- it can reconstruct a visible timeline within the current session

Missing:

- loading historical conversations from persistence
- selecting old conversations from the sidebar
- a true empty-state/new-chat experience with less placeholder content

### Backend

True today:

- the backend respects the hidden-CoT boundary in the visible API layer
- the backend has a stream endpoint for visible projections
- the backend can make a first real final-answer provider call through an OpenAI-compatible path

Missing:

- LangGraph orchestration
- LiteLLM unification
- real summarizer model driving the staged visible summaries
- full provider abstraction for domestic-first targets

## Design Corrections Now Locked In

These should be treated as current product rules:

- the frontend must not invent thinking titles
- the title must come from streamed summarizer output
- the final answer must feel like one assistant answering, not like a summarizer speaking about itself
- the thinking drawer is secondary to the main conversation flow
- the left sidebar must become history first, not prompt shortcuts
- only visible projections may be persisted or rendered

## Next Design Priorities

### Priority 1

- replace sidebar placeholders with real conversation history
- add conversation reopen and projection-based reload

### Priority 2

- reduce remaining prototype feel in new-chat empty state
- refine expert status surface to feel less like configuration chrome

### Priority 3

- tighten summarizer output style so visible thinking stays concise, elegant, and product-grade
