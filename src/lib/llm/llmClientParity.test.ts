import { Type } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, test } from "bun:test";
import {
  buildDirectRequest,
  createLegacyAssistantAccumulator,
  legacyFiatProgramFromStreamEvent,
} from "./__legacy__/directLlmClient";
import { configuredLlmRequestOptions as legacyConfiguredLlmRequestOptions } from "./__legacy__/requestOptions";
import { configuredLlmRequestOptions } from "./requestOptions";
import {
  buildLlmProgram,
  clientVariantForModel,
  translatorForModel,
} from "./llmProgram";
import type { LlmRequestOptions } from "./llmProgram";
import {
  completeDirectLlmResponse,
  streamDirectLlmResponse,
  resetDirectLlmConnectionCacheForTests,
} from "./llmClient";
import {
  createAssistantMessageEventStream,
  emptyLlmUsage,
  type AssistantMessageEvent,
  type LlmAssistantMessage,
  type LlmContext,
  type LlmModel,
} from "./types";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  resetDirectLlmConnectionCacheForTests();
});

/**
 * Divergences where legacy HEAD + fiat v0.2 translators disagree solely because
 * fiat v0.2 promoted fields from dialect residuals to core ops.
 */
const KNOWN_DIFFERENCES = [
  {
    fixture: "openai-responses priority+reasoning",
    field: "responseId",
    legacyValue: undefined,
    newValue: "resp_1",
    justification:
      "fiat v0.2 emits response.id core op; legacy read id from openai_responses.body_field residual",
  },
  {
    fixture: "openai-responses priority+reasoning",
    field: "usage.cacheRead",
    legacyValue: 0,
    newValue: 4,
    justification:
      "fiat v0.2 promotes cached_tokens into response.usage.cacheReadTokens; legacy read input_tokens_details via openai_responses.usage residual",
  },
  {
    fixture: "openai-responses priority+reasoning",
    field: "usage.input",
    legacyValue: 12,
    newValue: 8,
    justification:
      "cache subtraction follows promoted cacheReadTokens in adapter mapUsage; legacy never saw cached_tokens on stripped openai_responses.usage",
  },
  {
    fixture: "openrouter gemini-3 medium+priority",
    field: "responseId",
    legacyValue: undefined,
    newValue: "chatcmpl_1",
    justification:
      "fiat v0.2 emits response.id core op; legacy read id from openai_chat.body_field residual",
  },
  {
    fixture: "openrouter gpt-5 off",
    field: "responseId",
    legacyValue: undefined,
    newValue: "chatcmpl_1",
    justification:
      "fiat v0.2 emits response.id core op; legacy read id from openai_chat.body_field residual",
  },
  {
    fixture: "openrouter gemini-3 off+priority",
    field: "responseId",
    legacyValue: undefined,
    newValue: "chatcmpl_1",
    justification:
      "fiat v0.2 emits response.id core op; legacy read id from openai_chat.body_field residual",
  },
  {
    fixture: "openrouter grok medium",
    field: "responseId",
    legacyValue: undefined,
    newValue: "chatcmpl_1",
    justification:
      "fiat v0.2 emits response.id core op; legacy read id from openai_chat.body_field residual",
  },
  {
    fixture: "cerebras plain chat",
    field: "responseId",
    legacyValue: undefined,
    newValue: "chatcmpl_1",
    justification:
      "fiat v0.2 emits response.id core op; legacy read id from openai_chat.body_field residual",
  },
  {
    fixture: "complete openai chat cached usage",
    field: "responseId",
    legacyValue: undefined,
    newValue: "chatcmpl_cache",
    justification:
      "fiat v0.2 emits response.id core op; legacy read id from openai_chat.body_field residual",
  },
  {
    fixture: "complete openai chat cached usage",
    field: "usage.cacheRead",
    legacyValue: 0,
    newValue: 800,
    justification:
      "fiat v0.2 promotes cached_tokens into response.usage.cacheReadTokens; legacy read prompt_tokens_details via openai_chat.usage residual",
  },
  {
    fixture: "complete openai chat cached usage",
    field: "usage.input",
    legacyValue: 1000,
    newValue: 200,
    justification:
      "cache subtraction follows promoted cacheReadTokens in adapter mapUsage; legacy never saw cached_tokens on stripped openai_chat.usage",
  },
  {
    fixture: "complete openai chat cached usage",
    field: "usage.cost.input",
    legacyValue: 0.001,
    newValue: 0.0002,
    justification:
      "input cost follows gated cache subtraction from promoted cacheReadTokens",
  },
  {
    fixture: "complete openai chat cached usage",
    field: "usage.cost.cacheRead",
    legacyValue: 0,
    newValue: 0.00008,
    justification:
      "cache read cost follows promoted cacheReadTokens in response.usage",
  },
  {
    fixture: "complete openai chat cached usage",
    field: "usage.cost.total",
    legacyValue: 0.0012000000000000001,
    newValue: 0.00048,
    justification:
      "total cost follows gated cache subtraction from promoted cacheReadTokens",
  },
] as const;

describe("llm client parity", () => {
  for (const fixture of parityFixtures) {
    test(`request parity: ${fixture.name}`, async () => {
      const legacyBody = await legacyRequestBody(fixture);
      const newBody = newRequestBody(fixture);
      expect(newBody).toEqual(legacyBody);
    });

    test(`response parity: ${fixture.name}`, async () => {
      const legacy = await runLegacyResponse(fixture);
      globalThis.fetch = (async () =>
        sseResponse(fixture.sseEvents)) as unknown as typeof fetch;
      const stream = streamDirectLlmResponse(
        fixture.model,
        fixture.context(),
        configuredLlmRequestOptions(fixture.request()),
      );
      const newEvents = await collectStreamEvents(stream);
      const newMessage = await stream.result();

      assertKnownDifferences(
        fixture.name,
        legacy.message,
        stripMessageEnvelope(newMessage),
      );
      expect(
        alignMessage(fixture.name, stripMessageEnvelope(newMessage)),
      ).toEqual(legacy.message);
      expect(
        normalizeEvents(newEvents).map((event) =>
          alignEventMessage(fixture.name, event),
        ),
      ).toEqual(legacy.events);
    });
  }

  test("complete response parity: openai chat cached usage", async () => {
    const model = {
      ...openAiChatModel(),
      cost: { cacheRead: 0.1, cacheWrite: 0, input: 1, output: 2 },
    };
    const context = baseContext();
    const legacyOptions = legacyConfiguredLlmRequestOptions(
      asConfiguredRequest({
        apiKey: "token",
        effortLevel: "off",
        model,
        serviceTier: "default",
      }),
    );
    const newOptions = configuredLlmRequestOptions(
      asConfiguredRequest({
        apiKey: "token",
        effortLevel: "off",
        model,
        serviceTier: "default",
      }),
    );
    const body = {
      choices: [
        {
          finish_reason: "stop",
          index: 0,
          message: { content: "Done.", role: "assistant" },
        },
      ],
      id: "chatcmpl_cache",
      model: "gpt-test",
      usage: {
        completion_tokens: 100,
        prompt_tokens: 1000,
        prompt_tokens_details: { cached_tokens: 800 },
        total_tokens: 1100,
      },
    };
    globalThis.fetch = (async () =>
      jsonResponse(body)) as unknown as typeof fetch;
    const legacyMessage = await runLegacyComplete(
      model,
      context,
      legacyOptions,
      body,
    );
    const newMessage = await completeDirectLlmResponse(
      model,
      context,
      newOptions,
    );
    assertKnownDifferences(
      "complete openai chat cached usage",
      legacyMessage,
      stripMessageEnvelope(newMessage),
    );
    expect(
      alignMessage(
        "complete openai chat cached usage",
        stripMessageEnvelope(newMessage),
      ),
    ).toEqual(legacyMessage);
  });

  test("usage parity: openai chat stream without prompt_tokens_details", async () => {
    const fixture = parityFixtures.find(
      (entry) => entry.name === "cerebras plain chat",
    );
    expect(fixture).toBeDefined();
    const legacy = await runLegacyResponse(fixture!);
    globalThis.fetch = (async () =>
      sseResponse(fixture!.sseEvents)) as unknown as typeof fetch;
    const message = await streamDirectLlmResponse(
      fixture!.model,
      fixture!.context(),
      configuredLlmRequestOptions(fixture!.request()),
    ).result();
    assertKnownDifferences(
      fixture!.name,
      legacy.message,
      stripMessageEnvelope(message),
    );
    expect(stripMessageEnvelope(message).usage).toEqual(legacy.message.usage);
  });

  test("usage parity: openai chat stream with cached_tokens: 0", async () => {
    const model = openAiChatModel();
    const context = baseContext();
    const options = configuredLlmRequestOptions(
      asConfiguredRequest({
        apiKey: "token",
        effortLevel: "off",
        model,
        serviceTier: "default",
      }),
    );
    const sseEvents = [
      {
        choices: [
          {
            delta: { content: "ok", role: "assistant" },
            finish_reason: null,
            index: 0,
          },
        ],
        id: "chatcmpl_zero",
        model: "gpt-test",
      },
      {
        choices: [{ delta: {}, finish_reason: "stop", index: 0 }],
        usage: {
          completion_tokens: 3,
          prompt_tokens: 10,
          prompt_tokens_details: { cached_tokens: 0 },
          total_tokens: 13,
        },
      },
      "[DONE]",
    ] as const;
    const legacy = await runLegacyResponse({
      name: "cached_tokens zero",
      model,
      request: () =>
        asConfiguredRequest({
          apiKey: "token",
          effortLevel: "off",
          model,
          serviceTier: "default",
        }),
      context: () => context,
      sseEvents,
    });
    globalThis.fetch = (async () =>
      sseResponse(sseEvents)) as unknown as typeof fetch;
    const message = await streamDirectLlmResponse(
      model,
      context,
      options,
    ).result();
    expect(stripMessageEnvelope(message).usage).toEqual(legacy.message.usage);
  });
});

describe("llm client behavior", () => {
  test("abort mid-stream sets aborted stopReason and emits error event", async () => {
    const controller = new AbortController();
    const model = openAiChatModel();
    const context = baseContext();
    globalThis.fetch = (async (_url, init) => {
      const signal = init?.signal;
      return new Response(
        new ReadableStream({
          start(streamController) {
            streamController.enqueue(
              new TextEncoder().encode('data: {"choices":[]}\n\n'),
            );
            signal?.addEventListener("abort", () => {
              streamController.error(new Error("aborted"));
            });
          },
        }),
        { headers: { "content-type": "text/event-stream" }, status: 200 },
      );
    }) as typeof fetch;

    const stream = streamDirectLlmResponse(model, context, {
      apiKey: "token",
      signal: controller.signal,
    });
    controller.abort();
    const events = await collectStreamEvents(stream);
    const message = await stream.result();
    expect(events.some((event) => event.type === "error")).toBe(true);
    const errorEvent = events.find((event) => event.type === "error");
    expect(errorEvent?.reason).toBe("aborted");
    expect(message.stopReason).toBe("aborted");
    expect(message.errorMessage).toBeDefined();
  });

  test("HTTP error surfaces ProviderRequestError as error event", async () => {
    globalThis.fetch = (async () =>
      new Response("rate limited", { status: 429 })) as unknown as typeof fetch;
    const model = openAiChatModel();
    const context = baseContext();
    const stream = streamDirectLlmResponse(model, context, { apiKey: "token" });
    const events = await collectStreamEvents(stream);
    const message = await stream.result();
    expect(events.some((event) => event.type === "error")).toBe(true);
    expect(message.stopReason).toBe("error");
    expect(message.errorMessage).toContain("Provider request failed: HTTP 429");
    expect(message.errorMessage).toContain("rate limited");
  });

  test("completeDirectLlmResponse invokes onDelta with full text", async () => {
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
    const deltas: string[] = [];
    await completeDirectLlmResponse(openAiChatModel(), baseContext(), {
      apiKey: "token",
      onDelta: (delta) => deltas.push(delta),
    });
    expect(deltas).toEqual(["Done."]);
  });

  test("completeDirectLlmResponse invokes onCompletionLatency", async () => {
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
    let latencyMs: number | undefined;
    await completeDirectLlmResponse(openAiChatModel(), baseContext(), {
      apiKey: "token",
      onCompletionLatency: (stats) => {
        latencyMs = stats.totalMs;
      },
    });
    expect(latencyMs).toBeGreaterThanOrEqual(0);
  });
});

async function legacyRequestBody(
  fixture: ParityFixture,
): Promise<Record<string, unknown>> {
  const request = await buildDirectRequest({
    context: fixture.context(),
    model: fixture.model,
    options: legacyConfiguredLlmRequestOptions(fixture.request()),
    stream: fixture.stream ?? true,
  });
  return request.body;
}

function newRequestBody(fixture: ParityFixture): Record<string, unknown> {
  const context = fixture.context();
  const options = configuredLlmRequestOptions(fixture.request());
  const translator = translatorForModel(fixture.model);
  const program = buildLlmProgram(fixture.model, context, options);
  const variant = clientVariantForModel(fixture.model);
  return translator.toBody(program, {
    strict: true,
    ...(variant === undefined ? {} : { variant }),
    stream: fixture.stream ?? true,
    omitModel: translator.name === "gemini",
  }) as Record<string, unknown>;
}

async function runLegacyResponse(fixture: ParityFixture): Promise<{
  events: unknown[];
  message: ReturnType<typeof stripMessageEnvelope>;
}> {
  const context = fixture.context();
  const options = legacyConfiguredLlmRequestOptions(fixture.request());
  const request = await buildDirectRequest({
    context,
    model: fixture.model,
    options,
    stream: true,
  });
  const output = createLegacyOutput(fixture.model);
  const stream = createAssistantMessageEventStream();
  stream.push({ partial: output, type: "start" });
  const accumulator = createLegacyAssistantAccumulator({
    model: fixture.model,
    output,
    stream,
  });
  for (const rawEvent of fixture.sseEvents) {
    if (rawEvent === "[DONE]") {
      continue;
    }
    const event =
      typeof rawEvent === "string"
        ? (JSON.parse(rawEvent) as Record<string, unknown>)
        : rawEvent;
    const program = legacyFiatProgramFromStreamEvent({
      event,
      translator: request.translator,
    });
    if (program.length > 0) {
      accumulator.pushProgram(program);
    }
  }
  accumulator.finish();
  stream.push({
    message: output,
    reason: output.stopReason,
    type: "done",
  });
  const events = await drainStreamEvents(stream);
  return {
    events: normalizeEvents(events),
    message: stripMessageEnvelope(output),
  };
}

async function runLegacyComplete(
  model: LlmModel,
  context: LlmContext,
  options: LlmRequestOptions,
  body: Record<string, unknown>,
): Promise<ReturnType<typeof stripMessageEnvelope>> {
  const request = await buildDirectRequest({
    context,
    model,
    options,
    stream: false,
  });
  const output = createLegacyOutput(model);
  const accumulator = createLegacyAssistantAccumulator({ model, output });
  accumulator.pushProgram(request.translator.fromResponse(body));
  accumulator.finish();
  return stripMessageEnvelope(output);
}

function createLegacyOutput(model: LlmModel): LlmAssistantMessage {
  return {
    api: model.api,
    content: [],
    model: model.id,
    provider: model.provider,
    role: "assistant",
    stopReason: "stop",
    timestamp: 0,
    usage: emptyLlmUsage(),
  };
}

function alignMessage(
  fixtureName: string,
  message: ReturnType<typeof stripMessageEnvelope>,
): ReturnType<typeof stripMessageEnvelope> {
  const aligned = structuredClone(message);
  for (const diff of KNOWN_DIFFERENCES) {
    if (diff.fixture !== fixtureName) {
      continue;
    }
    setField(aligned, diff.field, diff.legacyValue);
  }
  return aligned;
}

function alignEventMessage(fixtureName: string, event: unknown): unknown {
  if (
    event === null ||
    typeof event !== "object" ||
    !("type" in event) ||
    (event as { type: string }).type !== "done" ||
    !("message" in event)
  ) {
    return event;
  }
  const done = event as {
    type: "done";
    reason: string;
    message: ReturnType<typeof stripMessageEnvelope>;
  };
  return {
    ...done,
    message: alignMessage(fixtureName, done.message),
  };
}

function setField(
  target: Record<string, unknown>,
  path: string,
  value: unknown,
): void {
  const keys = path.split(".");
  let current: Record<string, unknown> = target;
  for (let index = 0; index < keys.length - 1; index += 1) {
    const key = keys[index]!;
    const next = current[key];
    if (next === null || typeof next !== "object" || Array.isArray(next)) {
      const created: Record<string, unknown> = {};
      current[key] = created;
      current = created;
      continue;
    }
    current = next as Record<string, unknown>;
  }
  current[keys.at(-1)!] = value;
}

function assertKnownDifferences(
  fixtureName: string,
  legacyMessage: ReturnType<typeof stripMessageEnvelope>,
  newMessage: ReturnType<typeof stripMessageEnvelope>,
): void {
  for (const diff of KNOWN_DIFFERENCES) {
    if (diff.fixture !== fixtureName) {
      continue;
    }
    expect(fieldValue(legacyMessage, diff.field)).toEqual(diff.legacyValue);
    expect(fieldValue(newMessage, diff.field)).toEqual(diff.newValue);
  }
}

function fieldValue(
  message: ReturnType<typeof stripMessageEnvelope>,
  path: string,
): unknown {
  return path.split(".").reduce<unknown>((value, key) => {
    if (value === null || value === undefined || typeof value !== "object") {
      return undefined;
    }
    return (value as Record<string, unknown>)[key];
  }, message);
}

function normalizeEvents(events: AssistantMessageEvent[]): unknown[] {
  return events.map((event) => {
    if (event.type === "start") {
      return { type: event.type };
    }
    if (event.type === "text_start" || event.type === "toolcall_start") {
      return { type: event.type, contentIndex: event.contentIndex };
    }
    if (event.type === "text_delta" || event.type === "toolcall_delta") {
      return {
        type: event.type,
        contentIndex: event.contentIndex,
        delta: event.delta,
      };
    }
    if (event.type === "text_end") {
      return {
        type: event.type,
        contentIndex: event.contentIndex,
        content: event.content,
      };
    }
    if (event.type === "toolcall_end") {
      return {
        type: event.type,
        contentIndex: event.contentIndex,
        toolCall: event.toolCall,
      };
    }
    if (event.type === "done") {
      return {
        type: event.type,
        reason: event.reason,
        message: stripMessageEnvelope(event.message),
      };
    }
    if (event.type === "error") {
      return {
        type: event.type,
        reason: event.reason,
        errorMessage: event.error.errorMessage,
      };
    }
    return event;
  });
}

function stripMessageEnvelope(message: LlmAssistantMessage): {
  content: LlmAssistantMessage["content"];
  responseId: string | undefined;
  responseModel: string | undefined;
  stopReason: LlmAssistantMessage["stopReason"];
  usage: LlmAssistantMessage["usage"];
} {
  return {
    content: message.content,
    responseId: message.responseId,
    responseModel: message.responseModel,
    stopReason: message.stopReason,
    usage: message.usage,
  };
}

async function drainStreamEvents(
  stream: ReturnType<typeof createAssistantMessageEventStream>,
): Promise<AssistantMessageEvent[]> {
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  return events;
}

async function collectStreamEvents(
  stream: ReturnType<typeof streamDirectLlmResponse>,
): Promise<AssistantMessageEvent[]> {
  const events: AssistantMessageEvent[] = [];
  for await (const event of stream) {
    events.push(event);
  }
  await stream.result();
  return events;
}

type ConfiguredRequest = Parameters<typeof configuredLlmRequestOptions>[0];

function asConfiguredRequest(
  request: Omit<ConfiguredRequest, "model"> & { model: LlmModel },
): ConfiguredRequest {
  return request as ConfiguredRequest;
}

type ParityFixture = {
  name: string;
  model: LlmModel;
  request: () => ConfiguredRequest;
  context: () => LlmContext;
  stream?: boolean;
  sseEvents: readonly (Record<string, unknown> | string)[];
};

const parityFixtures: ParityFixture[] = [
  {
    name: "openai-responses priority+reasoning",
    model: openAiResponsesModel(),
    request: () =>
      asConfiguredRequest({
        apiKey: "token",
        effortLevel: "medium",
        model: openAiResponsesModel(),
        serviceTier: "priority",
      }),
    context: baseContext,
    sseEvents: openAiResponsesSse(),
  },
  {
    name: "openrouter gemini-3 medium+priority",
    model: openRouterGeminiModel("google/gemini-3.1-flash-lite"),
    request: () =>
      asConfiguredRequest({
        apiKey: "token",
        effortLevel: "medium",
        model: openRouterGeminiModel("google/gemini-3.1-flash-lite"),
        serviceTier: "priority",
      }),
    context: baseContext,
    sseEvents: openAiChatToolSse(),
  },
  {
    name: "openrouter gpt-5 off",
    model: openRouterOpenAiModel("openai/gpt-5.4-mini"),
    request: () =>
      asConfiguredRequest({
        apiKey: "token",
        effortLevel: "off",
        model: openRouterOpenAiModel("openai/gpt-5.4-mini"),
        serviceTier: "default",
      }),
    context: baseContext,
    sseEvents: openAiChatTextSse("ok"),
  },
  {
    name: "openrouter gemini-3 off+priority",
    model: openRouterGeminiModel("google/gemini-3.5-flash"),
    request: () =>
      asConfiguredRequest({
        apiKey: "token",
        effortLevel: "off",
        model: openRouterGeminiModel("google/gemini-3.5-flash"),
        serviceTier: "priority",
      }),
    context: baseContext,
    sseEvents: openAiChatTextSse("ok"),
  },
  {
    name: "openrouter grok medium",
    model: openRouterOpenAiModel("xai/grok-3"),
    request: () =>
      asConfiguredRequest({
        apiKey: "token",
        effortLevel: "medium",
        model: openRouterOpenAiModel("xai/grok-3"),
        serviceTier: "default",
      }),
    context: baseContext,
    sseEvents: openAiChatTextSse("grok"),
  },
  {
    name: "gemini reasoning",
    model: geminiModel(),
    request: () =>
      asConfiguredRequest({
        apiKey: "token",
        effortLevel: "high",
        model: geminiModel(),
        serviceTier: "default",
      }),
    context: baseContext,
    sseEvents: geminiSse("gemini reply"),
  },
  {
    name: "cerebras plain chat",
    model: cerebrasModel(),
    request: () =>
      asConfiguredRequest({
        apiKey: "token",
        effortLevel: "off",
        model: cerebrasModel(),
        serviceTier: "default",
      }),
    context: baseContext,
    sseEvents: openAiChatTextSse("fast"),
  },
];

function baseContext(): LlmContext {
  return {
    messages: [{ content: "Search now.", role: "user", timestamp: 1 }],
    systemPrompt: "Use tools.",
    tools: [
      {
        description: "Find files by query.",
        name: "find_relevant_files",
        parameters: Type.Object({ query: Type.String() }),
      },
    ],
  };
}

function openAiChatModel(): LlmModel<"openai-completions"> {
  return {
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
}

function openAiResponsesModel(): LlmModel<"openai-responses"> {
  return {
    api: "openai-responses",
    baseUrl: "https://api.openai.test/v1",
    contextWindow: 128_000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id: "gpt-5.4",
    input: ["text"],
    maxTokens: 16_384,
    name: "GPT 5.4",
    provider: "openai",
    reasoning: true,
    thinkingLevelMap: { xhigh: "high" },
  };
}

function openRouterGeminiModel(id: string): LlmModel<"openai-completions"> {
  return {
    ...openAiChatModel(),
    baseUrl: "https://openrouter.ai/api/v1",
    id,
    provider: "openrouter",
    reasoning: true,
    thinkingLevelMap: { xhigh: "high" },
  };
}

function openRouterOpenAiModel(id: string): LlmModel<"openai-completions"> {
  return {
    ...openAiChatModel(),
    baseUrl: "https://openrouter.ai/api/v1",
    id,
    provider: "openrouter",
    reasoning: true,
  };
}

function geminiModel(): LlmModel<"google-generative-ai"> {
  return {
    api: "google-generative-ai",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    contextWindow: 1_000_000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id: "gemini-2.5-pro",
    input: ["text"],
    maxTokens: 8192,
    name: "Gemini",
    provider: "google",
    reasoning: true,
  };
}

function cerebrasModel(): LlmModel<"openai-completions"> {
  return {
    ...openAiChatModel(),
    baseUrl: "https://api.cerebras.ai/v1",
    id: "gpt-oss-120b",
    maxTokens: 32_000,
    provider: "cerebras",
  };
}

function openAiChatTextSse(text: string) {
  return [
    {
      choices: [
        {
          delta: { content: text, role: "assistant" },
          finish_reason: null,
          index: 0,
        },
      ],
      id: "chatcmpl_1",
      model: "model",
    },
    {
      choices: [{ delta: {}, finish_reason: "stop", index: 0 }],
      usage: {
        completion_tokens: 3,
        prompt_tokens: 10,
        total_tokens: 13,
      },
    },
    "[DONE]",
  ];
}

function openAiChatToolSse() {
  return [
    {
      choices: [
        {
          delta: { content: "I will search.", role: "assistant" },
          finish_reason: null,
          index: 0,
        },
      ],
      id: "chatcmpl_1",
      model: "model",
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
                  arguments: '{"query"',
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
              { index: 0, function: { arguments: ':"llm client"}' } },
            ],
          },
          finish_reason: "tool_calls",
          index: 0,
        },
      ],
    },
    "[DONE]",
  ];
}

function openAiResponsesSse() {
  return [
    { type: "response.created", response: { id: "resp_1" } },
    {
      type: "response.output_text.delta",
      delta: "hello",
      item_id: "msg_1",
      output_index: 0,
      content_index: 0,
    },
    {
      type: "response.completed",
      response: {
        id: "resp_1",
        model: "gpt-5.4",
        status: "completed",
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "hello" }],
          },
        ],
        usage: {
          input_tokens: 12,
          input_tokens_details: { cached_tokens: 4 },
          output_tokens: 2,
          total_tokens: 14,
        },
      },
    },
  ];
}

function geminiSse(text: string) {
  return [
    {
      candidates: [
        { content: { parts: [{ text }], role: "model" }, finishReason: "STOP" },
      ],
      usageMetadata: {
        candidatesTokenCount: 5,
        promptTokenCount: 20,
        totalTokenCount: 25,
      },
    },
  ];
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
    { headers: { "content-type": "text/event-stream" }, status: 200 },
  );
}

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status: 200,
  });
}
