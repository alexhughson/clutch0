import { afterEach, expect, test } from "bun:test";
import {
  buildChatCompletionsBody,
  resetDirectLlmConnectionCacheForTests,
  streamDirectLlmResponse,
} from "./directLlmClient";
import type { LlmContext, LlmModel } from "./types";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetDirectLlmConnectionCacheForTests();
});

const model: LlmModel<"openai-completions"> = {
  api: "openai-completions",
  baseUrl: "https://api.openai.test/v1",
  contextWindow: 128_000,
  cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
  id: "gpt-test",
  input: ["text"],
  maxTokens: 16_384,
  name: "GPT Test",
  provider: "openai",
  reasoning: false,
};

const findFilesTool = {
  description: "Find files by query.",
  name: "find_relevant_files",
  parameters: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
};

test("collects OpenAI chat stream text and tool-call deltas into an assistant message", async () => {
  const requests: unknown[] = [];
  globalThis.fetch = (async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return sseResponse([
      {
        id: "chatcmpl_1",
        model: "gpt-test",
        choices: [
          {
            index: 0,
            finish_reason: null,
            delta: { role: "assistant", content: "I will search." },
          },
        ],
      },
      {
        choices: [
          {
            index: 0,
            finish_reason: null,
            delta: {
              tool_calls: [
                {
                  id: "call_1",
                  index: 0,
                  type: "function",
                  function: {
                    name: "find_relevant_files",
                    arguments: '{"query"',
                  },
                },
              ],
            },
          },
        ],
      },
      {
        choices: [
          {
            index: 0,
            finish_reason: "tool_calls",
            delta: {
              tool_calls: [
                { index: 0, function: { arguments: ':"llm client"}' } },
              ],
            },
          },
        ],
      },
      "[DONE]",
    ]);
  }) as typeof fetch;

  const context: LlmContext = {
    messages: [{ content: "Search now.", role: "user", timestamp: 1 }],
    systemPrompt: "Use tools.",
    tools: [findFilesTool],
  };

  const stream = streamDirectLlmResponse(model, context, { apiKey: "test-token" });
  const deltas: string[] = [];
  for await (const event of stream) {
    if (event.type === "text_delta") {
      deltas.push(event.delta);
    }
  }

  const message = await stream.result();
  expect(deltas).toEqual(["I will search."]);
  expect(message.responseId).toBe("chatcmpl_1");
  expect(message.stopReason).toBe("toolUse");
  expect(message.content).toEqual([
    { type: "text", text: "I will search." },
    {
      type: "toolCall",
      id: "call_1",
      name: "find_relevant_files",
      arguments: { query: "llm client" },
    },
  ]);
  expect(requests[0]).toMatchObject({
    model: "gpt-test",
    stream: true,
    messages: [
      { role: "system", content: "Use tools." },
      { role: "user", content: "Search now." },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "find_relevant_files",
          description: "Find files by query.",
          parameters: expect.objectContaining({ type: "object" }),
        },
      },
    ],
  });
});

test("builds multi-turn chat completion body with tool history", () => {
  const context: LlmContext = {
    messages: [
      { content: "Search now.", role: "user", timestamp: 1 },
      {
        api: "openai-completions",
        role: "assistant",
        provider: "openai",
        model: "gpt-test",
        timestamp: 2,
        stopReason: "toolUse",
        content: [
          { type: "text", text: "I will search." },
          {
            type: "toolCall",
            id: "call_1",
            name: "find_relevant_files",
            arguments: { query: "llm client" },
          },
        ],
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: {
            input: 0,
            output: 0,
            cacheRead: 0,
            cacheWrite: 0,
            total: 0,
          },
        },
      },
      {
        role: "toolResult",
        toolCallId: "call_1",
        toolName: "find_relevant_files",
        isError: false,
        timestamp: 3,
        content: [{ type: "text", text: "src/lib/llm/directLlmClient.ts" }],
      },
      { content: "Thanks.", role: "user", timestamp: 4 },
    ],
    systemPrompt: "Use tools.",
    tools: [findFilesTool],
  };

  const body = buildChatCompletionsBody(context, model, {}, false);

  expect(body).toEqual({
    model: "gpt-test",
    stream: false,
    tool_choice: "auto",
    messages: [
      { role: "system", content: "Use tools." },
      { role: "user", content: "Search now." },
      {
        role: "assistant",
        content: "I will search.",
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: {
              name: "find_relevant_files",
              arguments: JSON.stringify({ query: "llm client" }),
            },
          },
        ],
      },
      {
        role: "tool",
        tool_call_id: "call_1",
        content: "src/lib/llm/directLlmClient.ts",
      },
      { role: "user", content: "Thanks." },
    ],
    tools: [
      {
        type: "function",
        function: {
          name: "find_relevant_files",
          description: "Find files by query.",
          parameters: expect.objectContaining({ type: "object" }),
        },
      },
    ],
  });
});

function sseResponse(events: readonly (Record<string, unknown> | string)[]) {
  return new Response(
    events
      .map((event) =>
        typeof event === "string"
          ? `data: ${event}\n\n`
          : `data: ${JSON.stringify(event)}\n\n`,
      )
      .join(""),
    {
      headers: { "content-type": "text/event-stream" },
      status: 200,
    },
  );
}
