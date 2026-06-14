<!-- prettier-ignore-start -->

# edit-hard/saved-diff-followup

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
- For a one-line change inside a small function, object, branch, or Markdown section, prefer replacing the whole enclosing block.
- Do not re-indent or normalize oldText. Preserve the exact leading spaces and blank lines from the context.
- Each propose_patch edit object must contain only path, oldText, and newText.
- Never put placeholders, comments, or strings inside the edits array.
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
                "description": "Replacement text for oldText, or full file contents for a new file."
              }
            }
          },
          "description": "One or more exact search/replace edit objects. Do not include placeholders, strings, comments, or extra keys."
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
The user invoked /edit. If the available context is enough, call propose_patch with exact path-scoped edits. When a focused context item is shown, patch only that item unless the original request explicitly asks for other files or a multi-file change. If the requested direction is clear but exact wording/details are unstated, choose a minimal reasonable implementation from the context. Do not answer with a prose-only plan when you can produce a patch. If context is missing or truly ambiguous, briefly say what is missing instead of inventing edits.

Original request:
Continue the saved diff and finish renaming purchase copy to order copy. Update only the remaining stale labels.
</user_request>

Focused context item (edit target unless the request says otherwise):
@src/copy.ts

Selected context:
<file path="src/copy.ts" focused="true">
export const checkoutCopy = {
  start: "Begin order",
  finish: "Finish order",
  cancel: "Cancel purchase",
  receipt: "Purchase receipt",
};

</file>

<saved_diff source_request_id=1 created_at="2026-01-01T00:00:00.000Z">
<prompt>
Rename purchase copy to order copy.
</prompt>
<summary>
Updated start and finish labels from purchase to order.
</summary>
<diff>
diff --git a/src/copy.ts b/src/copy.ts
--- a/src/copy.ts
+++ b/src/copy.ts
@@
-  start: "Begin purchase",
-  finish: "Finish purchase",
+  start: "Begin order",
+  finish: "Finish order",

</diff>
</saved_diff>

Automatic context (reference only):
<automatic_context name="directory_tree">
src/copy.ts
</automatic_context>
```

<!-- prettier-ignore-end -->
