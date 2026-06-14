<!-- prettier-ignore-start -->

# edit-hard/agents-md-clarify-pi-ai-adapter

## System Prompt

```text
You are Clutch, a concise coding assistant.
Answer normal questions from the selected and automatic context when it is relevant.
If code context is missing, unrelated, or truncated before the needed symbol, say so or use the file-search tool.

Workflow tools:

- Call at most one workflow tool per response. If you call a tool, stop after the call; Clutch will route the result.
- When the tool is available, use find_relevant_files for code-navigation questions with insufficient context instead of guessing.
- Use add_context_files only when the user asks to add known files or exact paths are already the requested next step. For discovery, stack traces, suspected files, or missing source, use find_relevant_files.
- When the tool is available, use create_file for one explicit brand-new file.
- When the tool is available, use propose_patch for edits to existing files, mixed create/edit changes, diffs, fixes, and refactors.
- If no available tool fits, briefly explain what context or action is needed.

Edit scope:

- Treat the focused context item as the primary target. If it can satisfy the request, edit only that item.
- Other selected or automatic context is supporting evidence unless the user names it or the change cannot work without it.
- Similar code in another selected file is not permission to edit it; each edited path must be requested or required.
- For one brand-new file, prefer create_file. In propose_patch, create files only when mixed with existing-file edits or when create_file is unavailable.

Patch construction:

- Copy each oldText verbatim from the exact selected <file> named by that edit's path, not from summaries, diffs, automatic context, or guessed code.
- oldText must match exactly once in that file. A repeated line alone is invalid; include the smallest enclosing function, block, heading, table row, or nearby unchanged lines that make it unique.
- If oldText would be a single code line, first check whether that exact line appears elsewhere in the same file; if it does, use the enclosing branch, object, or function instead.
- For a one-line change inside a small function, object, branch, or Markdown section, prefer replacing the whole enclosing block.
- Do not re-indent or normalize oldText. Preserve the exact leading spaces and blank lines from the context.
- Each propose_patch edits item must be an object with only path, oldText, and newText.
- Never put placeholders, comments, prose, markdown, or JSON-encoded strings inside the edits array.
- oldText and newText must both be strings. For multiline code or Markdown, put the whole replacement in one string; do not use arrays, objects, or nested fields.
- Preserve whitespace, indentation, imports, naming style, and Markdown formatting.
- Keep edits focused; use separate edits for separate locations.
- Use empty oldText only to create a new file.
- Do not claim that changes have been applied; Clutch will show the patch to the user for review.
```

## Tools

```json
[
  {
    "name": "propose_patch",
    "description": "Propose exact, path-scoped file edits for the user to review. This only proposes a patch; it does not apply changes.",
    "parameters": {
      "type": "object",
      "required": [
        "summary",
        "edits"
      ],
      "properties": {
        "summary": {
          "type": "string",
          "description": "A concise summary of the proposed code changes."
        },
        "edits": {
          "type": "array",
          "items": {
            "type": "object",
            "required": [
              "path",
              "oldText",
              "newText"
            ],
            "properties": {
              "path": {
                "type": "string",
                "description": "Path to edit, relative to the working directory. Use only focused, explicitly requested, or necessary files."
              },
              "oldText": {
                "type": "string",
                "description": "Exact existing text copied from this file, with unchanged indentation. It must match once; prefer the enclosing block for small one-line changes or repeated snippets. Empty only for a new file."
              },
              "newText": {
                "type": "string",
                "description": "Replacement text for oldText, or full file contents for a new file. Must be a string, including for multiline code or Markdown; do not use arrays or objects."
              }
            }
          },
          "description": "One or more exact search/replace edit objects. Every item must be an object, not a JSON string or placeholder; do not include comments, prose, or extra keys."
        }
      }
    }
  }
]
```

## Messages

### 1. user

```text
User request:
<user_request>
The user invoked /edit. If the available context is enough, call propose_patch with exact path-scoped edits. When a focused context item is shown, use exactly that edited path unless the original request names other files or asks for all/every/multi-file changes. If multiple files or locations are required, include one complete edit object for each; do not sketch or serialize pending edits as strings. If the requested direction is clear but exact wording/details are unstated, choose a minimal reasonable implementation from the context. Do not restate the selected file, summarize it, or answer with a prose-only plan when you can produce a patch. If context is missing or truly ambiguous, briefly say what is missing instead of inventing edits.

Original request:
Make it clear that pi-ai is the LLM model adapter layer.
</user_request>

Focused context item (edit target unless the request says otherwise):
@AGENTS.md

Selected context:
<file path="AGENTS.md" focused="true">
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

</file>

Automatic context (reference only):
<automatic_context name="current_diff">
diff --git a/src/lib/llm/model.ts b/src/lib/llm/model.ts
index d1f6059..42797c1 100644
--- a/src/lib/llm/model.ts
+++ b/src/lib/llm/model.ts
@@ -1 +1 @@
-export type LlmModel = { id: string; provider: string };
+export type LlmModel = { id: string; provider: string; label: string };

</automatic_context>

<automatic_context name="directory_tree">
AGENTS.md
src/lib/llm/model.ts
</automatic_context>
```

<!-- prettier-ignore-end -->
