<!-- prettier-ignore-start -->

# classifier/find-debug-stacktrace

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
    "name": "add_context_files",
    "description": "Add one or more existing project files to the user's selected context. Use this when specific files are needed in context before answering or editing.",
    "parameters": {
      "type": "object",
      "required": [
        "paths"
      ],
      "properties": {
        "paths": {
          "type": "array",
          "items": {
            "type": "string"
          },
          "description": "Existing file paths to add, relative to the working directory. Include all files in one tool call."
        }
      }
    }
  },
  {
    "name": "create_file",
    "description": "Propose a new file for the user to review before it is created. This only proposes creation; it does not write files.",
    "parameters": {
      "type": "object",
      "required": [
        "summary",
        "path",
        "content"
      ],
      "properties": {
        "summary": {
          "type": "string",
          "description": "A concise summary of the proposed new file."
        },
        "path": {
          "type": "string",
          "description": "Path for the new file, relative to the working directory. Must not already exist."
        },
        "content": {
          "type": "string",
          "description": "The full contents to write to the new file."
        }
      }
    }
  },
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
  },
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
  },
  {
    "name": "run_shell_command",
    "description": "Run a shell command in the project root and save stdout/stderr as context for later use. Prefer read-only commands unless the user explicitly asks for a command with side effects.",
    "parameters": {
      "type": "object",
      "required": [
        "command"
      ],
      "properties": {
        "command": {
          "type": "string",
          "description": "The shell command to run from the project root. Use one concise command."
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
This stack trace happens on submit. Find the relevant source files.

TypeError: Cannot read properties of undefined (reading 'status')
    at submitOrder (src/orders/submit.ts:42:17)
    at CheckoutForm.handleSubmit (src/checkout/CheckoutForm.tsx:88:11)

Focused context item:
No focused context item.

Selected context:
No selected context items.

Automatic context:
<automatic_context name="directory_tree">
src/checkout/CheckoutForm.tsx
src/orders/submit.ts
</automatic_context>
```

<!-- prettier-ignore-end -->
