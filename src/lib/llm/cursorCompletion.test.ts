import { expect, test } from "bun:test";
import type { InteractionUpdate, SDKCustomTool } from "@cursor/sdk";
import {
  Type,
  type Api,
  type Context,
  type Model,
  type Tool,
} from "@earendil-works/pi-ai";
import {
  cursorModelSelectionFromMetadata,
  formatCursorCompletionPrompt,
  streamCursorCompletion,
  type CursorCompletionAgentApi,
} from "./cursorCompletion";

type CapturedRun = {
  input?: unknown;
  options?: {
    customTools?: Record<string, SDKCustomTool>;
    mcpServersOverride?: unknown;
    mode?: string;
    model?: unknown;
  };
};

test("streams Cursor Composer text through the local executor", async () => {
  const capturedRun: CapturedRun = {};
  let leaseOptions: Record<string, unknown> | null = null;
  let released = false;
  const agentApi: CursorCompletionAgentApi = {
    createAgentPlatform: async () => ({
      acquireLocalExecutor: async (options) => {
        leaseOptions = options as unknown as Record<string, unknown>;
        return {
          handle: {
            run: async (input, options, listener) => {
              capturedRun.input = input;
              capturedRun.options = options;
              await listener.sendUpdate({
                text: "hello",
                type: "text-delta",
              });
              await listener.sendUpdate({
                text: " world",
                type: "text-delta",
              });
              return {
                abort: () => undefined,
                done: Promise.resolve(),
              };
            },
          },
          release: async () => {
            released = true;
          },
        };
      },
    }),
  };
  const deltas: string[] = [];

  const result = await streamCursorCompletion({
    agentApi,
    apiKey: "cursor-token",
    context: {
      messages: [{ content: "Say hi", role: "user", timestamp: 1 }],
      systemPrompt: "You are brief.",
    },
    model: cursorModelFixture(),
    onDelta: (delta) => deltas.push(delta),
    root: "/workspace",
  });

  expect(result).toEqual({ kind: "text", responseText: "hello world" });
  expect(deltas).toEqual(["hello", " world"]);
  expect(capturedRun.input).toEqual({
    text: [
      "<system>\nYou are brief.\n</system>",
      "<user>\nSay hi\n</user>",
      "Respond with only the assistant message for this Clutch request. Do not modify files, run commands, or call tools.",
    ].join("\n\n"),
  });
  expect(capturedRun.options).toMatchObject({
    mcpServersOverride: {},
    mode: "plan",
    model: {
      id: "composer-2.5",
      params: [{ id: "speed", value: "fast" }],
    },
  });
  expect(leaseOptions).toMatchObject({
    apiKey: "cursor-token",
    mcpServers: {},
    sandboxOptions: { enabled: false },
    settingSources: [],
    workingDirectory: "/workspace",
  });
  expect(released).toBe(true);
});

test("captures SDK custom tool execution as a Clutch tool call", async () => {
  const controller = abortableController();
  const capturedRun: CapturedRun = {};
  const agentApi: CursorCompletionAgentApi = {
    createAgentPlatform: async () => ({
      acquireLocalExecutor: async () => ({
        handle: {
          run: async (_input, options) => {
            capturedRun.options = options;
            const tool = options.customTools?.find_relevant_files;
            if (tool === undefined) {
              throw new Error("Expected Cursor custom tool");
            }
            await tool.execute(
              {
                goal: "Find auth routing",
                hints: ["auth"],
              },
              {},
            );
            return controller;
          },
        },
        release: async () => undefined,
      }),
    }),
  };

  const result = await streamCursorCompletion({
    agentApi,
    apiKey: "cursor-token",
    context: {
      messages: [{ content: "Find auth code", role: "user", timestamp: 1 }],
      tools: [findRelevantFilesToolFixture()],
    },
    model: cursorModelFixture(),
  });

  expect(capturedRun.options).toMatchObject({
    mode: "plan",
  });
  expect(capturedRun.options?.customTools?.find_relevant_files).toMatchObject({
    description: "Find project files",
    inputSchema: findRelevantFilesToolFixture().parameters,
  });
  expect(controller.aborted()).toBe(true);
  expect(result).toEqual({
    kind: "toolCalls",
    responseText: "",
    toolCalls: [
      {
        arguments: {
          goal: "Find auth routing",
          hints: ["auth"],
        },
        id: expect.stringMatching(/^cursor-/),
        name: "find_relevant_files",
        type: "toolCall",
      },
    ],
  });
});

test("captures custom-user-tools MCP updates as Clutch tool calls", async () => {
  const controller = abortableController();
  const agentApi: CursorCompletionAgentApi = {
    createAgentPlatform: async () => ({
      acquireLocalExecutor: async () => ({
        handle: {
          run: async (_input, _options, listener) => {
            await listener.sendUpdate({
              callId: "call-1",
              modelCallId: "model-call-1",
              toolCall: {
                args: {
                  args: { goal: "Find auth routing" },
                  providerIdentifier: "custom-user-tools",
                  toolName: "find_relevant_files",
                },
                type: "mcp",
              },
              type: "tool-call-completed",
            } as unknown as InteractionUpdate);
            return controller;
          },
        },
        release: async () => undefined,
      }),
    }),
  };

  const result = await streamCursorCompletion({
    agentApi,
    apiKey: "cursor-token",
    context: {
      messages: [{ content: "Find auth code", role: "user", timestamp: 1 }],
      tools: [findRelevantFilesToolFixture()],
    },
    model: cursorModelFixture(),
  });

  expect(controller.aborted()).toBe(true);
  expect(result).toEqual({
    kind: "toolCalls",
    responseText: "",
    toolCalls: [
      {
        arguments: { goal: "Find auth routing" },
        id: "call-1",
        name: "find_relevant_files",
        type: "toolCall",
      },
    ],
  });
});

test("fails if Composer tries to use a Cursor built-in tool", async () => {
  let released = false;
  const agentApi: CursorCompletionAgentApi = {
    createAgentPlatform: async () => ({
      acquireLocalExecutor: async () => ({
        handle: {
          run: async (_input, _options, listener) => {
            await listener.sendUpdate({
              callId: "call-1",
              modelCallId: "model-call-1",
              toolCall: {
                args: {
                  command: "echo nope",
                },
                type: "shell",
              },
              type: "tool-call-started",
            } as unknown as InteractionUpdate);
            throw new Error("unreachable");
          },
        },
        release: async () => {
          released = true;
        },
      }),
    }),
  };

  await expect(
    streamCursorCompletion({
      agentApi,
      apiKey: "cursor-token",
      context: {
        messages: [{ content: "Run echo", role: "user", timestamp: 1 }],
        tools: [findRelevantFilesToolFixture()],
      },
      model: cursorModelFixture(),
    }),
  ).rejects.toThrow("Cursor Composer tried to call a Cursor built-in tool");
  expect(released).toBe(true);
});

test("formats Cursor prompt text and rejects non-text blocks", () => {
  expect(
    formatCursorCompletionPrompt({
      messages: [
        {
          content: [{ text: "Explain Clutch", type: "text" }],
          role: "user",
          timestamp: 1,
        },
      ],
    }),
  ).toContain("<user>\nExplain Clutch\n</user>");
  expect(
    formatCursorCompletionPrompt({
      messages: [{ content: "Find files", role: "user", timestamp: 1 }],
      tools: [findRelevantFilesToolFixture()],
    }),
  ).toContain("call exactly one available Clutch custom tool");

  expect(() =>
    formatCursorCompletionPrompt({
      messages: [
        {
          content: [
            {
              data: "abc",
              mimeType: "image/png",
              type: "image",
            },
          ],
          role: "user",
          timestamp: 1,
        },
      ],
    } satisfies Context),
  ).toThrow("only support text context");
});

test("reads Cursor model selections from Clutch metadata", () => {
  expect(cursorModelSelectionFromMetadata(cursorModelFixture())).toEqual({
    id: "composer-2.5",
    params: [{ id: "speed", value: "fast" }],
  });
  expect(
    cursorModelSelectionFromMetadata({
      ...cursorModelFixture(),
      compat: undefined,
      id: "composer-2.5",
    }),
  ).toEqual({ id: "composer-2.5" });
  expect(
    cursorModelSelectionFromMetadata({
      ...cursorModelFixture(),
      compat: {
        cursorModelSelection: {
          id: "composer-2.5",
          params: [{ id: "fast", value: "false" }],
        },
      } as Model<Api>["compat"],
      id: "composer-2.5:composer-2-5",
    }),
  ).toEqual({
    id: "composer-2.5",
    params: [{ id: "fast", value: "true" }],
  });
});

function cursorModelFixture(): Model<Api> {
  return {
    api: "cursor-agent",
    baseUrl: "cursor-sdk://agent",
    compat: {
      cursorModelSelection: {
        id: "composer-2.5",
        params: [{ id: "speed", value: "fast" }],
      },
    } as Model<Api>["compat"],
    contextWindow: 128_000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id: "composer-2.5:fast",
    input: ["text"],
    maxTokens: 32_000,
    name: "Composer 2.5 (Fast)",
    provider: "cursor",
    reasoning: false,
  };
}

function findRelevantFilesToolFixture(): Tool {
  return {
    description: "Find project files",
    name: "find_relevant_files",
    parameters: Type.Object({
      goal: Type.String(),
      hints: Type.Optional(Type.Array(Type.String())),
    }),
  };
}

function abortableController() {
  let aborted = false;
  let rejectDone: (reason: Error) => void = () => undefined;
  const done = new Promise<void>((_resolve, reject) => {
    rejectDone = reject;
  });

  return {
    abort: () => {
      if (aborted) {
        return;
      }
      aborted = true;
      rejectDone(new Error("Cursor run aborted"));
    },
    aborted: () => aborted,
    done,
  };
}
