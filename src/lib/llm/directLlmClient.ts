import type { LlmCompletionLatencyStats } from "./streamResponse";
import type {
  AssistantMessageEventStream,
  LlmAssistantMessage,
  LlmContext,
  LlmModel,
  LlmStopReason,
  LlmTextContent,
  LlmThinkingLevel,
  LlmToolResultMessage,
  LlmUserMessage,
  LlmUsage,
} from "./types";
import { createAssistantMessageEventStream, emptyLlmUsage } from "./types";

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

type ChatCompletionBodyOptions = Pick<
  DirectLlmRequestOptions,
  "maxTokens" | "reasoning" | "reasoningEffort" | "serviceTier" | "temperature"
>;

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

export function buildChatCompletionsBody(
  context: LlmContext,
  model: LlmModel,
  options: ChatCompletionBodyOptions,
  stream: boolean,
): Record<string, unknown> {
  assertOpenAiCompletionsApi(model);

  const body: Record<string, unknown> = {
    messages: serializeMessages(context),
    model: model.id,
    stream,
  };

  if (options.maxTokens !== undefined) {
    body.max_tokens = options.maxTokens;
  }
  if (options.temperature !== undefined) {
    body.temperature = options.temperature;
  }
  if (options.serviceTier !== undefined) {
    body.service_tier = options.serviceTier;
  }

  const reasoningEffort = reasoningEffortForModel({ model, options });
  if (reasoningEffort !== undefined) {
    body.reasoning = { effort: reasoningEffort };
  }

  const tools = serializeTools(context.tools);
  if (tools !== undefined) {
    body.tools = tools;
    body.tool_choice = "auto";
  }

  return body;
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
      const body = await finalizeRequestBody({ context, model, options, stream: true });

      stream.push({ partial: output, type: "start" });
      const response = await fetch(joinUrl(model.baseUrl, "chat/completions"), {
        body: JSON.stringify(body),
        headers: {
          accept: "text/event-stream",
          "content-type": "application/json",
          ...authHeaders(connection),
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

      const accumulator = createAssistantAccumulator({ model, output, stream });
      for await (const event of parseSseData(response, options.signal)) {
        if (event === "[DONE]") {
          continue;
        }
        accumulator.pushChunk(parseJsonObject(event, `${model.provider} stream event`));
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
      output.stopReason = options.signal?.aborted === true ? "aborted" : "error";
      output.errorMessage = error instanceof Error ? error.message : String(error);
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
  const body = await finalizeRequestBody({ context, model, options, stream: false });
  const response = await fetch(joinUrl(model.baseUrl, "chat/completions"), {
    body: JSON.stringify(body),
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...authHeaders(connection),
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
  const accumulator = createAssistantAccumulator({ model, output });
  accumulator.pushResponse(parseJsonObject(await response.text(), `${model.provider} response`));
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

async function finalizeRequestBody({
  context,
  model,
  options,
  stream,
}: {
  context: LlmContext;
  model: LlmModel;
  options: DirectLlmRequestOptions;
  stream: boolean;
}): Promise<Record<string, unknown>> {
  const body = buildChatCompletionsBody(context, model, options, stream);
  const nextBody = await options.onPayload?.(body, model);
  return nextBody === undefined
    ? body
    : assertRecord(nextBody, `${model.provider}/${model.id} payload`);
}

function assertOpenAiCompletionsApi(model: LlmModel): void {
  if (model.api !== "openai-completions") {
    throw new Error(
      `Unsupported direct LLM provider/api combination: provider=${model.provider} model=${model.id} api=${model.api}.`,
    );
  }
}

function serializeMessages(context: LlmContext): Record<string, unknown>[] {
  const messages: Record<string, unknown>[] = [];
  if (context.systemPrompt !== undefined) {
    messages.push({ content: context.systemPrompt, role: "system" });
  }
  for (const message of context.messages) {
    if (message.role === "user") {
      messages.push({
        content: textFromMessageContent(message.content, "user"),
        role: "user",
      });
      continue;
    }
    if (message.role === "assistant") {
      messages.push(serializeAssistantMessage(message));
      continue;
    }
    messages.push(serializeToolResultMessage(message));
  }
  return messages;
}

function serializeAssistantMessage(
  message: LlmAssistantMessage,
): Record<string, unknown> {
  const textParts: string[] = [];
  const toolCalls: Record<string, unknown>[] = [];

  for (const block of message.content) {
    if (block.type === "text") {
      textParts.push(block.text);
      continue;
    }
    if (block.type === "toolCall") {
      toolCalls.push({
        function: {
          arguments: JSON.stringify(block.arguments),
          name: block.name,
        },
        id: block.id,
        type: "function",
      });
    }
  }

  const serialized: Record<string, unknown> = { role: "assistant" };
  if (textParts.length > 0) {
    serialized.content = textParts.join("\n");
  }
  if (toolCalls.length > 0) {
    serialized.tool_calls = toolCalls;
  }
  return serialized;
}

function serializeToolResultMessage(
  message: LlmToolResultMessage,
): Record<string, unknown> {
  return {
    content: textFromMessageContent(message.content, "tool result"),
    role: "tool",
    tool_call_id: message.toolCallId,
  };
}

function serializeTools(
  tools: LlmContext["tools"],
): Record<string, unknown>[] | undefined {
  if (tools === undefined || tools.length === 0) {
    return undefined;
  }
  return tools.map((tool) => ({
    function: {
      description: tool.description,
      name: tool.name,
      parameters: tool.parameters,
    },
    type: "function",
  }));
}

function reasoningEffortForModel({
  model,
  options,
}: {
  model: LlmModel;
  options: ChatCompletionBodyOptions;
}): string | undefined {
  if (!model.reasoning) {
    return undefined;
  }

  const effort = options.reasoningEffort ?? options.reasoning;
  if (effort === undefined) {
    return undefined;
  }

  const mapped = model.thinkingLevelMap?.[effort];
  if (mapped === null) {
    throw new Error(
      `Model ${model.provider}/${model.id} cannot use effort level ${effort}.`,
    );
  }

  const resolved = mapped ?? effort;
  if (resolved === "minimal") {
    return undefined;
  }
  return resolved;
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
        throw new Error(`Cannot serialize ${label} image content to chat completions.`);
      }
      return block.text;
    })
    .join("\n");
}

function createAssistantAccumulator({
  model,
  output,
  stream,
}: {
  model: LlmModel;
  output: LlmAssistantMessage;
  stream?: AssistantMessageEventStream;
}): {
  finish: () => void;
  pushChunk: (event: Record<string, unknown>) => void;
  pushResponse: (event: Record<string, unknown>) => void;
} {
  let currentTextBlock: LlmTextContent | null = null;
  const toolCallsByIndex = new Map<number, LlmToolCallState>();

  const contentIndex = (block: LlmTextContent | LlmToolCallState): number =>
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
  const ensureToolCall = (index: number, id?: string): LlmToolCallState => {
    const existing = toolCallsByIndex.get(index);
    if (existing !== undefined) {
      if (id !== undefined && existing.id !== id) {
        existing.id = id;
      }
      return existing;
    }

    finishTextBlock();
    const toolCall: LlmToolCallState = {
      arguments: {},
      id: id ?? `call_${index}`,
      name: "",
      partialJson: "",
      type: "toolCall",
    };
    output.content.push(toolCall);
    toolCallsByIndex.set(index, toolCall);
    stream?.push({
      contentIndex: contentIndex(toolCall),
      partial: output,
      type: "toolcall_start",
    });
    return toolCall;
  };
  const applyTextDelta = (content: string): void => {
    if (content.length === 0) {
      return;
    }
    const block = ensureTextBlock();
    block.text += content;
    stream?.push({
      contentIndex: contentIndex(block),
      delta: content,
      partial: output,
      type: "text_delta",
    });
  };
  const applyToolCallDelta = (delta: Record<string, unknown>): void => {
    const index = typeof delta.index === "number" ? delta.index : 0;
    const toolCall = ensureToolCall(
      index,
      typeof delta.id === "string" ? delta.id : undefined,
    );
    const fn = nestedRecord(delta.function);
    if (fn !== undefined) {
      if (typeof fn.name === "string") {
        toolCall.name = fn.name;
      }
      if (typeof fn.arguments === "string") {
        toolCall.partialJson += fn.arguments;
        stream?.push({
          contentIndex: contentIndex(toolCall),
          delta: fn.arguments,
          partial: output,
          type: "toolcall_delta",
        });
      }
    }
  };
  const applyToolCalls = (toolCalls: unknown): void => {
    if (!Array.isArray(toolCalls)) {
      return;
    }
    for (const [index, toolCall] of toolCalls.entries()) {
      const call = assertRecord(toolCall, "tool call");
      const fn = assertRecord(call.function, "tool call function");
      const entry = ensureToolCall(
        typeof call.index === "number" ? call.index : index,
        typeof call.id === "string" ? call.id : undefined,
      );
      entry.name = String(fn.name ?? entry.name);
      const args =
        typeof fn.arguments === "string"
          ? fn.arguments
          : JSON.stringify(fn.arguments ?? {});
      entry.partialJson = args;
    }
  };

  return {
    finish: () => {
      finishTextBlock();
      for (const toolCall of toolCallsByIndex.values()) {
        toolCall.arguments = parseToolArguments(toolCall.partialJson, toolCall.id);
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
    pushChunk: (event) => {
      applyTopLevelFields({ event, model, output });
      const choice = firstChoice(event);
      if (choice === undefined) {
        return;
      }
      const delta = nestedRecord(choice.delta);
      if (delta !== undefined) {
        if (typeof delta.content === "string") {
          applyTextDelta(delta.content);
        }
        if (delta.tool_calls !== undefined) {
          for (const toolCall of asArray(delta.tool_calls)) {
            applyToolCallDelta(assertRecord(toolCall, "tool call delta"));
          }
        }
      }
      applyFinishReason(choice.finish_reason, output);
    },
    pushResponse: (event) => {
      applyTopLevelFields({ event, model, output });
      const choice = firstChoice(event);
      if (choice === undefined) {
        return;
      }
      const message = nestedRecord(choice.message);
      if (message !== undefined) {
        if (typeof message.content === "string") {
          applyTextDelta(message.content);
        }
        applyToolCalls(message.tool_calls);
      }
      applyFinishReason(choice.finish_reason, output);
    },
  };
}

type LlmToolCallState = {
  arguments: Record<string, unknown>;
  id: string;
  name: string;
  partialJson: string;
  type: "toolCall";
};

function applyTopLevelFields({
  event,
  model,
  output,
}: {
  event: Record<string, unknown>;
  model: LlmModel;
  output: LlmAssistantMessage;
}): void {
  if (typeof event.id === "string") {
    output.responseId ??= event.id;
  }
  if (typeof event.model === "string" && event.model !== model.id) {
    output.responseModel = event.model;
  }
  if (event.usage !== undefined) {
    applyOpenAiChatUsage(assertRecord(event.usage, "usage"), output.usage);
  }
}

function firstChoice(event: Record<string, unknown>): Record<string, unknown> | undefined {
  const choices = event.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    return undefined;
  }
  return assertRecord(choices[0], "choice");
}

function applyFinishReason(
  finishReason: unknown,
  output: LlmAssistantMessage,
): void {
  if (finishReason === null || finishReason === undefined) {
    return;
  }
  output.stopReason = stopReasonFromFinishReason(String(finishReason));
}

function applyOpenAiChatUsage(usage: Record<string, unknown>, current: LlmUsage): void {
  const input = numberField(usage.prompt_tokens);
  const outputTokens = numberField(usage.completion_tokens);
  const cacheRead = numberField(nestedRecord(usage.prompt_tokens_details)?.cached_tokens);
  current.input = Math.max(0, input - cacheRead);
  current.output = outputTokens;
  current.cacheRead = cacheRead;
  current.totalTokens =
    numberField(usage.total_tokens) || current.input + current.output + current.cacheRead;
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

function parseToolArguments(raw: string, callId: string): Record<string, unknown> {
  if (raw.trim().length === 0) {
    return {};
  }

  const parsed = JSON.parse(raw) as unknown;
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Tool call ${callId} arguments must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}

function stopReasonFromFinishReason(reason: string): LlmStopReason {
  switch (reason) {
    case "stop":
      return "stop";
    case "length":
      return "length";
    case "tool_calls":
      return "toolUse";
    case "content_filter":
      return "error";
    default:
      throw new Error(`Unsupported finish reason: ${reason}`);
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

function authHeaders(connection: DirectLlmConnection): Record<string, string> {
  const hasAuthorization = Object.keys(connection.headers).some(
    (key) => key.toLowerCase() === "authorization",
  );
  if (hasAuthorization) {
    return connection.headers;
  }
  return {
    ...connection.headers,
    authorization: `Bearer ${connection.apiKey}`,
  };
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

function parseJsonObject(value: string, label: string): Record<string, unknown> {
  return assertRecord(JSON.parse(value), label);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
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
