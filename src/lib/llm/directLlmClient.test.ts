import { Type } from "@earendil-works/pi-ai";
import { afterEach, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getClutchConfigPaths,
  saveClutchApiKey,
  saveClutchModelConfiguration,
} from "../config/clutchConfig";
import { generateContextItemSummary } from "./contextItemSummary";
import {
  buildChatCompletionsBody,
  completeDirectLlmResponse,
  getDirectLlmConnection,
  resetDirectLlmConnectionCacheForTests,
  streamDirectLlmResponse,
} from "./directLlmClient";
import type { LlmContext, LlmModel } from "./types";

const originalFetch = globalThis.fetch;
const originalConfigDir = process.env.CLUTCH_CONFIG_DIR;

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetDirectLlmConnectionCacheForTests();
  if (originalConfigDir === undefined) {
    delete process.env.CLUTCH_CONFIG_DIR;
  } else {
    process.env.CLUTCH_CONFIG_DIR = originalConfigDir;
  }
});

test("collects OpenAI chat stream text and tool-call deltas into an assistant message", async () => {
  const requests: unknown[] = [];
  globalThis.fetch = (async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return sseResponse([
      {
        choices: [
          {
            delta: { role: "assistant", content: "I will search." },
            finish_reason: null,
            index: 0,
          },
        ],
        id: "chatcmpl_1",
        model: "gpt-test",
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  id: "call_1",
                  index: 0,
                  type: "function",
                  function: {
                    name: "find_relevant_files",
                    arguments: "{\"query\"",
                  },
                },
              ],
            },
            finish_reason: null,
            index: 0,
          },
        ],
      },
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  function: {
                    arguments: ":\"llm client\"}",
                  },
                },
              ],
            },
            finish_reason: "tool_calls",
            index: 0,
          },
        ],
      },
      "[DONE]",
    ]);
  }) as typeof fetch;

  const stream = streamDirectLlmResponse(modelFixture(), contextFixture(), {
    apiKey: "test-token",
  });
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
    { text: "I will search.", type: "text" },
    {
      arguments: { query: "llm client" },
      id: "call_1",
      name: "find_relevant_files",
      type: "toolCall",
    },
  ]);
  expect(requests[0]).toMatchObject({
    messages: [
      { content: "Use tools.", role: "system" },
      { content: "Search now.", role: "user" },
    ],
    model: "gpt-test",
    stream: true,
    tools: [
      {
        function: {
          description: "Find files by query.",
          name: "find_relevant_files",
          parameters: expect.objectContaining({ type: "object" }),
        },
        type: "function",
      },
    ],
  });
});

test("reuses the same configured provider connection", () => {
  const model = modelFixture();
  const first = getDirectLlmConnection({
    apiKey: "test-token",
    headers: { "x-extra": "1" },
    model,
  });
  const second = getDirectLlmConnection({
    apiKey: "test-token",
    headers: { "x-extra": "1" },
    model,
  });

  expect(second).toBe(first);
});

test("context item summarization uses the direct completion path", async () => {
  const configDir = await mkdtemp(join(tmpdir(), "clutch-summary-direct-"));
  process.env.CLUTCH_CONFIG_DIR = configDir;
  const paths = getClutchConfigPaths(configDir);
  const model = modelFixture();
  saveClutchApiKey({ apiKey: "test-token", paths, provider: "openai" });
  saveClutchModelConfiguration({
    agent: { metadata: model as never, model: model.id, provider: "openai" },
    paths,
    primary: { metadata: model as never, model: model.id, provider: "openai" },
    summarization: {
      metadata: model as never,
      model: model.id,
      provider: "openai",
    },
  });

  const requests: unknown[] = [];
  globalThis.fetch = (async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return jsonResponse({
      choices: [
        {
          finish_reason: "stop",
          index: 0,
          message: {
            content: JSON.stringify({
              details: "A longer direct summary.",
              oneLine: "Direct summary",
            }),
            role: "assistant",
          },
        },
      ],
      id: "chatcmpl_summary",
      model: "gpt-test",
      usage: {
        completion_tokens: 8,
        prompt_tokens: 13,
        total_tokens: 21,
      },
    });
  }) as typeof fetch;

  const summary = await generateContextItemSummary({
    content: "important context",
    itemId: "file:src/a.ts",
    label: "src/a.ts",
    sourceHash: "hash-1",
    type: "file",
  });

  expect(summary).toMatchObject({
    details: "A longer direct summary.",
    oneLine: "Direct summary",
    sourceHash: "hash-1",
  });
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    messages: expect.any(Array),
    model: "gpt-test",
    stream: false,
  });
});

test("direct completion parses a non-streaming assistant response", async () => {
  globalThis.fetch = (async () =>
    jsonResponse({
      choices: [
        {
          finish_reason: "stop",
          index: 0,
          message: { content: "Done.", role: "assistant" },
        },
      ],
      model: "gpt-test",
    })) as unknown as typeof fetch;

  const message = await completeDirectLlmResponse(
    modelFixture(),
    contextFixture(),
    { apiKey: "test-token" },
  );

  expect(message.content).toEqual([{ text: "Done.", type: "text" }]);
});

test("direct completion charges cached input tokens once", async () => {
  globalThis.fetch = (async () =>
    jsonResponse({
      choices: [
        {
          finish_reason: "stop",
          index: 0,
          message: { content: "Done.", role: "assistant" },
        },
      ],
      model: "gpt-test",
      usage: {
        completion_tokens: 100,
        prompt_tokens: 1000,
        prompt_tokens_details: { cached_tokens: 800 },
        total_tokens: 1100,
      },
    })) as unknown as typeof fetch;

  const message = await completeDirectLlmResponse(
    {
      ...modelFixture(),
      cost: {
        cacheRead: 0.1,
        cacheWrite: 0,
        input: 1,
        output: 2,
      },
    },
    contextFixture(),
    { apiKey: "test-token" },
  );

  expect(message.usage).toMatchObject({
    cacheRead: 800,
    input: 200,
    output: 100,
    totalTokens: 1100,
  });
  expect(message.usage.cost.cacheRead).toBeCloseTo(0.00008);
  expect(message.usage.cost.input).toBeCloseTo(0.0002);
  expect(message.usage.cost.output).toBeCloseTo(0.0002);
  expect(message.usage.cost.total).toBeCloseTo(0.00048);
});

test("builds multi-turn chat completion body with tool history", () => {
  const body = buildChatCompletionsBody(
    multiTurnContextFixture(),
    modelFixture(),
    {},
    false,
  );

  expect(body).toEqual({
    messages: [
      { content: "Use tools.", role: "system" },
      { content: "Search now.", role: "user" },
      {
        content: "I will search.",
        role: "assistant",
        tool_calls: [
          {
            function: {
              arguments: JSON.stringify({ query: "llm client" }),
              name: "find_relevant_files",
            },
            id: "call_1",
            type: "function",
          },
        ],
      },
      {
        content: "src/lib/llm/directLlmClient.ts",
        role: "tool",
        tool_call_id: "call_1",
      },
      { content: "Thanks.", role: "user" },
    ],
    model: "gpt-test",
    stream: false,
    tool_choice: "auto",
    tools: [
      {
        function: {
          description: "Find files by query.",
          name: "find_relevant_files",
          parameters: expect.objectContaining({ type: "object" }),
        },
        type: "function",
      },
    ],
  });
});

test("injects service_tier when option is set", () => {
  const body = buildChatCompletionsBody(
    contextFixture(),
    modelFixture(),
    { serviceTier: "priority" },
    true,
  );

  expect(body.service_tier).toBe("priority");
});

test("injects reasoning effort when model supports it", () => {
  const body = buildChatCompletionsBody(
    contextFixture(),
    {
      ...modelFixture(),
      reasoning: true,
      thinkingLevelMap: { high: "high", low: "low", medium: "medium" },
    },
    { reasoningEffort: "high" },
    true,
  );

  expect(body.reasoning).toEqual({ effort: "high" });
});

test("omits reasoning for minimal effort", () => {
  const body = buildChatCompletionsBody(
    contextFixture(),
    { ...modelFixture(), reasoning: true },
    { reasoningEffort: "minimal" },
    true,
  );

  expect(body.reasoning).toBeUndefined();
});

test("rejects unsupported reasoning effort mapping", () => {
  expect(() =>
    buildChatCompletionsBody(
      contextFixture(),
      {
        ...modelFixture(),
        reasoning: true,
        thinkingLevelMap: { high: null },
      },
      { reasoningEffort: "high" },
      true,
    ),
  ).toThrow("Model openai/gpt-test cannot use effort level high.");
});

test("direct completion rejects unsupported direct API profiles", async () => {
  await expect(
    completeDirectLlmResponse(
      {
        ...modelFixture(),
        api: "openai-codex-responses",
        baseUrl: "https://chatgpt.com/backend-api",
        provider: "openai-codex",
      },
      contextFixture(),
      { apiKey: "test-token" },
    ),
  ).rejects.toThrow(
    "Unsupported direct LLM provider/api combination: provider=openai-codex model=gpt-test api=openai-codex-responses.",
  );
});

function multiTurnContextFixture(): LlmContext {
  return {
    messages: [
      { content: "Search now.", role: "user", timestamp: 1 },
      {
        api: "openai-completions",
        content: [
          { text: "I will search.", type: "text" },
          {
            arguments: { query: "llm client" },
            id: "call_1",
            name: "find_relevant_files",
            type: "toolCall",
          },
        ],
        model: "gpt-test",
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
      },
      {
        content: [{ text: "src/lib/llm/directLlmClient.ts", type: "text" }],
        isError: false,
        role: "toolResult",
        timestamp: 3,
        toolCallId: "call_1",
        toolName: "find_relevant_files",
      },
      { content: "Thanks.", role: "user", timestamp: 4 },
    ],
    systemPrompt: "Use tools.",
    tools: [
      {
        description: "Find files by query.",
        name: "find_relevant_files",
        parameters: Type.Object({
          query: Type.String(),
        }),
      },
    ],
  };
}

function contextFixture(): LlmContext {
  return {
    messages: [{ content: "Search now.", role: "user", timestamp: 1 }],
    systemPrompt: "Use tools.",
    tools: [
      {
        description: "Find files by query.",
        name: "find_relevant_files",
        parameters: Type.Object({
          query: Type.String(),
        }),
      },
    ],
  };
}

function modelFixture(): LlmModel<"openai-completions"> {
  return {
    api: "openai-completions",
    baseUrl: "https://api.openai.test/v1",
    contextWindow: 128_000,
    cost: {
      cacheRead: 0,
      cacheWrite: 0,
      input: 0,
      output: 0,
    },
    id: "gpt-test",
    input: ["text"],
    maxTokens: 16_384,
    name: "GPT Test",
    provider: "openai",
    reasoning: false,
  };
}

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

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}
