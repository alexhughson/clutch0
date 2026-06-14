<!-- prettier-ignore-start -->

# edit-limit/two-hunks-same-oldtext

## System Prompt

```text
You are Clutch, a concise coding assistant.
Answer normal questions from the selected and automatic context when it is relevant.
If code context is missing, unrelated, or truncated before the needed symbol, say so or use the file-search tool.

Workflow tools:

- Call at most one workflow tool per response. If you call a tool, stop after the call; Clutch will route the result.
- When the tool is available, use find_relevant_files for code-navigation questions with insufficient context instead of guessing.
- When the tool is available, use create_file for one explicit brand-new file.
- When the tool is available, use propose_patch for edits to existing files, mixed create/edit changes, diffs, fixes, and refactors.
- If no available tool fits, briefly explain what context or action is needed.

Edit scope:

- Treat the focused context item as the primary target. If it can satisfy the request, edit only that item.
- Other selected or automatic context is supporting evidence unless the user names it or the change cannot work without it.
- For one brand-new file, prefer create_file. In propose_patch, create files only when mixed with existing-file edits or when create_file is unavailable.

Patch construction:

- Copy each oldText verbatim from the exact selected <file> named by that edit's path, not from summaries, diffs, automatic context, or guessed code.
- oldText must match exactly once in that file. For common lines, include the enclosing block, heading, table row, or nearby unchanged lines until it is unique.
- Each propose_patch edit object must contain only path, oldText, and newText.
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
                "description": "Exact existing text copied from this file. It must match once; include surrounding unchanged lines when a shorter snippet is repeated. Empty only for a new file."
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
User request:
<user_request>
The user invoked /edit. If the available context is enough, call propose_patch with exact path-scoped edits. Do not answer with a prose-only plan when you can produce a patch. If context is missing or too ambiguous, briefly say what is missing instead of inventing edits.

Original request:
Change the mobile compact spacing to 6 and the desktop compact spacing to 10. Leave spacious spacing unchanged.
</user_request>

Focused context item (primary edit target when applicable):
@src/spacing.ts

Selected context:
<file path="src/spacing.ts" focused="true">
export const mobileSpacing = {
  compact: 8,
  spacious: 16,
};

export const desktopSpacing = {
  compact: 8,
  spacious: 24,
};

</file>

Automatic context (reference only):
<automatic_context name="directory_tree">
src/spacing.ts
</automatic_context>
```

<!-- prettier-ignore-end -->
