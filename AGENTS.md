# Clutch

OpenTUI system for LLM prompting. Keep code tight, explicit, and fail-fast.

## Core map

- App shell: `src/index.tsx`, `src/App.tsx`
- State shape/actions: `src/app/appTypes.ts`, `src/app/appActions.ts`
- Store wiring only: `src/store/appStore.ts`
- Active task rendering: `src/app/taskRegistry.tsx` using an exhaustive `switch`
- Persistent workspace: composer text + context items + focused context item
- Context deck rules: `src/app/contextDeck.ts`

## Robustness rules

- Prefer explicit invariants over defensive no-ops. If a caller violates a contract, throw.
- Only ignore stale async completions when navigation/races make them expected; make that intent obvious.
- Do not silently coerce malformed LLM/tool arguments into defaults.
- Optional project context may be absent (`AGENTS.md`, git diff); unexpected filesystem/config errors should surface.
- Avoid helper functions that only rename/null-convert data. Names should explain the caller-facing purpose.

## Context items

Context items are the main OO abstraction. See `src/types.ts` and implementations in `src/lib/context/contextItems.ts`.

A context item owns how it is listed, opened, summarized, formatted for the LLM, viewed in detail, and what actions it exposes. UI code should ask the item instead of switching on item types.

UI list: `src/components/ContextItemsList.tsx`  
Summaries: `src/workflows/contextSummaries/contextSummariesWorkflow.ts`

## Composer

Composer UI/controller/model live in `src/components/MessageComposer/`.

`@file` selection adds `FileContextItem`s. Keyboard shortcuts either navigate suggestions or run the focused context item's actions.

## LLM requests and tools

Request start/effects: `src/workflows/llmRequest/startLlmRequest.ts`  
Context building: `src/lib/llm/context.ts`  
Streaming/model/prompt wiring: `src/lib/llm/streamResponse.ts`, `src/lib/llm/model.ts`, `src/prompts/`

All model-facing prompt text must live under `src/prompts/` and be loaded through `src/lib/llm/prompts.ts`. Keep the configurable prompt set small; tool schema descriptions may stay beside the tool definitions.

LLM workflow tools are isolated controllers registered in `src/workflows/llmTools/toolRegistry.ts`.

Each workflow tool module owns:

- its tool definition
- slash command metadata, if any
- strict tool-call argument parsing
- routing into its domain result
- handling its domain result

The registry validates duplicate/missing tool names and fails on unregistered or disallowed tool calls.

Current tool workflows:

- patch proposal/review: `src/workflows/llmTools/patchWorkflowTool.ts`, `src/lib/patch/`, `src/components/LlmResponseScreen.tsx`
- relevant file search: `src/workflows/findFiles/`
- shell command: `src/workflows/llmTools/shellCommandWorkflowTool.ts`, `src/workflows/shellCommand/`
- create file: `src/workflows/createFile/`
- show context: `src/workflows/showContext/`

## Workflow pattern

Keep UI thin. Put state transitions in workflow action modules under `src/workflows/*`. Put pure/domain helpers in `src/lib/*` or `src/app/*`. Add new modal flows as an `AppTask` variant plus an exhaustive task renderer branch.
