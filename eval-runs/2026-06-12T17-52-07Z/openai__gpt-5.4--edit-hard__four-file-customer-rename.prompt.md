<!-- prettier-ignore-start -->

# edit-hard/four-file-customer-rename

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
Rename the order field customerId to accountId across the selected model, serializer, view, and test files.

Focused context item:
@src/orderModel.ts

Selected context:
<file path="src/orderModel.ts" focused="true">
export type Order = {
  id: string;
  customerId: string;
  totalCents: number;
};

</file>

<file path="src/orderSerializer.ts">
import type { Order } from "./orderModel";

export function serializeOrder(order: Order) {
  return {
    id: order.id,
    customerId: order.customerId,
    totalCents: order.totalCents,
  };
}

</file>

<file path="src/orderView.ts">
import type { Order } from "./orderModel";

export function orderSubtitle(order: Order) {
  return `Customer ${order.customerId}`;
}

</file>

<file path="src/orderSerializer.test.ts">
import { serializeOrder } from "./orderSerializer";

test("serializes an order", () => {
  expect(serializeOrder({ id: "ord_1", customerId: "cus_1", totalCents: 1200 })).toEqual({
    id: "ord_1",
    customerId: "cus_1",
    totalCents: 1200,
  });
});

</file>

Automatic context:
<automatic_context name="directory_tree">
src/orderModel.ts
src/orderSerializer.test.ts
src/orderSerializer.ts
src/orderView.ts
</automatic_context>
```

<!-- prettier-ignore-end -->
