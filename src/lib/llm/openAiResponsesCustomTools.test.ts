import {
  createAssistantMessageEventStream,
  Type,
  type AssistantMessage,
  type Model,
} from "@earendil-works/pi-ai";
import { expect, test } from "bun:test";
import { applyPatchTool } from "./patchTool";
import {
  buildOpenAiCodexResponsesCustomToolBody,
  buildOpenAiResponsesCustomToolParams,
  canUseOpenAiResponsesCustomTools,
  openAiResponsesToolFromClutchTool,
  processOpenAiResponsesCustomToolStream,
} from "./openAiResponsesCustomTools";

test("converts apply_patch to a Responses custom grammar tool", () => {
  const tool = openAiResponsesToolFromClutchTool(applyPatchTool);

  expect(tool).toMatchObject({
    format: {
      syntax: "lark",
      type: "grammar",
    },
    name: "apply_patch",
    type: "custom",
  });
  const definition = (tool as { format: { definition: string } }).format
    .definition;
  expect(definition).toContain("start: begin_patch hunk+ end_patch");
  expect(definition).not.toContain("environment_id");
});

test("keeps non-patch tools as Responses function tools", () => {
  const tool = openAiResponsesToolFromClutchTool({
    description: "Find files",
    name: "find_relevant_files",
    parameters: Type.Object({
      query: Type.String(),
    }),
  });

  expect(tool).toMatchObject({
    name: "find_relevant_files",
    strict: false,
    type: "function",
  });
});

test("builds a custom-tool Responses payload when apply_patch is available", () => {
  const model = modelFixture();
  const context = {
    messages: [
      {
        content: "Please edit the selected file.",
        role: "user" as const,
        timestamp: 1,
      },
    ],
    systemPrompt: "Patch carefully.",
    tools: [applyPatchTool],
  };

  expect(canUseOpenAiResponsesCustomTools({ context, model })).toBe(true);

  const params = buildOpenAiResponsesCustomToolParams({
    context,
    model,
    options: {
      apiKey: "test",
      reasoningEffort: "low",
    },
  });

  expect(params).toMatchObject({
    instructions: "Patch carefully.",
    model: "gpt-5.3-test",
    parallel_tool_calls: false,
    reasoning: {
      effort: "low",
      summary: "auto",
    },
    store: false,
    stream: true,
    tool_choice: "auto",
  });
  expect(params.tools).toEqual([
    expect.objectContaining({ name: "apply_patch", type: "custom" }),
  ]);
});

test("serializes apply_patch tool results as custom tool outputs", () => {
  const model = modelFixture();
  const params = buildOpenAiResponsesCustomToolParams({
    context: {
      messages: [
        {
          api: "openai-responses",
          content: [
            {
              arguments: {
                input:
                  "*** Begin Patch\n*** Add File: hello.txt\n+hello\n*** End Patch\n",
              },
              id: "call_patch|ctc_1",
              name: "apply_patch",
              type: "toolCall" as const,
            },
          ],
          model: "gpt-5.3-test",
          provider: "openai",
          role: "assistant" as const,
          stopReason: "toolUse" as const,
          timestamp: 1,
          usage: emptyUsageFixture(),
        },
        {
          content: [
            { text: "Exit code: 0\nWall time: 0 seconds", type: "text" },
          ],
          isError: false,
          role: "toolResult" as const,
          timestamp: 2,
          toolCallId: "call_patch|ctc_1",
          toolName: "apply_patch",
        },
      ],
      tools: [applyPatchTool],
    },
    model,
    options: { apiKey: "test" },
  });

  expect(params.input).toContainEqual({
    call_id: "call_patch",
    input: "*** Begin Patch\n*** Add File: hello.txt\n+hello\n*** End Patch\n",
    name: "apply_patch",
    type: "custom_tool_call",
  });
  expect(params.input).toContainEqual({
    call_id: "call_patch",
    output: "Exit code: 0\nWall time: 0 seconds",
    type: "custom_tool_call_output",
  });
});

test("keeps non-patch tool results as function outputs", () => {
  const model = modelFixture();
  const params = buildOpenAiResponsesCustomToolParams({
    context: {
      messages: [
        {
          api: "openai-responses",
          content: [
            {
              arguments: { query: "button handler" },
              id: "call_find",
              name: "find_relevant_files",
              type: "toolCall" as const,
            },
          ],
          model: "gpt-5.3-test",
          provider: "openai",
          role: "assistant" as const,
          stopReason: "toolUse" as const,
          timestamp: 1,
          usage: emptyUsageFixture(),
        },
        {
          content: [{ text: "found files", type: "text" }],
          isError: false,
          role: "toolResult" as const,
          timestamp: 2,
          toolCallId: "call_find",
          toolName: "find_relevant_files",
        },
      ],
      tools: [applyPatchTool],
    },
    model,
    options: { apiKey: "test" },
  });

  expect(params.input).toContainEqual({
    arguments: JSON.stringify({ query: "button handler" }),
    call_id: "call_find",
    name: "find_relevant_files",
    type: "function_call",
  });
  expect(params.input).toContainEqual({
    call_id: "call_find",
    output: "found files",
    type: "function_call_output",
  });
});

test("builds a custom-tool Codex subscription payload", () => {
  const model = modelFixture("openai-codex-responses", "openai-codex");
  const context = {
    messages: [
      {
        content: "Please edit the selected file.",
        role: "user" as const,
        timestamp: 1,
      },
    ],
    systemPrompt: "Patch carefully.",
    tools: [applyPatchTool],
  };

  expect(canUseOpenAiResponsesCustomTools({ context, model })).toBe(true);

  const body = buildOpenAiCodexResponsesCustomToolBody({
    context,
    model,
    options: {
      apiKey: "test",
      reasoning: "low",
    },
  });

  expect(body).toMatchObject({
    instructions: "Patch carefully.",
    model: "gpt-5.3-test",
    parallel_tool_calls: false,
    reasoning: {
      effort: "low",
      summary: "auto",
    },
    store: false,
    stream: true,
    text: { verbosity: "low" },
    tool_choice: "auto",
  });
  expect(body.tools).toEqual([
    expect.objectContaining({ name: "apply_patch", type: "custom" }),
  ]);
});

test("normalizes streamed custom apply_patch input into a Clutch tool call", async () => {
  const stream = createAssistantMessageEventStream();
  const output = assistantMessageFixture();
  const progresses: unknown[] = [];

  await processOpenAiResponsesCustomToolStream({
    events: asyncEvents([
      {
        item: {
          call_id: "call_1",
          id: "ctc_1",
          name: "apply_patch",
          type: "custom_tool_call",
        },
        type: "response.output_item.added",
      },
      {
        delta: "*** Begin Patch\n",
        type: "response.custom_tool_call_input.delta",
      },
      {
        delta: "*** Add File: hello.txt\n+hello\n*** End Patch\n",
        type: "response.custom_tool_call_input.delta",
      },
      {
        item: {
          call_id: "call_1",
          id: "ctc_1",
          input:
            "*** Begin Patch\n*** Add File: hello.txt\n+hello\n*** End Patch\n",
          name: "apply_patch",
          type: "custom_tool_call",
        },
        type: "response.output_item.done",
      },
      {
        response: {
          status: "completed",
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            total_tokens: 15,
          },
        },
        type: "response.completed",
      },
    ]),
    model: modelFixture(),
    onPatchProgress: (progress) => progresses.push(progress),
    output,
    stream,
  });

  expect(progresses).toEqual([
    {
      files: [{ operation: "add", path: "hello.txt" }],
      patchCharacterCount: 61,
    },
  ]);
  expect(output.stopReason).toBe("toolUse");
  expect(output.content).toEqual([
    {
      arguments: {
        input:
          "*** Begin Patch\n*** Add File: hello.txt\n+hello\n*** End Patch\n",
      },
      id: "call_1|ctc_1",
      name: "apply_patch",
      type: "toolCall",
    },
  ]);
});

test("normalizes custom apply_patch input.done events", async () => {
  const stream = createAssistantMessageEventStream();
  const output = assistantMessageFixture();
  const progresses: unknown[] = [];
  const patch =
    "*** Begin Patch\n*** Add File: hello.txt\n+hello\n*** End Patch\n";

  await processOpenAiResponsesCustomToolStream({
    events: asyncEvents([
      {
        item: {
          call_id: "call_1",
          id: "ctc_1",
          name: "apply_patch",
          type: "custom_tool_call",
        },
        output_index: 0,
        type: "response.output_item.added",
      },
      {
        input: patch,
        item_id: "ctc_1",
        output_index: 0,
        type: "response.custom_tool_call_input.done",
      },
      {
        item: {
          call_id: "call_1",
          id: "ctc_1",
          name: "apply_patch",
          type: "custom_tool_call",
        },
        output_index: 0,
        type: "response.output_item.done",
      },
      {
        response: {
          status: "completed",
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            total_tokens: 15,
          },
        },
        type: "response.completed",
      },
    ]),
    model: modelFixture(),
    onPatchProgress: (progress) => progresses.push(progress),
    output,
    stream,
  });

  expect(progresses).toEqual([
    {
      files: [{ operation: "add", path: "hello.txt" }],
      patchCharacterCount: patch.length,
    },
  ]);
  expect(output.content).toEqual([
    {
      arguments: { input: patch },
      id: "call_1|ctc_1",
      name: "apply_patch",
      type: "toolCall",
    },
  ]);
});

test("keeps interleaved custom apply_patch stream chunks attached to the right tool call", async () => {
  const stream = createAssistantMessageEventStream();
  const output = assistantMessageFixture();
  const progresses: unknown[] = [];
  const patchOneHeader = "*** Begin Patch\n*** Add File: one.txt\n";
  const patchTwoHeader = "*** Begin Patch\n*** Add File: two.txt\n";
  const patchOne =
    "*** Begin Patch\n*** Add File: one.txt\n+one\n*** End Patch\n";
  const patchTwo =
    "*** Begin Patch\n*** Add File: two.txt\n+two\n*** End Patch\n";

  await processOpenAiResponsesCustomToolStream({
    events: asyncEvents([
      {
        item: {
          call_id: "call_one",
          id: "ctc_one",
          name: "apply_patch",
          type: "custom_tool_call",
        },
        output_index: 0,
        type: "response.output_item.added",
      },
      {
        item: {
          call_id: "call_two",
          id: "ctc_two",
          name: "apply_patch",
          type: "custom_tool_call",
        },
        output_index: 1,
        type: "response.output_item.added",
      },
      {
        delta: patchOneHeader,
        item_id: "ctc_one",
        output_index: 0,
        type: "response.custom_tool_call_input.delta",
      },
      {
        delta: patchTwoHeader,
        item_id: "ctc_two",
        output_index: 1,
        type: "response.custom_tool_call_input.delta",
      },
      {
        delta: "+one\n*** End Patch\n",
        item_id: "ctc_one",
        output_index: 0,
        type: "response.custom_tool_call_input.delta",
      },
      {
        delta: "+two\n*** End Patch\n",
        item_id: "ctc_two",
        output_index: 1,
        type: "response.custom_tool_call_input.delta",
      },
      {
        item: {
          call_id: "call_two",
          id: "ctc_two",
          input: patchTwo,
          name: "apply_patch",
          type: "custom_tool_call",
        },
        output_index: 1,
        type: "response.output_item.done",
      },
      {
        item: {
          call_id: "call_one",
          id: "ctc_one",
          input: patchOne,
          name: "apply_patch",
          type: "custom_tool_call",
        },
        output_index: 0,
        type: "response.output_item.done",
      },
      {
        response: {
          status: "completed",
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            total_tokens: 15,
          },
        },
        type: "response.completed",
      },
    ]),
    model: modelFixture(),
    onPatchProgress: (progress) => progresses.push(progress),
    output,
    stream,
  });

  expect(progresses).toEqual([
    {
      files: [{ operation: "add", path: "one.txt" }],
      patchCharacterCount: patchOneHeader.length,
    },
    {
      files: [{ operation: "add", path: "two.txt" }],
      patchCharacterCount: patchTwoHeader.length,
    },
    {
      files: [{ operation: "add", path: "one.txt" }],
      patchCharacterCount: patchOne.length,
    },
    {
      files: [{ operation: "add", path: "two.txt" }],
      patchCharacterCount: patchTwo.length,
    },
  ]);
  expect(output.content).toEqual([
    {
      arguments: { input: patchOne },
      id: "call_one|ctc_one",
      name: "apply_patch",
      type: "toolCall",
    },
    {
      arguments: { input: patchTwo },
      id: "call_two|ctc_two",
      name: "apply_patch",
      type: "toolCall",
    },
  ]);
});

test("routes interleaved custom apply_patch stream chunks by call_id", async () => {
  const stream = createAssistantMessageEventStream();
  const output = assistantMessageFixture();
  const progresses: unknown[] = [];
  const patchOneHeader = "*** Begin Patch\n*** Add File: one.txt\n";
  const patchTwoHeader = "*** Begin Patch\n*** Add File: two.txt\n";
  const patchOne =
    "*** Begin Patch\n*** Add File: one.txt\n+one\n*** End Patch\n";
  const patchTwo =
    "*** Begin Patch\n*** Add File: two.txt\n+two\n*** End Patch\n";

  await processOpenAiResponsesCustomToolStream({
    events: asyncEvents([
      {
        item: {
          call_id: "call_one",
          name: "apply_patch",
          type: "custom_tool_call",
        },
        type: "response.output_item.added",
      },
      {
        item: {
          call_id: "call_two",
          name: "apply_patch",
          type: "custom_tool_call",
        },
        type: "response.output_item.added",
      },
      {
        call_id: "call_one",
        delta: patchOneHeader,
        type: "response.custom_tool_call_input.delta",
      },
      {
        call_id: "call_two",
        delta: patchTwoHeader,
        type: "response.custom_tool_call_input.delta",
      },
      {
        call_id: "call_one",
        delta: "+one\n*** End Patch\n",
        type: "response.custom_tool_call_input.delta",
      },
      {
        call_id: "call_two",
        delta: "+two\n*** End Patch\n",
        type: "response.custom_tool_call_input.delta",
      },
      {
        item: {
          call_id: "call_two",
          input: patchTwo,
          name: "apply_patch",
          type: "custom_tool_call",
        },
        type: "response.output_item.done",
      },
      {
        item: {
          call_id: "call_one",
          input: patchOne,
          name: "apply_patch",
          type: "custom_tool_call",
        },
        type: "response.output_item.done",
      },
      {
        response: {
          status: "completed",
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            total_tokens: 15,
          },
        },
        type: "response.completed",
      },
    ]),
    model: modelFixture(),
    onPatchProgress: (progress) => progresses.push(progress),
    output,
    stream,
  });

  expect(progresses).toEqual([
    {
      files: [{ operation: "add", path: "one.txt" }],
      patchCharacterCount: patchOneHeader.length,
    },
    {
      files: [{ operation: "add", path: "two.txt" }],
      patchCharacterCount: patchTwoHeader.length,
    },
    {
      files: [{ operation: "add", path: "one.txt" }],
      patchCharacterCount: patchOne.length,
    },
    {
      files: [{ operation: "add", path: "two.txt" }],
      patchCharacterCount: patchTwo.length,
    },
  ]);
  expect(output.content).toEqual([
    {
      arguments: { input: patchOne },
      id: "call_one",
      name: "apply_patch",
      type: "toolCall",
    },
    {
      arguments: { input: patchTwo },
      id: "call_two",
      name: "apply_patch",
      type: "toolCall",
    },
  ]);
});

test("normalizes Codex-shaped custom apply_patch calls without an output item id", async () => {
  const stream = createAssistantMessageEventStream();
  const output = assistantMessageFixture();
  const progresses: unknown[] = [];
  const patch =
    "*** Begin Patch\n*** Add File: hello.txt\n+hello\n*** End Patch\n";

  await processOpenAiResponsesCustomToolStream({
    events: asyncEvents([
      {
        item: {
          call_id: "call_patch",
          input: patch,
          name: "apply_patch",
          type: "custom_tool_call",
        },
        type: "response.output_item.done",
      },
      {
        response: {
          status: "completed",
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            total_tokens: 15,
          },
        },
        type: "response.completed",
      },
    ]),
    model: modelFixture(),
    onPatchProgress: (progress) => progresses.push(progress),
    output,
    stream,
  });

  expect(progresses).toEqual([
    {
      files: [{ operation: "add", path: "hello.txt" }],
      patchCharacterCount: patch.length,
    },
  ]);
  expect(output.stopReason).toBe("toolUse");
  expect(output.content).toEqual([
    {
      arguments: { input: patch },
      id: "call_patch",
      name: "apply_patch",
      type: "toolCall",
    },
  ]);
});

test("normalizes done-only function calls into a Clutch tool call", async () => {
  const stream = createAssistantMessageEventStream();
  const output = assistantMessageFixture();

  await processOpenAiResponsesCustomToolStream({
    events: asyncEvents([
      {
        item: {
          arguments: JSON.stringify({ query: "button handler" }),
          call_id: "call_find",
          id: "fc_1",
          name: "find_relevant_files",
          type: "function_call",
        },
        type: "response.output_item.done",
      },
      {
        response: {
          status: "completed",
          usage: {
            input_tokens: 10,
            output_tokens: 5,
            total_tokens: 15,
          },
        },
        type: "response.completed",
      },
    ]),
    model: modelFixture(),
    output,
    stream,
  });

  expect(output.stopReason).toBe("toolUse");
  expect(output.content).toEqual([
    {
      arguments: { query: "button handler" },
      id: "call_find|fc_1",
      name: "find_relevant_files",
      type: "toolCall",
    },
  ]);
});

async function* asyncEvents(events: readonly unknown[]) {
  for (const event of events) {
    yield event;
  }
}

function modelFixture<
  TApi extends "openai-responses" | "openai-codex-responses",
>(api: TApi = "openai-responses" as TApi, provider = "openai"): Model<TApi> {
  return {
    api,
    baseUrl: "https://api.openai.com/v1",
    contextWindow: 128_000,
    cost: {
      cacheRead: 0,
      cacheWrite: 0,
      input: 0,
      output: 0,
    },
    headers: {},
    id: "gpt-5.3-test",
    input: ["text"],
    maxTokens: 128_000,
    name: "GPT test",
    provider,
    reasoning: true,
    thinkingLevelMap: {},
  };
}

function assistantMessageFixture(): AssistantMessage {
  return {
    api: "openai-responses",
    content: [],
    model: "gpt-5.3-test",
    provider: "openai",
    role: "assistant",
    stopReason: "stop",
    timestamp: 1,
    usage: emptyUsageFixture(),
  };
}

function emptyUsageFixture(): AssistantMessage["usage"] {
  return {
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
  };
}
