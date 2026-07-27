import {
  createAssistantAccumulator,
  type AccumulatorEvent,
  type AssistantMessage,
} from "fiat";
import { completeResponse, streamResponse } from "fiat/client";
import type { LlmCompletionLatencyStats } from "./streamResponse";
import {
  buildLlmProgram,
  clientVariantForModel,
  translatorForModel,
} from "./llmProgram";
import {
  createAssistantMessageEventStream,
  emptyLlmUsage,
  type AssistantMessageEventStream,
  type LlmAssistantMessage,
  type LlmContext,
  type LlmModel,
  type LlmStopReason,
  type LlmTextContent,
  type LlmToolCall,
  type LlmUsage,
} from "./types";
import type { LlmRequestOptions } from "./llmProgram";

type LlmCompletionOptions = LlmRequestOptions & {
  onCompletionLatency?: (stats: LlmCompletionLatencyStats) => void;
  onDelta?: (delta: string) => void;
};

type LlmConnection = {
  apiKey: string;
  baseUrl: string;
  headers: Record<string, string>;
  provider: string;
};

const connectionCache = new Map<string, LlmConnection>();

export function getDirectLlmConnection({
  apiKey,
  headers,
  model,
}: {
  apiKey: string;
  headers?: Record<string, string>;
  model: LlmModel;
}): LlmConnection {
  const mergedHeaders = { ...model.headers, ...headers };
  const key = JSON.stringify({
    apiKey,
    api: model.api,
    baseUrl: model.baseUrl,
    headers: Object.fromEntries(
      Object.entries(mergedHeaders).sort(([a], [b]) => a.localeCompare(b)),
    ),
    provider: model.provider,
  });
  const existing = connectionCache.get(key);
  if (existing !== undefined) return existing;
  const connection = {
    apiKey,
    baseUrl: model.baseUrl,
    headers: mergedHeaders,
    provider: model.provider,
  };
  connectionCache.set(key, connection);
  return connection;
}

export function resetDirectLlmConnectionCacheForTests(): void {
  connectionCache.clear();
}

export function streamDirectLlmResponse(
  model: LlmModel,
  context: LlmContext,
  options: LlmRequestOptions,
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  void (async () => {
    const output = createInitialAssistantMessage(model);
    try {
      assertApiKey(model, options.apiKey);
      const connection = getDirectLlmConnection({
        apiKey: options.apiKey,
        headers: options.headers,
        model,
      });
      const translator = translatorForModel(model);
      const program = buildLlmProgram(model, context, options);
      const clientOptions = buildClientOptions(model, connection, options);
      let started = false;
      const accumulator = createAssistantAccumulator({
        model: model.id,
        onEvent: (event) => {
          if (!started) {
            started = true;
            stream.push({ partial: output, type: "start" });
          }
          applyAccumulatorEvent(event, output, model, stream);
        },
      });
      for await (const raised of streamResponse(
        translator,
        program,
        clientOptions,
      )) {
        if (!started) {
          started = true;
          stream.push({ partial: output, type: "start" });
        }
        accumulator.push(raised);
      }
      accumulator.finish();
      if (options.signal?.aborted === true) {
        throw new Error("Request was aborted");
      }
      stream.end();
    } catch (error) {
      output.stopReason =
        options.signal?.aborted === true ? "aborted" : "error";
      output.errorMessage =
        error instanceof Error ? error.message : String(error);
      stream.push({ error: output, reason: output.stopReason, type: "error" });
      stream.end();
    }
  })();
  return stream;
}

export async function completeDirectLlmResponse(
  model: LlmModel,
  context: LlmContext,
  options: LlmCompletionOptions,
): Promise<LlmAssistantMessage> {
  assertApiKey(model, options.apiKey);
  const startedAtMs = Date.now();
  const connection = getDirectLlmConnection({
    apiKey: options.apiKey,
    headers: options.headers,
    model,
  });
  const translator = translatorForModel(model);
  const program = buildLlmProgram(model, context, options);
  const clientOptions = buildClientOptions(model, connection, options);
  const output = createInitialAssistantMessage(model);
  const accumulator = createAssistantAccumulator({ model: model.id });
  accumulator.push(await completeResponse(translator, program, clientOptions));
  accumulator.finish();
  applyFiatMessage(accumulator.message, output, model);
  const text = output.content
    .filter((block): block is LlmTextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  if (text.length > 0) options.onDelta?.(text);
  options.onCompletionLatency?.({ totalMs: Date.now() - startedAtMs });
  return output;
}

function buildClientOptions(
  model: LlmModel,
  connection: LlmConnection,
  options: LlmRequestOptions,
) {
  const variant = clientVariantForModel(model);
  return {
    apiKey: connection.apiKey,
    baseUrl: connection.baseUrl,
    headers: connection.headers,
    signal: options.signal,
    strict: true,
    ...(variant === undefined ? {} : { variant }),
    fetch: globalThis.fetch,
    onPayload: options.onPayload
      ? (body: unknown) => options.onPayload!(body, model)
      : undefined,
    onResponse: options.onResponse
      ? (response: { headers: Record<string, string>; status: number }) =>
          options.onResponse!(response, model)
      : undefined,
  };
}

function applyAccumulatorEvent(
  event: AccumulatorEvent,
  output: LlmAssistantMessage,
  model: LlmModel,
  stream: AssistantMessageEventStream,
): void {
  if (event.type === "done") {
    applyFiatMessage(event.message, output, model);
    stream.push({ message: output, reason: output.stopReason, type: "done" });
    return;
  }
  output.content = event.partial.content.map((block) =>
    block.type === "text"
      ? { text: block.text, type: "text" as const }
      : mapToolCall(block),
  );
  output.stopReason = mapStopReason(event.partial.stopReason);
  if (event.partial.responseModel !== undefined) {
    output.responseModel = event.partial.responseModel;
  }
  if (event.partial.responseId !== undefined) {
    output.responseId = event.partial.responseId;
  }
  switch (event.type) {
    case "text_start":
      stream.push({
        contentIndex: event.contentIndex,
        partial: output,
        type: "text_start",
      });
      break;
    case "text_delta":
      stream.push({
        contentIndex: event.contentIndex,
        delta: event.delta,
        partial: output,
        type: "text_delta",
      });
      break;
    case "text_end":
      stream.push({
        content: event.content,
        contentIndex: event.contentIndex,
        partial: output,
        type: "text_end",
      });
      break;
    case "toolcall_start":
      stream.push({
        contentIndex: event.contentIndex,
        partial: output,
        type: "toolcall_start",
      });
      break;
    case "toolcall_delta":
      stream.push({
        contentIndex: event.contentIndex,
        delta: event.delta,
        partial: output,
        type: "toolcall_delta",
      });
      break;
    case "toolcall_end":
      stream.push({
        contentIndex: event.contentIndex,
        partial: output,
        toolCall: mapToolCall(event.toolCall),
        type: "toolcall_end",
      });
      break;
  }
}

function applyFiatMessage(
  fiat: AssistantMessage,
  output: LlmAssistantMessage,
  model: LlmModel,
): void {
  output.content = fiat.content.map((block) =>
    block.type === "text"
      ? { text: block.text, type: "text" as const }
      : mapToolCall(block),
  );
  output.stopReason = mapStopReason(fiat.stopReason);
  output.usage = mapUsage(fiat.usage, model);
  if (fiat.responseId !== undefined) output.responseId = fiat.responseId;
  if (fiat.responseModel !== undefined)
    output.responseModel = fiat.responseModel;
}

function mapToolCall(block: {
  arguments: Record<string, unknown>;
  id: string;
  name: string;
}): LlmToolCall {
  return {
    arguments: block.arguments,
    id: block.id,
    name: block.name,
    type: "toolCall",
  };
}

function mapStopReason(reason: AssistantMessage["stopReason"]): LlmStopReason {
  if (reason === "tool_use") return "toolUse";
  if (reason === "length") return "length";
  if (reason === "error") return "error";
  return "stop";
}

function mapUsage(fiat: AssistantMessage["usage"], model: LlmModel): LlmUsage {
  const cacheRead = fiat.cacheReadTokens ?? 0;
  const cacheWrite = fiat.cacheWriteTokens ?? 0;
  const input =
    fiat.cacheReadTokens !== undefined
      ? Math.max(0, fiat.inputTokens - cacheRead)
      : fiat.inputTokens;
  const output = fiat.outputTokens;
  const usage: LlmUsage = {
    ...emptyLlmUsage(),
    cacheRead,
    cacheWrite,
    input,
    output,
    totalTokens: input + output + cacheRead,
  };
  usage.cost = calculateCost(model, usage);
  return usage;
}

function createInitialAssistantMessage(model: LlmModel): LlmAssistantMessage {
  return {
    api: model.api,
    content: [],
    model: model.id,
    provider: model.provider,
    role: "assistant",
    stopReason: "stop",
    timestamp: Date.now(),
    usage: emptyLlmUsage(),
  };
}

function assertApiKey(model: LlmModel, apiKey: string): void {
  if (apiKey.trim().length === 0) {
    throw new Error(`No API key for provider: ${model.provider}`);
  }
}

function calculateCost(model: LlmModel, usage: LlmUsage): LlmUsage["cost"] {
  const input = (usage.input / 1_000_000) * model.cost.input;
  const output = (usage.output / 1_000_000) * model.cost.output;
  const cacheRead = (usage.cacheRead / 1_000_000) * model.cost.cacheRead;
  const cacheWrite = (usage.cacheWrite / 1_000_000) * model.cost.cacheWrite;
  return {
    cacheRead,
    cacheWrite,
    input,
    output,
    total: input + output + cacheRead + cacheWrite,
  };
}
