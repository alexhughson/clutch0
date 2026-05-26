# Clutch

OpenTUI system for LLM prompting. Keep code tight.

## Core map

- App shell: `src/index.tsx`, `src/App.tsx`
- Global state/actions: `src/store/appStore.ts`, `src/app/appTypes.ts`, `src/app/appActions.ts`
- Active modal workflows: `activeTask` in app state, rendered through `src/app/taskRegistry.tsx`
- Persistent workspace: composer text + context items + focused context item
- Context deck rules: `src/app/contextDeck.ts`

## Context items

Context items are the main abstraction. See `src/types.ts` and implementations in `src/lib/context/contextItems.ts`.

A context item owns how it is listed, opened, summarized, formatted for the LLM, and what actions it exposes. Current items: selected files, saved text responses, saved diffs.

UI list: `src/components/ContextItemsList.tsx`  
Summaries: `src/workflows/contextSummaries/contextSummariesWorkflow.ts`

## Composer

Composer UI/controller/model live in `src/components/MessageComposer/`.

`@file` selection adds `FileContextItem`s. Keyboard shortcuts either navigate file suggestions or run the focused context item's actions.

## LLM requests and tools

Request start/effects: `src/workflows/llmRequest/startLlmRequest.ts`  
Context building: `src/lib/llm/context.ts`  
Streaming/model/prompt wiring: `src/lib/llm/streamResponse.ts`, `src/lib/llm/model.ts`, `src/prompts/`

LLM workflow tools are routed through `src/workflows/llmTools/`.

Current tool workflows:

- patch proposal/review: `src/lib/llm/patchTool.ts`, `src/lib/patch/`, `src/components/LlmResponseScreen.tsx`
- relevant file search: `src/workflows/findFiles/`

## Workflow pattern

Keep UI thin. Put state transitions in workflow action modules under `src/workflows/*`. Put pure/domain helpers in `src/lib/*` or `src/app/*`. Add new modal flows as an `AppTask` variant plus a task registry entry.
