<!-- prettier-ignore-start -->

# classifier/find-command

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
    "name": "find_relevant_files",
    "description": "Ask Clutch to search the project for files relevant to the user's request. Use this when the selected context is missing, likely incomplete, or the user asks about code but has not provided enough files. This opens an interactive file-picking workflow for the user; do not answer with guessed file names.",
    "parameters": {
      "type": "object",
      "required": [
        "goal"
      ],
      "properties": {
        "goal": {
          "type": "string",
          "description": "What the file search agent should look for, phrased as a concrete code-navigation goal."
        },
        "hints": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Optional symbols, directories, error messages, or feature names that may help find relevant files."
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
The user invoked /find. Decide the best arguments from the user request and call the find_relevant_files tool. Do not answer with guessed file names.

User request:
Find the files involved in login redirects.

Focused context item:
No focused context item.

Selected context:
No selected context items.

Automatic context:
<automatic_context name="directory_tree">
src/auth/login.ts
src/routes.ts
</automatic_context>
```

<!-- prettier-ignore-end -->
