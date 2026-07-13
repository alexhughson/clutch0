import type { AssistantMessage, Context } from "@earendil-works/pi-ai";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import type { LlmWorkflowToolResult } from "../../workflows/llmTools/types";
import { validatePatchProposal } from "../patch/patchEngine";
import { applyPatchTool } from "./patchTool";
import {
  buildLlmToolContinuationContext,
  continueApplyPatchToolCalls,
  continuePatchToolCalls,
} from "./streamResponse";

test("builds a tool-result continuation context from an assistant tool call", () => {
  const assistantMessage = assistantMessageFixture();
  const context: Context = {
    messages: [
      {
        content: "Edit the selected file.",
        role: "user",
        timestamp: 1,
      },
    ],
    systemPrompt: "Patch carefully.",
    tools: [applyPatchTool],
  };

  const nextContext = buildLlmToolContinuationContext({
    assistantMessage,
    context,
    timestamp: 3,
    toolOutput: {
      content:
        "Exit code: 0\nWall time: 0 seconds\nOutput:\nSuccess. Updated the following files:\nM README.md\n",
      toolCallId: "call_patch|ctc_1",
      toolName: "apply_patch",
    },
  });

  expect(nextContext.systemPrompt).toBe("Patch carefully.");
  expect(nextContext.tools).toEqual([applyPatchTool]);
  expect(nextContext.messages).toEqual([
    context.messages[0],
    assistantMessage,
    {
      content: [
        {
          text: "Exit code: 0\nWall time: 0 seconds\nOutput:\nSuccess. Updated the following files:\nM README.md\n",
          type: "text",
        },
      ],
      isError: false,
      role: "toolResult",
      timestamp: 3,
      toolCallId: "call_patch|ctc_1",
      toolName: "apply_patch",
    },
  ]);
});

test("marks continuation tool results as errors when requested", () => {
  const assistantMessage = assistantMessageFixture();
  const nextContext = buildLlmToolContinuationContext({
    assistantMessage,
    context: {
      messages: [],
    },
    timestamp: 3,
    toolOutput: {
      content: "apply_patch verification failed: bad patch",
      isError: true,
      toolCallId: "call_patch|ctc_1",
      toolName: "apply_patch",
    },
  });

  expect(nextContext.messages[1]).toMatchObject({
    isError: true,
    role: "toolResult",
  });
});

test("builds a continuation context from multiple tool outputs", () => {
  const assistantMessage = multiToolAssistantMessageFixture([
    {
      callId: "call_patch_1",
      patch:
        "*** Begin Patch\n*** Update File: first.txt\n@@\n-old\n+new\n*** End Patch\n",
    },
    {
      callId: "call_patch_2",
      patch:
        "*** Begin Patch\n*** Update File: second.txt\n@@\n-old\n+new\n*** End Patch\n",
    },
  ]);

  const nextContext = buildLlmToolContinuationContext({
    assistantMessage,
    context: continuationBaseContext(),
    timestamp: 3,
    toolOutputs: [
      {
        content: "Exit code: 0\nWall time: 0 seconds\nOutput:\nM first.txt\n",
        toolCallId: "call_patch_1",
        toolName: "apply_patch",
      },
      {
        content:
          "apply_patch verification failed: second.txt: Failed to find expected lines",
        isError: true,
        toolCallId: "call_patch_2",
        toolName: "apply_patch",
      },
    ],
  });

  expect(nextContext.messages.slice(1)).toEqual([
    assistantMessage,
    expect.objectContaining({
      isError: false,
      role: "toolResult",
      toolCallId: "call_patch_1",
    }),
    expect.objectContaining({
      isError: true,
      role: "toolResult",
      toolCallId: "call_patch_2",
    }),
  ]);
});

test("continues invalid patch tool calls until the model returns a valid patch", async () => {
  const context = continuationBaseContext();
  const firstAssistant = assistantMessageFixture({
    callId: "call_patch_1",
    patch: "bad patch 1",
  });
  const secondAssistant = assistantMessageFixture({
    callId: "call_patch_2",
    patch: "bad patch 2",
  });
  const thirdAssistant = assistantMessageFixture({
    callId: "call_patch_3",
    patch: "fixed patch",
  });
  const toolOutputs: unknown[] = [];
  const contextMessageCounts: number[] = [];

  const result = await continuePatchToolCalls({
    context,
    firstAssistantMessage: firstAssistant,
    firstResponseText: "first malformed patch",
    firstWorkflowResult: invalidPatchWorkflowResult("first"),
    invalidRetryBudget: 3,
    stepBudget: 8,
    routeAssistantMessageToolCalls: async (assistantMessage) =>
      assistantMessage.content[0]?.type === "toolCall" &&
      assistantMessage.content[0].id === "call_patch_2"
        ? invalidPatchWorkflowResult("second")
        : validPatchWorkflowResult(),
    streamContinuation: async ({ assistantMessage, context, toolOutput }) => {
      toolOutputs.push(toolOutput);
      contextMessageCounts.push(context.messages.length);
      const nextContext = buildLlmToolContinuationContext({
        assistantMessage,
        context,
        toolOutput,
      });
      return {
        assistantMessage:
          toolOutputs.length === 1 ? secondAssistant : thirdAssistant,
        context: nextContext,
        responseText:
          toolOutputs.length === 1 ? "second malformed patch" : "fixed patch",
      };
    },
  });

  expect(result).toMatchObject({
    kind: "patch",
    patch: { status: "valid" },
    responseText: "fixed patch",
  });
  expect(toolOutputs).toEqual([
    expect.objectContaining({
      content: expect.stringContaining("first failed"),
      isError: true,
      toolCallId: "call_patch_1",
      toolName: "apply_patch",
    }),
    expect.objectContaining({
      content: expect.stringContaining("second failed"),
      isError: true,
      toolCallId: "call_patch_2",
      toolName: "apply_patch",
    }),
  ]);
  expect(contextMessageCounts).toEqual([1, 3]);
});

test("stops invalid patch tool-call retries at the configured limit", async () => {
  const context = continuationBaseContext();
  const retryAssistants = [
    assistantMessageFixture({ callId: "call_patch_2", patch: "bad patch 2" }),
    assistantMessageFixture({ callId: "call_patch_3", patch: "bad patch 3" }),
  ];
  const toolOutputs: unknown[] = [];

  const result = await continuePatchToolCalls({
    context,
    firstAssistantMessage: assistantMessageFixture({
      callId: "call_patch_1",
      patch: "bad patch 1",
    }),
    firstResponseText: "first malformed patch",
    firstWorkflowResult: invalidPatchWorkflowResult("first"),
    invalidRetryBudget: 2,
    stepBudget: 8,
    routeAssistantMessageToolCalls: async () =>
      invalidPatchWorkflowResult(`retry ${toolOutputs.length}`),
    streamContinuation: async ({ assistantMessage, context, toolOutput }) => {
      toolOutputs.push(toolOutput);
      return {
        assistantMessage: retryAssistants[toolOutputs.length - 1]!,
        context: buildLlmToolContinuationContext({
          assistantMessage,
          context,
          toolOutput,
        }),
        responseText: `malformed patch ${toolOutputs.length + 1}`,
      };
    },
  });

  expect(toolOutputs).toHaveLength(2);
  expect(result).toMatchObject({
    kind: "patch",
    patch: {
      errors: [expect.objectContaining({ message: "retry 2 failed" })],
      status: "invalid",
    },
    responseText: "malformed patch 3",
  });
});

test("returns a normalized patch without applying it in review mode", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-patch-tool-review-"));
  await writeFile(join(root, "README.md"), "old\n", "utf8");
  const patch = [
    "*** Begin Patch",
    "*** Update File: README.md",
    "@@",
    "-old",
    "+new",
    "*** End Patch",
  ].join("\n");

  const result = await continuePatchToolCalls({
    context: continuationBaseContext(),
    firstAssistantMessage: assistantMessageFixture({
      callId: "call_patch_review",
      patch,
    }),
    firstResponseText: "",
    firstWorkflowResult: {
      kind: "patch",
      patch: await validatePatchProposal({
        proposal: {
          patch,
          summary: "Update README wording.",
          toolCallId: "call_patch_review",
        },
        root,
      }),
    },
    patchToolMode: "review",
    root,
    stepBudget: 8,
    routeAssistantMessageToolCalls: async () => {
      throw new Error("No continuation expected for review mode.");
    },
    streamContinuation: async () => {
      throw new Error("No patch apply expected for review mode.");
    },
  });

  expect(await readFile(join(root, "README.md"), "utf8")).toBe("old\n");
  expect(result).toMatchObject({
    kind: "patch",
    patch: {
      diffText: expect.stringContaining("-old\n+new"),
      status: "valid",
    },
    responseText: "",
  });
  expect("applyStatus" in result).toBe(false);
});

test("applies valid patch tool calls in apply mode and continues with success output", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-patch-tool-loop-"));
  await writeFile(join(root, "README.md"), "old\n", "utf8");
  const patch = [
    "*** Begin Patch",
    "*** Update File: README.md",
    "@@",
    "-old",
    "+new",
    "*** End Patch",
  ].join("\n");
  const toolOutputs: unknown[] = [];

  const result = await continuePatchToolCalls({
    context: continuationBaseContext(),
    firstAssistantMessage: assistantMessageFixture({
      callId: "call_patch_apply",
      patch,
    }),
    firstResponseText: "",
    firstWorkflowResult: validPatchWorkflowResult({
      patch,
      toolCallId: "call_patch_apply",
    }),
    patchToolMode: "apply",
    root,
    stepBudget: 8,
    routeAssistantMessageToolCalls: async () => null,
    streamContinuation: async ({ assistantMessage, context, toolOutput }) => {
      toolOutputs.push(toolOutput);
      return {
        assistantMessage: textAssistantMessageFixture("Applied."),
        context: buildLlmToolContinuationContext({
          assistantMessage,
          context,
          toolOutput,
        }),
        responseText: "Applied.",
      };
    },
  });

  expect(await readFile(join(root, "README.md"), "utf8")).toBe("new\n");
  expect(toolOutputs).toEqual([
    expect.objectContaining({
      content: expect.stringContaining(
        "Success. Updated the following files:\nM README.md\n",
      ),
      isError: false,
      toolCallId: "call_patch_apply",
      toolName: "apply_patch",
    }),
  ]);
  expect(result).toMatchObject({
    applyStatus: "applied",
    kind: "patch",
    patch: {
      diffText: expect.stringContaining("-old\n+new"),
      status: "valid",
    },
    responseText: "Applied.",
  });
});

test("applies routed shell apply_patch calls in apply mode", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-shell-patch-loop-"));
  await writeFile(join(root, "README.md"), "old\n", "utf8");
  const patch = [
    "*** Begin Patch",
    "*** Update File: README.md",
    "@@",
    "-old",
    "+new",
    "*** End Patch",
  ].join("\n");
  const toolOutputs: unknown[] = [];

  const result = await continuePatchToolCalls({
    context: continuationBaseContext(),
    firstAssistantMessage: {
      ...assistantMessageFixture(),
      content: [
        {
          arguments: {
            command: `apply_patch <<'EOF'\n${patch}\nEOF`,
          },
          id: "call_shell_patch",
          name: "run_shell_command",
          type: "toolCall",
        },
      ],
    },
    firstResponseText: "",
    firstWorkflowResult: validPatchWorkflowResult({
      patch,
      toolCallId: "call_shell_patch",
    }),
    patchToolMode: "apply",
    root,
    stepBudget: 8,
    routeAssistantMessageToolCalls: async () => null,
    streamContinuation: async ({ assistantMessage, context, toolOutput }) => {
      toolOutputs.push(toolOutput);
      return {
        assistantMessage: textAssistantMessageFixture("Applied."),
        context: buildLlmToolContinuationContext({
          assistantMessage,
          context,
          toolOutput,
        }),
        responseText: "Applied.",
      };
    },
  });

  expect(await readFile(join(root, "README.md"), "utf8")).toBe("new\n");
  expect(toolOutputs).toEqual([
    expect.objectContaining({
      content: expect.stringContaining(
        "Success. Updated the following files:\nM README.md\n",
      ),
      isError: false,
      toolCallId: "call_shell_patch",
      toolName: "run_shell_command",
    }),
  ]);
  expect(result).toMatchObject({
    applyStatus: "applied",
    kind: "patch",
    patch: {
      diffText: expect.stringContaining("-old\n+new"),
      status: "valid",
    },
    responseText: "Applied.",
  });
});

test("applies multiple apply_patch tool calls before continuing in apply mode", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-patch-tool-loop-many-"));
  await writeFile(join(root, "first.txt"), "one\n", "utf8");
  await writeFile(join(root, "second.txt"), "two\n", "utf8");
  const firstPatch = [
    "*** Begin Patch",
    "*** Update File: first.txt",
    "@@",
    "-one",
    "+ONE",
    "*** End Patch",
  ].join("\n");
  const secondPatch = [
    "*** Begin Patch",
    "*** Update File: second.txt",
    "@@",
    "-two",
    "+TWO",
    "*** End Patch",
  ].join("\n");
  const appliedOutputs: unknown[][] = [];

  const result = await continueApplyPatchToolCalls({
    context: continuationBaseContext(),
    firstAssistantMessage: multiToolAssistantMessageFixture([
      { callId: "call_patch_1", patch: firstPatch },
      { callId: "call_patch_2", patch: secondPatch },
    ]),
    firstResponseText: "",
    root,
    stepBudget: 8,
    routeAssistantMessageToolCalls: async () => {
      throw new Error("No further workflow tools expected.");
    },
    streamContinuation: async ({ assistantMessage, context, toolOutputs }) => {
      appliedOutputs.push([...toolOutputs]);
      return {
        assistantMessage: textAssistantMessageFixture("Applied both."),
        context: buildLlmToolContinuationContext({
          assistantMessage,
          context,
          toolOutputs,
        }),
        responseText: "Applied both.",
      };
    },
  });

  expect(await readFile(join(root, "first.txt"), "utf8")).toBe("ONE\n");
  expect(await readFile(join(root, "second.txt"), "utf8")).toBe("TWO\n");
  expect(appliedOutputs).toEqual([
    [
      expect.objectContaining({
        isError: false,
        toolCallId: "call_patch_1",
      }),
      expect.objectContaining({
        isError: false,
        toolCallId: "call_patch_2",
      }),
    ],
  ]);
  expect(result).toMatchObject({
    applyStatus: "applied",
    kind: "patch",
    patch: {
      diffText: expect.stringContaining("-two\n+TWO"),
      status: "valid",
    },
    responseText: "Applied both.",
  });
});

test("stops patch apply continuations when the step budget is exhausted", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-patch-step-budget-"));
  await writeFile(join(root, "README.md"), "old\n", "utf8");
  const patch = [
    "*** Begin Patch",
    "*** Update File: README.md",
    "@@",
    "-old",
    "+new",
    "*** End Patch",
  ].join("\n");
  const toolOutputs: unknown[] = [];

  const result = await continuePatchToolCalls({
    context: continuationBaseContext(),
    firstAssistantMessage: assistantMessageFixture({
      callId: "call_patch_budget",
      patch,
    }),
    firstResponseText: "first apply",
    firstWorkflowResult: validPatchWorkflowResult({
      patch,
      toolCallId: "call_patch_budget",
    }),
    patchToolMode: "apply",
    root,
    stepBudget: 0,
    routeAssistantMessageToolCalls: async () => {
      throw new Error("No routing expected when step budget is zero.");
    },
    streamContinuation: async () => {
      throw new Error("No continuation expected when step budget is zero.");
    },
  });

  expect(await readFile(join(root, "README.md"), "utf8")).toBe("old\n");
  expect(toolOutputs).toHaveLength(0);
  expect(result).toMatchObject({
    kind: "patch",
    patch: { status: "valid" },
    responseText: "first apply",
  });
  expect("applyStatus" in result).toBe(false);
});

test("invalid patch retries consume the step budget and block later apply continuations", async () => {
  const context = continuationBaseContext();
  const retryAssistants = [
    assistantMessageFixture({ callId: "call_patch_2", patch: "bad patch 2" }),
    assistantMessageFixture({ callId: "call_patch_3", patch: "bad patch 3" }),
  ];
  const toolOutputs: unknown[] = [];

  const result = await continuePatchToolCalls({
    context,
    firstAssistantMessage: assistantMessageFixture({
      callId: "call_patch_1",
      patch: "bad patch 1",
    }),
    firstResponseText: "first malformed patch",
    firstWorkflowResult: invalidPatchWorkflowResult("first"),
    invalidRetryBudget: 3,
    patchToolMode: "apply",
    stepBudget: 2,
    routeAssistantMessageToolCalls: async () =>
      toolOutputs.length < 2
        ? invalidPatchWorkflowResult(`retry ${toolOutputs.length}`)
        : validPatchWorkflowResult(),
    streamContinuation: async ({ assistantMessage, context, toolOutput }) => {
      toolOutputs.push(toolOutput);
      return {
        assistantMessage: retryAssistants[toolOutputs.length - 1]!,
        context: buildLlmToolContinuationContext({
          assistantMessage,
          context,
          toolOutput,
        }),
        responseText: `malformed patch ${toolOutputs.length + 1}`,
      };
    },
  });

  expect(toolOutputs).toHaveLength(2);
  expect(result).toMatchObject({
    kind: "patch",
    patch: { status: "valid" },
    responseText: "malformed patch 3",
  });
  expect("applyStatus" in result).toBe(false);
});

test("stops apply_patch-only continuations when the step budget is exhausted", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-apply-patch-step-budget-"));
  await writeFile(join(root, "README.md"), "old\n", "utf8");
  const firstPatch = [
    "*** Begin Patch",
    "*** Update File: README.md",
    "@@",
    "-old",
    "+new",
    "*** End Patch",
  ].join("\n");
  const secondPatch = [
    "*** Begin Patch",
    "*** Update File: README.md",
    "@@",
    "-new",
    "+newer",
    "*** End Patch",
  ].join("\n");
  let continuationCount = 0;

  const result = await continueApplyPatchToolCalls({
    context: continuationBaseContext(),
    firstAssistantMessage: assistantMessageFixture({
      callId: "call_patch_1",
      patch: firstPatch,
    }),
    firstResponseText: "round 1",
    root,
    stepBudget: 1,
    routeAssistantMessageToolCalls: async () =>
      validPatchWorkflowResult({
        patch: secondPatch,
        toolCallId: "call_patch_exhausted",
      }),
    streamContinuation: async ({ assistantMessage, context, toolOutputs }) => {
      continuationCount += 1;
      return {
        assistantMessage: assistantMessageFixture({
          callId: "call_patch_2",
          patch: secondPatch,
        }),
        context: buildLlmToolContinuationContext({
          assistantMessage,
          context,
          toolOutputs,
        }),
        responseText: "round 2",
      };
    },
  });

  expect(await readFile(join(root, "README.md"), "utf8")).toBe("new\n");
  expect(continuationCount).toBe(1);
  expect(result).toMatchObject({
    kind: "patch",
    patch: {
      proposal: {
        patch: expect.stringContaining("-new\n+newer"),
      },
      status: "valid",
    },
    responseText: "round 2",
  });
});

function continuationBaseContext(): Context {
  return {
    messages: [
      {
        content: "Edit the selected file.",
        role: "user",
        timestamp: 1,
      },
    ],
    systemPrompt: "Patch carefully.",
    tools: [applyPatchTool],
  };
}

function invalidPatchWorkflowResult(label: string): LlmWorkflowToolResult {
  return {
    kind: "patch",
    patch: {
      errors: [
        {
          editIndex: 0,
          message: `${label} failed`,
          path: "README.md",
        },
      ],
      proposal: {
        patch: `${label} patch`,
        summary: `${label} summary`,
        toolCallId: `call_${label}`,
      },
      status: "invalid",
    },
  };
}

function validPatchWorkflowResult({
  patch = "fixed patch",
  toolCallId = "call_patch_3",
}: {
  patch?: string;
  toolCallId?: string;
} = {}): LlmWorkflowToolResult {
  return {
    kind: "patch",
    patch: {
      diffText: "diff --git a/README.md b/README.md",
      proposal: {
        patch,
        summary: "fixed summary",
        toolCallId,
      },
      status: "valid",
    },
  };
}

function assistantMessageFixture({
  callId = "call_patch|ctc_1",
  patch = "*** Begin Patch\n*** Update File: README.md\n@@\n-old\n+new\n*** End Patch\n",
}: {
  callId?: string;
  patch?: string;
} = {}): AssistantMessage {
  return {
    api: "openai-responses",
    content: [
      {
        arguments: {
          input: patch,
        },
        id: callId,
        name: "apply_patch",
        type: "toolCall",
      },
    ],
    model: "gpt-5.3-test",
    provider: "openai",
    role: "assistant",
    stopReason: "toolUse",
    timestamp: 2,
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: {
        cacheRead: 0,
        cacheWrite: 0,
        input: 0,
        output: 0,
        total: 0,
      },
      input: 0,
      output: 0,
      totalTokens: 0,
    },
  };
}

function multiToolAssistantMessageFixture(
  calls: readonly { callId: string; patch: string }[],
): AssistantMessage {
  return {
    ...assistantMessageFixture(),
    content: calls.map(({ callId, patch }) => ({
      arguments: { input: patch },
      id: callId,
      name: "apply_patch",
      type: "toolCall" as const,
    })),
  };
}

function textAssistantMessageFixture(text: string): AssistantMessage {
  return {
    api: "openai-responses",
    content: [{ text, type: "text" }],
    model: "gpt-5.3-test",
    provider: "openai",
    role: "assistant",
    stopReason: "stop",
    timestamp: 3,
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: {
        cacheRead: 0,
        cacheWrite: 0,
        input: 0,
        output: 0,
        total: 0,
      },
      input: 0,
      output: 0,
      totalTokens: 0,
    },
  };
}
