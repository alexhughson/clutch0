// Vendored from git c0d4316:src/lib/llm/directLlmClient.ts (test-only baseline).
// Edits beyond import paths:
// - export buildDirectRequest, createLegacyAssistantAccumulator, legacyFiatProgramFromStreamEvent

import {
  GeminiTranslator,
  OpenAIChatTranslator,
  OpenAIResponsesTranslator,
  type Op,
  type Program,
  type ThinkingEffort,
} from "fiat";
import type { LlmCompletionLatencyStats } from "../streamResponse";
import type {
  AssistantMessageEventStream,
  LlmAssistantMessage,
  LlmContext,
  LlmModel,
  LlmStopReason,
  LlmTextContent,
  LlmThinkingLevel,
  LlmToolResultMessage,
  LlmToolCall,
  LlmUserMessage,
  LlmUsage,
} from "../types";
import { createAssistantMessageEventStream, emptyLlmUsage } from "../types";

type DirectLlmRequestOptions = {
  apiKey: string;
  headers?: Record<string, string>;
  maxRetries?: number;
  maxTokens?: number;
  onPayload?: (
    payload: unknown,
    model: LlmModel,
  ) => unknown | undefined | Promise<unknown | undefined>;
  onResponse?: (
    response: { headers: Record<string, string>; status: number },
    model: LlmModel,
  ) => void | Promise<void>;
  reasoning?: LlmThinkingLevel;
  reasoningEffort?: LlmThinkingLevel;
  serviceTier?: "priority";
  signal?: AbortSignal;
  temperature?: number;
  timeoutMs?: number;
};

type DirectLlmCompletionOptions = DirectLlmRequestOptions & {
  onCompletionLatency?: (stats: LlmCompletionLatencyStats) => void;
  onDelta?: (delta: string) => void;
};

type DirectLlmConnection = {
  apiKey: string;
  baseUrl: string;
  headers: Record<string, string>;
  provider: string;
};

const connectionCache = new Map<string, DirectLlmConnection>();

export function getDirectLlmConnection({
  apiKey,
  headers,
  model,
}: {
  apiKey: string;
  headers?: Record<string, string>;
  model: LlmModel;
}): DirectLlmConnection {
  const mergedHeaders = { ...model.headers, ...headers };
  const key = JSON.stringify({
    apiKey,
    api: model.api,
    baseUrl: model.baseUrl,
    headers: sortedRecord(mergedHeaders),
    provider: model.provider,
  });
  const existing = connectionCache.get(key);
  if (existing !== undefined) {
    return existing;
  }

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
  options: DirectLlmRequestOptions,
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
      const request = await buildDirectRequest({
        context,
        model,
        options,
        stream: true,
      });

      stream.push({ partial: output, type: "start" });
      const response = await fetch(request.url, {
        body: JSON.stringify(request.body),
        headers: {
          accept: "text/event-stream",
          "content-type": "application/json",
          ...authHeaders(model, connection),
        },
        keepalive: true,
        method: "POST",
        signal: options.signal,
      });
      await options.onResponse?.(
        { headers: headersToRecord(response.headers), status: response.status },
        model,
      );
      if (!response.ok) {
        throw new Error(await formatErrorResponse(response));
      }

      const accumulator = createLegacyAssistantAccumulator({
        model,
        output,
        stream,
      });
      for await (const event of parseSseData(response, options.signal)) {
        if (event === "[DONE]") {
          continue;
        }
        const parsed = parseJsonObject(event, `${model.provider} stream event`);
        const program = legacyFiatProgramFromStreamEvent({
          event: parsed,
          translator: request.translator,
        });
        if (program.length > 0) {
          accumulator.pushProgram(program);
        }
      }
      accumulator.finish();

      if (options.signal?.aborted === true) {
        throw new Error("Request was aborted");
      }

      stream.push({
        message: output,
        reason: output.stopReason,
        type: "done",
      });
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
  options: DirectLlmCompletionOptions,
): Promise<LlmAssistantMessage> {
  assertApiKey(model, options.apiKey);
  const startedAtMs = Date.now();
  const connection = getDirectLlmConnection({
    apiKey: options.apiKey,
    headers: options.headers,
    model,
  });
  const request = await buildDirectRequest({
    context,
    model,
    options,
    stream: false,
  });
  const response = await fetch(request.url, {
    body: JSON.stringify(request.body),
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...authHeaders(model, connection),
    },
    keepalive: true,
    method: "POST",
    signal: options.signal,
  });
  await options.onResponse?.(
    { headers: headersToRecord(response.headers), status: response.status },
    model,
  );
  if (!response.ok) {
    throw new Error(await formatErrorResponse(response));
  }

  const output = createInitialAssistantMessage(model);
  const accumulator = createLegacyAssistantAccumulator({ model, output });
  accumulator.pushProgram(
    request.translator.fromResponse(await response.json()),
  );
  accumulator.finish();
  const text = output.content
    .filter((block): block is LlmTextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
  if (text.length > 0) {
    options.onDelta?.(text);
  }
  options.onCompletionLatency?.({ totalMs: Date.now() - startedAtMs });
  return output;
}

export async function buildDirectRequest({
  context,
  model,
  options,
  stream,
}: {
  context: LlmContext;
  model: LlmModel;
  options: DirectLlmRequestOptions;
  stream: boolean;
}): Promise<{
  body: Record<string, unknown>;
  translator: typeof OpenAIChatTranslator;
  url: string;
}> {
  const program: Program = [{ op: "llm.model", model: model.id }];

  if (options.maxTokens !== undefined) {
    program.push({ op: "llm.max_output_tokens", value: options.maxTokens });
  }
  const thinkingEffort = thinkingEffortForModel({ model, options });
  if (thinkingEffort !== undefined) {
    program.push({ op: "llm.thinking", effort: thinkingEffort });
  }
  if (options.temperature !== undefined) {
    program.push({ op: "llm.temperature", value: options.temperature });
  }
  if (context.systemPrompt !== undefined) {
    program.push({
      op: "llm.text",
      role: "system",
      content: context.systemPrompt,
    });
  }
  for (const message of context.messages) {
    if (message.role === "user") {
      program.push({
        op: "llm.text",
        role: "user",
        content: textFromMessageContent(message.content, "user"),
      });
      continue;
    }
    if (message.role === "assistant") {
      for (const block of message.content) {
        if (block.type === "text") {
          program.push({
            op: "llm.text",
            role: "assistant",
            content: block.text,
          });
        }
        if (block.type === "toolCall") {
          program.push({
            op: "llm.tool_call",
            id: block.id,
            name: block.name,
            arguments: block.arguments,
          });
        }
      }
      continue;
    }
    program.push({
      op: "llm.tool_result",
      id: message.toolCallId,
      content: textFromMessageContent(message.content, "tool result"),
    });
  }
  for (const tool of context.tools) {
    program.push({
      op: "llm.tool",
      name: tool.name,
      description: tool.description,
      inputSchema: tool.parameters,
    });
  }
  if (context.tools.length > 0) {
    program.push({ op: "llm.tool_choice", value: "auto" });
  }

  const request = requestBodyForModel({
    apiKey: options.apiKey,
    model,
    program,
    stream,
  });
  const withServiceTier =
    options.serviceTier === undefined
      ? request.body
      : { ...request.body, service_tier: options.serviceTier };
  const nextBody = await options.onPayload?.(withServiceTier, model);
  return {
    ...request,
    body:
      nextBody === undefined
        ? withServiceTier
        : assertRecord(nextBody, `${model.provider}/${model.id} payload`),
  };
}

function requestBodyForModel({
  apiKey,
  model,
  program,
  stream,
}: {
  apiKey: string;
  model: LlmModel;
  program: Program;
  stream: boolean;
}): {
  body: Record<string, unknown>;
  translator: typeof OpenAIChatTranslator;
  url: string;
} {
  if (model.api === "openai-completions") {
    return {
      body: {
        ...assertRecord(
          OpenAIChatTranslator.toBody(program, { strict: true }),
          `${model.provider}/${model.id} chat payload`,
        ),
        stream,
      },
      translator: OpenAIChatTranslator,
      url: joinUrl(model.baseUrl, "chat/completions"),
    };
  }

  if (model.api === "openai-responses") {
    return {
      body: {
        ...assertRecord(
          OpenAIResponsesTranslator.toBody(program, { strict: true }),
          `${model.provider}/${model.id} responses payload`,
        ),
        store: false,
        stream,
      },
      translator: OpenAIResponsesTranslator,
      url: joinUrl(model.baseUrl, "responses"),
    };
  }

  if (model.api === "google-generative-ai") {
    const body = assertRecord(
      GeminiTranslator.toBody(program, { strict: true }),
      `${model.provider}/${model.id} gemini payload`,
    );
    delete body.model;
    return {
      body,
      translator: GeminiTranslator,
      url: geminiUrl({
        apiKey,
        baseUrl: model.baseUrl,
        modelId: model.id,
        stream,
      }),
    };
  }

  throw new Error(
    `Unsupported direct LLM provider/api combination: provider=${model.provider} model=${model.id} api=${model.api}.`,
  );
}

export function legacyFiatProgramFromStreamEvent({
  event,
  translator,
}: {
  event: Record<string, unknown>;
  translator: typeof OpenAIChatTranslator;
}): Program {
  try {
    return translator.fromStreamResponse(event);
  } catch (error) {
    if (isIgnorableStreamEvent(event)) {
      return [];
    }
    throw error;
  }
}

function isIgnorableStreamEvent(event: Record<string, unknown>): boolean {
  return (
    event.type === "response.created" ||
    event.type === "response.in_progress" ||
    event.type === "response.content_part.added" ||
    event.type === "response.content_part.done" ||
    event.type === "response.output_text.done"
  );
}

function thinkingEffortForModel({
  model,
  options,
}: {
  model: LlmModel;
  options: DirectLlmRequestOptions;
}): ThinkingEffort | undefined {
  if (!model.reasoning) {
    return undefined;
  }

  const effort = options.reasoningEffort ?? options.reasoning;
  if (effort === undefined) {
    return undefined;
  }
  if (
    model.api !== "openai-responses" &&
    model.api !== "google-generative-ai"
  ) {
    return undefined;
  }

  const mapped =
    model.thinkingLevelMap?.[effort as keyof typeof model.thinkingLevelMap];
  if (mapped === null) {
    throw new Error(
      `Model ${model.provider}/${model.id} cannot use effort level ${effort}.`,
    );
  }
  return asFiatThinkingEffort(mapped ?? effort, model);
}

function asFiatThinkingEffort(
  effort: string,
  model: LlmModel,
): ThinkingEffort | undefined {
  if (effort === "minimal") {
    return undefined;
  }
  if (
    effort === "low" ||
    effort === "medium" ||
    effort === "high" ||
    effort === "xhigh" ||
    effort === "max"
  ) {
    return effort;
  }
  throw new Error(
    `Model ${model.provider}/${model.id} maps thinking effort to unsupported fiat effort ${effort}.`,
  );
}

function textFromMessageContent(
  content: LlmUserMessage["content"] | LlmToolResultMessage["content"],
  label: string,
): string {
  if (typeof content === "string") {
    return content;
  }

  return content
    .map((block) => {
      if (block.type !== "text") {
        throw new Error(`Cannot serialize ${label} image content to fiat.`);
      }
      return block.text;
    })
    .join("\n");
}

export function createLegacyAssistantAccumulator({
  model,
  output,
  stream,
}: {
  model: LlmModel;
  output: LlmAssistantMessage;
  stream?: AssistantMessageEventStream;
}): {
  finish: () => void;
  pushProgram: (program: Program) => void;
} {
  let currentTextBlock: LlmTextContent | null = null;
  const toolCallsByIndex = new Map<
    number,
    LlmToolCall & { partialJson: string }
  >();
  const toolCallsById = new Map<
    string,
    LlmToolCall & { partialJson: string }
  >();

  const contentIndex = (block: LlmTextContent | LlmToolCall): number =>
    output.content.indexOf(block);
  const ensureTextBlock = (): LlmTextContent => {
    if (currentTextBlock === null) {
      currentTextBlock = { text: "", type: "text" };
      output.content.push(currentTextBlock);
      stream?.push({
        contentIndex: contentIndex(currentTextBlock),
        partial: output,
        type: "text_start",
      });
    }
    return currentTextBlock;
  };
  const finishTextBlock = (): void => {
    if (currentTextBlock === null) {
      return;
    }
    stream?.push({
      content: currentTextBlock.text,
      contentIndex: contentIndex(currentTextBlock),
      partial: output,
      type: "text_end",
    });
    currentTextBlock = null;
  };
  const ensureToolCall = (
    index: number,
    id: string | undefined,
  ): LlmToolCall & { partialJson: string } => {
    const existingById = id === undefined ? undefined : toolCallsById.get(id);
    if (existingById !== undefined) {
      return existingById;
    }
    const existingByIndex = toolCallsByIndex.get(index);
    if (existingByIndex !== undefined) {
      if (id !== undefined && existingByIndex.id !== id) {
        toolCallsById.delete(existingByIndex.id);
        existingByIndex.id = id;
        toolCallsById.set(id, existingByIndex);
      }
      return existingByIndex;
    }

    finishTextBlock();
    const toolCall = {
      arguments: {},
      id: id ?? `call_${index}`,
      name: "",
      partialJson: "",
      type: "toolCall" as const,
    };
    output.content.push(toolCall);
    toolCallsByIndex.set(index, toolCall);
    toolCallsById.set(toolCall.id, toolCall);
    stream?.push({
      contentIndex: contentIndex(toolCall),
      partial: output,
      type: "toolcall_start",
    });
    return toolCall;
  };

  return {
    finish: () => {
      finishTextBlock();
      for (const toolCall of toolCallsByIndex.values()) {
        toolCall.arguments = parseToolArguments(
          toolCall.partialJson,
          toolCall.id,
        );
        delete (toolCall as { partialJson?: string }).partialJson;
        stream?.push({
          contentIndex: contentIndex(toolCall),
          partial: output,
          toolCall,
          type: "toolcall_end",
        });
      }
      if (
        output.stopReason === "stop" &&
        output.content.some((block) => block.type === "toolCall")
      ) {
        output.stopReason = "toolUse";
      }
      output.usage.cost = calculateCost(model, output.usage);
    },
    pushProgram: (program) => {
      for (const op of program) {
        if (op.op === "response.text_delta") {
          const block = ensureTextBlock();
          const content = String(op.content);
          block.text += content;
          if (content.length > 0) {
            stream?.push({
              contentIndex: contentIndex(block),
              delta: content,
              partial: output,
              type: "text_delta",
            });
          }
          continue;
        }

        if (op.op === "llm.text" && op.role === "assistant") {
          const block = ensureTextBlock();
          const content = String(op.content);
          block.text += content;
          continue;
        }

        if (op.op === "response.tool_call_delta") {
          const index = typeof op.index === "number" ? op.index : 0;
          const toolCall = ensureToolCall(
            index,
            typeof op.id === "string" ? op.id : undefined,
          );
          if (typeof op.name === "string") {
            toolCall.name = op.name;
          }
          if (typeof op.arguments === "string") {
            toolCall.partialJson += op.arguments;
            stream?.push({
              contentIndex: contentIndex(toolCall),
              delta: op.arguments,
              partial: output,
              type: "toolcall_delta",
            });
          }
          continue;
        }

        if (op.op === "llm.tool_call") {
          const call = op as Extract<Op, { op: "llm.tool_call" }>;
          const index = toolCallsByIndex.size;
          const toolCall = ensureToolCall(index, call.id);
          toolCall.name = call.name;
          toolCall.arguments = call.arguments;
          toolCall.partialJson = JSON.stringify(call.arguments);
          continue;
        }

        if (op.op === "response.stop") {
          const stop = op as Extract<Op, { op: "response.stop" }>;
          output.stopReason = stopReasonFromFiat(stop.reason);
          continue;
        }

        if (op.op === "response.usage") {
          const usage = op as Extract<Op, { op: "response.usage" }>;
          output.usage = usageFromFiat(usage, output.usage);
          continue;
        }

        applyProviderUsage({ op, output });
        if (op.op === "llm.model") {
          const modelOp = op as Extract<Op, { op: "llm.model" }>;
          if (modelOp.model !== model.id) {
            output.responseModel = modelOp.model;
          }
        }
        applyResponseId({ op, output });
      }
    },
  };
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

function usageFromFiat(
  op: Extract<Op, { op: "response.usage" }>,
  current: LlmUsage,
) {
  const input = op.inputTokens ?? current.input;
  const output = op.outputTokens ?? current.output;
  return {
    ...current,
    input,
    output,
    totalTokens: input + output + current.cacheRead + current.cacheWrite,
  };
}

function applyProviderUsage({
  op,
  output,
}: {
  op: Op;
  output: LlmAssistantMessage;
}): void {
  if (op.op === "openai_chat.usage") {
    const usage = (op as { usage?: Record<string, unknown> }).usage;
    if (usage !== undefined) {
      const cacheRead = numberField(
        nestedRecord(usage.prompt_tokens_details)?.cached_tokens,
      );
      applyCacheReadTokens(output.usage, cacheRead);
      output.usage.totalTokens =
        numberField(usage.total_tokens) ||
        output.usage.input + output.usage.output + output.usage.cacheRead;
    }
  }
  if (op.op === "openai_responses.usage") {
    const usage = (op as { usage?: Record<string, unknown> }).usage;
    if (usage !== undefined) {
      const cacheRead = numberField(
        nestedRecord(usage.input_tokens_details)?.cached_tokens,
      );
      applyCacheReadTokens(output.usage, cacheRead);
      output.usage.totalTokens =
        numberField(usage.total_tokens) ||
        output.usage.input + output.usage.output + output.usage.cacheRead;
    }
  }
  if (op.op === "gemini.usage") {
    const usage = (op as { usage?: Record<string, unknown> }).usage;
    if (usage !== undefined) {
      applyCacheReadTokens(
        output.usage,
        numberField(usage.cachedContentTokenCount),
      );
      output.usage.totalTokens =
        numberField(usage.totalTokenCount) ||
        output.usage.input + output.usage.output + output.usage.cacheRead;
    }
  }
}

function applyCacheReadTokens(usage: LlmUsage, cacheRead: number): void {
  usage.cacheRead = cacheRead;
  usage.input = Math.max(0, usage.input - cacheRead);
}

function applyResponseId({
  op,
  output,
}: {
  op: Op;
  output: LlmAssistantMessage;
}): void {
  if (
    op.op !== "openai_chat.body_field" &&
    op.op !== "openai_responses.body_field"
  ) {
    return;
  }
  const field = op as { key?: string; value?: unknown };
  if (field.key === "id" && typeof field.value === "string") {
    output.responseId ??= field.value;
  }
  if (field.key === "response") {
    const response = assertRecord(field.value, "response metadata");
    if (typeof response.id === "string") {
      output.responseId ??= response.id;
    }
  }
}

function parseToolArguments(
  raw: string,
  callId: string,
): Record<string, unknown> {
  if (raw.trim().length === 0) {
    return {};
  }

  const parsed = JSON.parse(raw) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Tool call ${callId} arguments must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function stopReasonFromFiat(reason: string): LlmStopReason {
  switch (reason) {
    case "end_turn":
    case "stop_sequence":
      return "stop";
    case "max_tokens":
      return "length";
    case "tool_use":
      return "toolUse";
    case "content_filter":
    case "refusal":
    case "model_context_window_exceeded":
    case "pause_turn":
      return "error";
    default:
      throw new Error(`Unsupported fiat stop reason: ${reason}`);
  }
}

async function* parseSseData(
  response: Response,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  if (response.body === null) {
    throw new Error("Provider returned an empty streaming response body.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      if (signal?.aborted === true) {
        throw new Error("Request was aborted");
      }
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });
      const events = buffer.split(/\r?\n\r?\n/);
      buffer = events.pop() ?? "";
      for (const event of events) {
        const data = event
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice("data:".length).trimStart())
          .join("\n");
        if (data.length > 0) {
          yield data;
        }
      }
    }
    buffer += decoder.decode();
    if (buffer.trim().length > 0) {
      const data = buffer
        .split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trimStart())
        .join("\n");
      if (data.length > 0) {
        yield data;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function authHeaders(
  model: LlmModel,
  connection: DirectLlmConnection,
): Record<string, string> {
  if (model.api === "google-generative-ai") {
    return connection.headers;
  }

  return {
    ...connection.headers,
    authorization: `Bearer ${connection.apiKey}`,
  };
}

function geminiUrl({
  apiKey,
  baseUrl,
  modelId,
  stream,
}: {
  apiKey: string;
  baseUrl: string;
  modelId: string;
  stream: boolean;
}): string {
  const action = stream ? "streamGenerateContent" : "generateContent";
  const url = new URL(`${joinUrl(baseUrl, `models/${modelId}:${action}`)}`);
  url.searchParams.set("key", apiKey);
  if (stream) {
    url.searchParams.set("alt", "sse");
  }
  return url.toString();
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function assertApiKey(model: LlmModel, apiKey: string): void {
  if (apiKey.trim().length === 0) {
    throw new Error(`No API key for provider: ${model.provider}`);
  }
}

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function parseJsonObject(
  value: string,
  label: string,
): Record<string, unknown> {
  return assertRecord(JSON.parse(value), label);
}

async function formatErrorResponse(response: Response): Promise<string> {
  const text = await response.text().catch(() => "");
  return `Provider request failed: HTTP ${response.status}${text.trim().length === 0 ? "" : ` ${text.trim().slice(0, 800)}`}`;
}

function headersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

function sortedRecord(record: Record<string, string>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function nestedRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function numberField(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
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
