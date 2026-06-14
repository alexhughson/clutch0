<!-- prettier-ignore-start -->

# edit-hard/markdown-whitespace-oldtext

## System Prompt

```text
You are Clutch, a concise coding assistant.
Answer normal questions using the selected files when they are relevant.
If file context is missing or truncated, say so when it affects the answer.

When the user asks about code but the selected context is missing, incomplete, or likely not enough to answer confidently, call the find_relevant_files tool instead of guessing. Use it to route the user into an interactive file-picking workflow.

When the user asks you to make code changes, produce a diff, propose a patch, edit files, fix code, refactor code, or otherwise change the project, call the propose_patch tool instead of writing a raw diff in text.

Patch rules:

- Prefer editing selected files. Only create new files when the user explicitly asks or it is clearly necessary.
- Each edit must use exact oldText copied from the selected file context.
- oldText must be unique within the file and include enough surrounding lines to identify the change.
- Keep edits small and focused; use multiple edits for separate changes.
- Use an empty oldText only when creating a new file.
- Do not claim that changes have been applied; Clutch will show the patch to the user for review.
```

## Tools

```json
[
  {
    "name": "propose_patch",
    "description": "Propose exact file edits for the user to review. This only proposes a patch; it does not apply changes.",
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
                "description": "Path to the file to edit, relative to the working directory."
              },
              "oldText": {
                "type": "string",
                "description": "Exact existing text to replace. Must match the current file exactly and uniquely. Use an empty string only to create a new file."
              },
              "newText": {
                "type": "string",
                "description": "Replacement text for oldText, or full file contents for a new file."
              }
            }
          },
          "description": "One or more exact search/replace edits."
        }
      }
    }
  }
]
```

## Messages

### 1. user

```text
Question:
The user invoked /edit. If the request is actionable with the available context, you must call the propose_patch tool with exact edits. Do not answer with a prose-only implementation plan when you can produce a patch. If more context is needed, briefly explain what is missing instead of calling the tool.

User request:
Under Runtime Settings only, change the nested timeout from 30 seconds to 45 seconds. Leave the Quick Start timeout unchanged.

Focused context item:
@docs/runtime.md

Selected context:
<file path="docs/runtime.md" focused="true">
# Runtime

## Quick Start

- defaults:
  - timeout: 30 seconds
  - retries: 2

## Runtime Settings

- defaults:
  - timeout: 30 seconds
  - retries: 2

</file>

Automatic context:
<automatic_context name="directory_tree">
docs/runtime.md
</automatic_context>
```

<!-- prettier-ignore-end -->
