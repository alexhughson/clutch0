<!-- prettier-ignore-start -->

# classifier/ask-command-suppresses-tools

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

(none)

## Messages

### 1. user

```text
Question:
The user invoked /ask. Answer the user's question directly. Do not call workflow tools.

User request:
Fix the bug in this function, but only tell me what you would do.

Focused context item:
@src/count.ts

Selected context:
<file path="src/count.ts" focused="true">
export function countReady(items: { ready: boolean }[]) {
  return items.filter((item) => !item.ready).length;
}

</file>

Automatic context:
<automatic_context name="directory_tree">
src/count.ts
</automatic_context>
```

<!-- prettier-ignore-end -->
