import OpenAI from "openai";
import {
  calculateCost,
  createAssistantMessageEventStream,
  parseStreamingJson,
  type Api,
  type AssistantMessage,
  type Context,
  type Model,
  type ProviderStreamOptions,
  type TextContent,
  type ThinkingLevel,
  type Tool,
  type ToolCall,
  type Usage,
} from "@earendil-works/pi-ai";
import { getPatchProgressFromText } from "../patch/patchEngine";
import type { PatchProgressState } from "../patch/types";
import {
  APPLY_PATCH_TOOL_NAME,
  patchInputFromToolArguments,
} from "./patchTool";

const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api";
const JWT_CLAIM_PATH = "https://api.openai.com/auth";

const APPLY_PATCH_LARK_GRAMMAR = `start: begin_patch hunk+ end_patch
begin_patch: "*** Begin Patch" LF
end_patch: "*** End Patch" LF?

hunk: add_hunk | delete_hunk | update_hunk
add_hunk: "*** Add File: " filename LF add_line+
delete_hunk: "*** Delete File: " filename LF
update_hunk: "*** Update File: " filename LF change_move? change?

filename: /(.+)/
add_line: "+" /(.*)/ LF -> line

change_move: "*** Move to: " filename LF
change: (change_context | change_line)+ eof_line?
change_context: ("@@" | "@@ " /(.+)/) LF
change_line: ("+" | "-" | " ") /(.*)/ LF
eof_line: "*** End of File" LF

%import common.LF
`;

type OpenAiResponsesCustomToolOptions = ProviderStreamOptions & {
  onPatchProgress?: (progress: PatchProgressState) => void;
  reasoning?: ThinkingLevel;
  reasoningEffort?: ThinkingLevel;
  serviceTier?: "priority";
};

type OpenAiResponsesItem = {
  arguments?: string;
  call_id?: string;
  content?: { refusal?: string; text?: string; type: string }[];
  id?: string;
  input?: string;
  name?: string;
  summary?: { text?: string }[];
  type?: string;
};

type OpenAiResponsesEvent = {
  arguments?: string;
  call_id?: string;
  code?: string;
  delta?: string;
  input?: string;
  item?: OpenAiResponsesItem;
  item_id?: string;
  message?: string;
  output_index?: number;
  part?: { refusal?: string; text?: string; type: string };
  response?: {
    error?: { code?: string; message?: string };
    id?: string;
    incomplete_details?: { reason?: string };
    status?: string;
    usage?: {
      input_tokens?: number;
      input_tokens_details?: { cached_tokens?: number };
      output_tokens?: number;
      total_tokens?: number;
    };
  };
  type?: string;
};

type CurrentStreamBlock =
  | {
      block: TextContent;
      callId?: string;
      contentIndex: number;
      item: OpenAiResponsesItem;
      itemId?: string;
      outputIndex?: number;
      type: "text";
    }
  | {
      block: ToolCall & { partialInput?: string; partialJson?: string };
      callId?: string;
      contentIndex: number;
      item: OpenAiResponsesItem;
      itemId?: string;
      outputIndex?: number;
      type: "functionTool";
    }
  | {
      block: ToolCall & { partialInput?: string };
      callId?: string;
      contentIndex: number;
      item: OpenAiResponsesItem;
      itemId?: string;
      outputIndex?: number;
      type: "customTool";
    };

export function canUseOpenAiResponsesCustomTools({
  context,
  model,
}: {
  context: Context;
  model: Model<Api>;
}): boolean {
  return (
    (model.api === "openai-responses" ||
      model.api === "openai-codex-responses") &&
    context.tools?.some((tool) => tool.name === APPLY_PATCH_TOOL_NAME) === true
  );
}

export function streamOpenAiResponsesWithCustomTools(
  model: Model<Api>,
  context: Context,
  options: OpenAiResponsesCustomToolOptions,
) {
  if (model.api === "openai-codex-responses") {
    return streamOpenAiCodexResponsesWithCustomTools(model, context, options);
  }

  const stream = createAssistantMessageEventStream();

  void (async () => {
    const output = createInitialAssistantMessage(model);
    try {
      if (options.apiKey === undefined || options.apiKey.trim().length === 0) {
        throw new Error(`No API key for provider: ${model.provider}`);
      }

      const client = new OpenAI({
        apiKey: options.apiKey,
        baseURL: model.baseUrl,
        dangerouslyAllowBrowser: true,
        defaultHeaders: { ...model.headers, ...options.headers },
      });
      let params = buildOpenAiResponsesCustomToolParams({
        context,
        model,
        options,
      });
      const nextParams = await options.onPayload?.(params, model);
      if (nextParams !== undefined) {
        params = assertRecord(nextParams, "OpenAI Responses payload");
      }

      const { data: openaiStream, response } = await client.responses
        .create(params, {
          ...(options.signal === undefined ? {} : { signal: options.signal }),
          ...(options.timeoutMs === undefined
            ? {}
            : { timeout: options.timeoutMs }),
          maxRetries: options.maxRetries ?? 0,
        })
        .withResponse();
      await options.onResponse?.(
        {
          headers: headersToRecord(response.headers),
          status: response.status,
        },
        model,
      );

      stream.push({ partial: output, type: "start" });
      await processOpenAiResponsesCustomToolStream({
        events: openaiStream as unknown as AsyncIterable<OpenAiResponsesEvent>,
        model,
        onPatchProgress: options.onPatchProgress,
        output,
        stream,
      });

      if (options.signal?.aborted === true) {
        throw new Error("Request was aborted");
      }

      stream.push({
        message: output,
        reason: successfulStopReason(output.stopReason),
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

export function streamOpenAiCodexResponsesWithCustomTools(
  model: Model<Api>,
  context: Context,
  options: OpenAiResponsesCustomToolOptions,
) {
  const stream = createAssistantMessageEventStream();

  void (async () => {
    const output = createInitialAssistantMessage(model);
    try {
      if (options.apiKey === undefined || options.apiKey.trim().length === 0) {
        throw new Error(`No API key for provider: ${model.provider}`);
      }

      const accountId = extractAccountId(options.apiKey);
      let body = buildOpenAiCodexResponsesCustomToolBody({
        context,
        model,
        options,
      });
      const nextBody = await options.onPayload?.(body, model);
      if (nextBody !== undefined) {
        body = assertRecord(nextBody, "OpenAI Codex Responses payload");
      }

      const response = await fetch(resolveCodexUrl(model.baseUrl), {
        body: JSON.stringify(body),
        headers: buildCodexSseHeaders({
          accountId,
          headers: { ...model.headers, ...options.headers },
          sessionId: options.sessionId,
          token: options.apiKey,
        }),
        method: "POST",
        signal: options.signal,
      });
      await options.onResponse?.(
        {
          headers: headersToRecord(response.headers),
          status: response.status,
        },
        model,
      );

      if (!response.ok) {
        throw new Error(await formatCodexErrorResponse(response));
      }

      stream.push({ partial: output, type: "start" });
      await processOpenAiResponsesCustomToolStream({
        events: mapCodexEvents(parseSseEvents(response, options.signal)),
        model,
        onPatchProgress: options.onPatchProgress,
        output,
        stream,
      });

      if (options.signal?.aborted === true) {
        throw new Error("Request was aborted");
      }

      stream.push({
        message: output,
        reason: successfulStopReason(output.stopReason),
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

export function buildOpenAiResponsesCustomToolParams({
  context,
  model,
  options,
}: {
  context: Context;
  model: Model<Api>;
  options: OpenAiResponsesCustomToolOptions;
}): Record<string, unknown> {
  const params: Record<string, unknown> = {
    input: openAiResponsesInputFromContext(context),
    model: model.id,
    parallel_tool_calls: false,
    store: false,
    stream: true,
    tool_choice: "auto",
  };

  if (context.systemPrompt !== undefined) {
    params.instructions = context.systemPrompt;
  }
  if (context.tools !== undefined && context.tools.length > 0) {
    params.tools = context.tools.map(openAiResponsesToolFromClutchTool);
  }
  if (options.maxTokens !== undefined) {
    params.max_output_tokens = options.maxTokens;
  }
  if (options.temperature !== undefined) {
    params.temperature = options.temperature;
  }
  if (options.serviceTier !== undefined) {
    params.service_tier = options.serviceTier;
  }
  const effort = options.reasoningEffort ?? options.reasoning;
  if (model.reasoning && effort !== undefined) {
    params.reasoning = {
      effort: model.thinkingLevelMap?.[effort] ?? effort,
      summary: "auto",
    };
    params.include = ["reasoning.encrypted_content"];
  }

  return params;
}

export function buildOpenAiCodexResponsesCustomToolBody({
  context,
  model,
  options,
}: {
  context: Context;
  model: Model<Api>;
  options: OpenAiResponsesCustomToolOptions;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    include: ["reasoning.encrypted_content"],
    input: openAiResponsesInputFromContext(context),
    instructions: context.systemPrompt ?? "You are a helpful assistant.",
    model: model.id,
    parallel_tool_calls: false,
    store: false,
    stream: true,
    text: { verbosity: "low" },
    tool_choice: "auto",
  };

  if (context.tools !== undefined && context.tools.length > 0) {
    body.tools = context.tools.map(openAiResponsesToolFromClutchTool);
  }
  if (options.temperature !== undefined) {
    body.temperature = options.temperature;
  }
  if (options.serviceTier !== undefined) {
    body.service_tier = options.serviceTier;
  }
  const effort = options.reasoningEffort ?? options.reasoning;
  if (model.reasoning && effort !== undefined) {
    const mappedEffort = model.thinkingLevelMap?.[effort] ?? effort;
    if (mappedEffort !== null) {
      body.reasoning = {
        effort: mappedEffort,
        summary: "auto",
      };
    }
  }

  return body;
}

export function openAiResponsesToolFromClutchTool(tool: Tool): unknown {
  if (tool.name === APPLY_PATCH_TOOL_NAME) {
    return {
      description:
        "Use the `apply_patch` tool to edit files. This is a FREEFORM tool, so do not wrap the patch in JSON.",
      format: {
        definition: APPLY_PATCH_LARK_GRAMMAR,
        syntax: "lark",
        type: "grammar",
      },
      name: APPLY_PATCH_TOOL_NAME,
      type: "custom",
    };
  }

  return {
    description: tool.description,
    name: tool.name,
    parameters: tool.parameters,
    strict: false,
    type: "function",
  };
}

export async function processOpenAiResponsesCustomToolStream({
  events,
  model,
  onPatchProgress,
  output,
  stream,
}: {
  events: AsyncIterable<unknown>;
  model: Model<Api>;
  onPatchProgress?: (progress: PatchProgressState) => void;
  output: AssistantMessage;
  stream: ReturnType<typeof createAssistantMessageEventStream>;
}) {
  let current: CurrentStreamBlock | null = null;
  const currentByCallId = new Map<string, CurrentStreamBlock>();
  const currentByItemId = new Map<string, CurrentStreamBlock>();
  const currentByOutputIndex = new Map<number, CurrentStreamBlock>();
  const emittedPatchProgressKeys = new Set<string>();

  const emitPatchProgress = (patchText: string) => {
    const progress = getPatchProgressFromText(patchText);
    if (progress === null) {
      return;
    }

    const key = JSON.stringify(progress);
    if (emittedPatchProgressKeys.has(key)) {
      return;
    }

    emittedPatchProgressKeys.add(key);
    onPatchProgress?.(progress);
  };
  const eventOutputIndex = (event: OpenAiResponsesEvent): number | null =>
    Number.isInteger(event.output_index) ? event.output_index! : null;
  const eventItemId = (event: OpenAiResponsesEvent): string | null =>
    typeof event.item_id === "string" && event.item_id.length > 0
      ? event.item_id
      : typeof event.item?.id === "string" && event.item.id.length > 0
        ? event.item.id
        : null;
  const eventCallId = (event: OpenAiResponsesEvent): string | null =>
    typeof event.call_id === "string" && event.call_id.length > 0
      ? event.call_id
      : typeof event.item?.call_id === "string" && event.item.call_id.length > 0
        ? event.item.call_id
        : null;
  const registerCurrent = <T extends CurrentStreamBlock>(
    event: OpenAiResponsesEvent,
    state: T,
  ): T => {
    const outputIndex = eventOutputIndex(event);
    if (outputIndex !== null) {
      state.outputIndex = outputIndex;
      currentByOutputIndex.set(outputIndex, state);
    }

    const itemId = eventItemId(event);
    if (itemId !== null) {
      state.itemId = itemId;
      currentByItemId.set(itemId, state);
    }

    const callId = eventCallId(event);
    if (callId !== null) {
      state.callId = callId;
      currentByCallId.set(callId, state);
    }

    current = state;
    return state;
  };
  const currentForEvent = <T extends CurrentStreamBlock["type"]>(
    event: OpenAiResponsesEvent,
    type: T,
  ): Extract<CurrentStreamBlock, { type: T }> | null => {
    let hasRoutingKey = false;
    const outputIndex = eventOutputIndex(event);
    if (outputIndex !== null) {
      hasRoutingKey = true;
      const state = currentByOutputIndex.get(outputIndex);
      if (state !== undefined) {
        return state.type === type
          ? (state as Extract<CurrentStreamBlock, { type: T }>)
          : null;
      }
    }

    const itemId = eventItemId(event);
    if (itemId !== null) {
      hasRoutingKey = true;
      const state = currentByItemId.get(itemId);
      if (state !== undefined) {
        return state.type === type
          ? (state as Extract<CurrentStreamBlock, { type: T }>)
          : null;
      }
    }

    const callId = eventCallId(event);
    if (callId !== null) {
      hasRoutingKey = true;
      const state = currentByCallId.get(callId);
      if (state !== undefined) {
        return state.type === type
          ? (state as Extract<CurrentStreamBlock, { type: T }>)
          : null;
      }
    }

    if (hasRoutingKey) {
      return null;
    }

    return current?.type === type
      ? (current as Extract<CurrentStreamBlock, { type: T }>)
      : null;
  };
  const unregisterCurrent = (state: CurrentStreamBlock) => {
    if (current === state) {
      current = null;
    }
    if (
      state.outputIndex !== undefined &&
      currentByOutputIndex.get(state.outputIndex) === state
    ) {
      currentByOutputIndex.delete(state.outputIndex);
    }
    if (
      state.itemId !== undefined &&
      currentByItemId.get(state.itemId) === state
    ) {
      currentByItemId.delete(state.itemId);
    }
    if (
      state.callId !== undefined &&
      currentByCallId.get(state.callId) === state
    ) {
      currentByCallId.delete(state.callId);
    }
  };

  for await (const rawEvent of events) {
    const event = rawEvent as OpenAiResponsesEvent;
    if (event.type === "response.created" && event.response?.id !== undefined) {
      output.responseId = event.response.id;
      continue;
    }

    if (event.type === "response.output_item.added") {
      const item = event.item;
      if (item?.type === "message") {
        const block: TextContent = { text: "", type: "text" };
        const contentIndex = output.content.push(block) - 1;
        const state = registerCurrent(event, {
          block,
          contentIndex,
          item,
          type: "text",
        });
        stream.push({
          contentIndex: state.contentIndex,
          partial: output,
          type: "text_start",
        });
        continue;
      }
      if (item?.type === "function_call") {
        const block = {
          arguments: {},
          id: responsesToolCallId(item),
          name: requiredString(item.name, "function_call.name"),
          partialJson: item.arguments ?? "",
          type: "toolCall" as const,
        };
        const contentIndex = output.content.push(block) - 1;
        const state = registerCurrent(event, {
          block,
          contentIndex,
          item,
          type: "functionTool",
        });
        stream.push({
          contentIndex: state.contentIndex,
          partial: output,
          type: "toolcall_start",
        });
        continue;
      }
      if (item?.type === "custom_tool_call") {
        const block = {
          arguments: {
            input: item.input ?? "",
          },
          id: responsesToolCallId(item),
          name: requiredString(item.name, "custom_tool_call.name"),
          partialInput: item.input ?? "",
          type: "toolCall" as const,
        };
        const contentIndex = output.content.push(block) - 1;
        const state = registerCurrent(event, {
          block,
          contentIndex,
          item,
          type: "customTool",
        });
        if (block.partialInput.length > 0) {
          emitPatchProgress(block.partialInput);
        }
        stream.push({
          contentIndex: state.contentIndex,
          partial: output,
          type: "toolcall_start",
        });
        continue;
      }
    }

    if (event.type === "response.content_part.added") {
      const state = currentForEvent(event, "text");
      if (
        state !== null &&
        (event.part?.type === "output_text" || event.part?.type === "refusal")
      ) {
        state.item.content ??= [];
        state.item.content.push(event.part);
      }
      continue;
    }

    if (event.type === "response.output_text.delta") {
      const state = currentForEvent(event, "text");
      if (state !== null) {
        const delta = event.delta ?? "";
        state.block.text += delta;
        stream.push({
          contentIndex: state.contentIndex,
          delta,
          partial: output,
          type: "text_delta",
        });
      }
      continue;
    }

    if (event.type === "response.refusal.delta") {
      const state = currentForEvent(event, "text");
      if (state !== null) {
        const delta = event.delta ?? "";
        state.block.text += delta;
        stream.push({
          contentIndex: state.contentIndex,
          delta,
          partial: output,
          type: "text_delta",
        });
      }
      continue;
    }

    if (event.type === "response.function_call_arguments.delta") {
      const state = currentForEvent(event, "functionTool");
      if (state !== null) {
        const delta = event.delta ?? "";
        state.block.partialJson = `${state.block.partialJson ?? ""}${delta}`;
        state.block.arguments = parseStreamingJson(state.block.partialJson);
        stream.push({
          contentIndex: state.contentIndex,
          delta,
          partial: output,
          type: "toolcall_delta",
        });
      }
      continue;
    }

    if (event.type === "response.function_call_arguments.done") {
      const state = currentForEvent(event, "functionTool");
      if (state !== null) {
        state.block.partialJson =
          event.arguments ?? state.block.partialJson ?? "";
        state.block.arguments = parseStreamingJson(state.block.partialJson);
      }
      continue;
    }

    if (event.type === "response.custom_tool_call_input.delta") {
      const state = currentForEvent(event, "customTool");
      if (state !== null) {
        const delta = event.delta ?? "";
        state.block.partialInput = `${state.block.partialInput ?? ""}${delta}`;
        state.block.arguments = {
          input: state.block.partialInput,
        };
        emitPatchProgress(state.block.partialInput);
        stream.push({
          contentIndex: state.contentIndex,
          delta,
          partial: output,
          type: "toolcall_delta",
        });
      }
      continue;
    }

    if (event.type === "response.custom_tool_call_input.done") {
      const state = currentForEvent(event, "customTool");
      if (state !== null) {
        state.block.partialInput =
          event.input ?? state.block.partialInput ?? "";
        state.block.arguments = {
          input: state.block.partialInput,
        };
        if (state.block.partialInput.length > 0) {
          emitPatchProgress(state.block.partialInput);
        }
      }
      continue;
    }

    if (event.type === "response.output_item.done") {
      const item = event.item;
      if (item?.type === "message") {
        const state = currentForEvent(event, "text");
        if (state === null) {
          continue;
        }
        state.block.text =
          item.content
            ?.map((part) =>
              part.type === "output_text"
                ? (part.text ?? "")
                : (part.refusal ?? ""),
            )
            .join("") ?? state.block.text;
        stream.push({
          content: state.block.text,
          contentIndex: state.contentIndex,
          partial: output,
          type: "text_end",
        });
        unregisterCurrent(state);
        continue;
      }
      if (item?.type === "function_call") {
        let toolCall: ToolCall;
        let contentIndex: number;
        const state = currentForEvent(event, "functionTool");
        if (state !== null) {
          toolCall = finalizeFunctionToolCall(state.block, item);
          contentIndex = state.contentIndex;
          unregisterCurrent(state);
        } else {
          toolCall = toolCallFromFunctionItem(item);
          contentIndex = output.content.push(toolCall) - 1;
        }
        stream.push({
          contentIndex,
          partial: output,
          toolCall,
          type: "toolcall_end",
        });
        continue;
      }
      if (item?.type === "custom_tool_call") {
        let toolCall: ToolCall;
        let contentIndex: number;
        const state = currentForEvent(event, "customTool");
        if (state !== null) {
          toolCall = finalizeCustomToolCall(state.block, item);
          contentIndex = state.contentIndex;
          unregisterCurrent(state);
        } else {
          toolCall = toolCallFromCustomItem(item);
          contentIndex = output.content.push(toolCall) - 1;
        }
        const patch = patchInputFromToolArguments(toolCall.arguments);
        if (patch.length > 0) {
          emitPatchProgress(patch);
        }
        stream.push({
          contentIndex,
          partial: output,
          toolCall,
          type: "toolcall_end",
        });
        continue;
      }
    }

    if (event.type === "response.completed") {
      if (event.response?.id !== undefined) {
        output.responseId = event.response.id;
      }
      if (event.response?.usage !== undefined) {
        output.usage = usageFromOpenAiResponsesUsage(event.response.usage);
        calculateCost(model, output.usage);
      }
      output.stopReason = output.content.some(
        (block) => block.type === "toolCall",
      )
        ? "toolUse"
        : mapOpenAiResponsesStatus(event.response?.status);
      continue;
    }

    if (event.type === "response.failed") {
      const message =
        event.response?.error?.message ??
        event.response?.incomplete_details?.reason ??
        "OpenAI Responses request failed.";
      throw new Error(message);
    }

    if (event.type === "error") {
      throw new Error(
        event.message ?? event.code ?? "OpenAI Responses stream error.",
      );
    }
  }
}

function createInitialAssistantMessage(model: Model<Api>): AssistantMessage {
  return {
    api: model.api,
    content: [],
    model: model.id,
    provider: model.provider,
    role: "assistant",
    stopReason: "stop",
    timestamp: Date.now(),
    usage: emptyUsage(),
  };
}

function emptyUsage(): Usage {
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

function openAiResponsesInputFromContext(context: Context): unknown[] {
  return context.messages.flatMap((message) => {
    if (message.role === "user") {
      return [
        {
          content:
            typeof message.content === "string"
              ? [{ text: message.content, type: "input_text" }]
              : message.content.map((part) =>
                  part.type === "text"
                    ? { text: part.text, type: "input_text" }
                    : {
                        detail: "auto",
                        image_url: `data:${part.mimeType};base64,${part.data}`,
                        type: "input_image",
                      },
                ),
          role: "user",
        },
      ];
    }

    if (message.role === "assistant") {
      const text = message.content
        .filter((part): part is TextContent => part.type === "text")
        .map((part) => part.text)
        .join("\n");
      const items: unknown[] =
        text.length === 0
          ? []
          : [
              {
                content: [
                  {
                    annotations: [],
                    text,
                    type: "output_text",
                  },
                ],
                role: "assistant",
                type: "message",
              },
            ];

      for (const toolCall of message.content.filter(
        (part): part is ToolCall => part.type === "toolCall",
      )) {
        items.push(openAiResponsesInputToolCallFromClutchToolCall(toolCall));
      }

      return items;
    }

    const output = message.content
      .filter((part): part is TextContent => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    const callId = message.toolCallId.split("|")[0];
    if (message.toolName === APPLY_PATCH_TOOL_NAME) {
      return [
        {
          call_id: callId,
          output,
          type: "custom_tool_call_output",
        },
      ];
    }

    return [
      {
        call_id: callId,
        output,
        type: "function_call_output",
      },
    ];
  });
}

function openAiResponsesInputToolCallFromClutchToolCall(
  toolCall: ToolCall,
): unknown {
  const callId = toolCall.id.split("|")[0];
  if (toolCall.name === APPLY_PATCH_TOOL_NAME) {
    return {
      call_id: callId,
      input: patchInputFromToolArguments(toolCall.arguments),
      name: APPLY_PATCH_TOOL_NAME,
      type: "custom_tool_call",
    };
  }

  return {
    arguments: JSON.stringify(toolCall.arguments),
    call_id: callId,
    name: toolCall.name,
    type: "function_call",
  };
}

function finalizeFunctionToolCall(
  block: ToolCall & { partialJson?: string },
  item: OpenAiResponsesItem,
): ToolCall {
  block.arguments = parseStreamingJson(
    item.arguments ?? block.partialJson ?? "{}",
  );
  delete block.partialJson;
  return block;
}

function finalizeCustomToolCall(
  block: ToolCall & { partialInput?: string },
  item: OpenAiResponsesItem,
): ToolCall {
  block.arguments = {
    input: item.input ?? block.partialInput ?? "",
  };
  delete block.partialInput;
  return block;
}

function toolCallFromFunctionItem(item: OpenAiResponsesItem): ToolCall {
  return {
    arguments: parseStreamingJson(item.arguments ?? "{}"),
    id: responsesToolCallId(item),
    name: requiredString(item.name, "function_call.name"),
    type: "toolCall",
  };
}

function toolCallFromCustomItem(item: OpenAiResponsesItem): ToolCall {
  return {
    arguments: {
      input: item.input ?? "",
    },
    id: responsesToolCallId(item),
    name: requiredString(item.name, "custom_tool_call.name"),
    type: "toolCall",
  };
}

function responsesToolCallId(item: OpenAiResponsesItem): string {
  const callId = requiredString(item.call_id, "tool_call.call_id");
  return typeof item.id === "string" && item.id.length > 0
    ? `${callId}|${item.id}`
    : callId;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value;
}

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function headersToRecord(headers: Headers): Record<string, string> {
  const record: Record<string, string> = {};
  headers.forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

function buildCodexSseHeaders({
  accountId,
  headers,
  sessionId,
  token,
}: {
  accountId: string;
  headers: Record<string, string>;
  sessionId?: string;
  token: string;
}): Headers {
  const result = new Headers(headers);
  result.set("Authorization", `Bearer ${token}`);
  result.set("chatgpt-account-id", accountId);
  result.set("originator", "pi");
  result.set("User-Agent", "pi (clutch)");
  result.set("OpenAI-Beta", "responses=experimental");
  result.set("accept", "text/event-stream");
  result.set("content-type", "application/json");
  if (sessionId !== undefined && sessionId.length > 0) {
    result.set("session-id", sessionId);
    result.set("x-client-request-id", sessionId);
  }
  return result;
}

function resolveCodexUrl(baseUrl: string): string {
  const raw = baseUrl.trim().length > 0 ? baseUrl : DEFAULT_CODEX_BASE_URL;
  const normalized = raw.replace(/\/+$/, "");
  if (normalized.endsWith("/codex/responses")) {
    return normalized;
  }
  if (normalized.endsWith("/codex")) {
    return `${normalized}/responses`;
  }
  return `${normalized}/codex/responses`;
}

function extractAccountId(token: string): string {
  const parts = token.split(".");
  if (parts.length < 2 || parts[1] === undefined) {
    throw new Error("Failed to extract accountId from token");
  }

  try {
    const payload = JSON.parse(base64UrlDecode(parts[1]));
    const accountId = payload?.[JWT_CLAIM_PATH]?.chatgpt_account_id;
    if (typeof accountId !== "string" || accountId.length === 0) {
      throw new Error("No account ID in token");
    }
    return accountId;
  } catch {
    throw new Error("Failed to extract accountId from token");
  }
}

function base64UrlDecode(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = `${base64}${"=".repeat((4 - (base64.length % 4)) % 4)}`;
  return atob(padded);
}

async function formatCodexErrorResponse(response: Response): Promise<string> {
  const text = await response.text();
  if (text.trim().length === 0) {
    return `Codex response failed with status ${response.status}.`;
  }

  try {
    const parsed = JSON.parse(text);
    const message =
      parsed?.detail ??
      parsed?.message ??
      parsed?.error?.message ??
      parsed?.error?.code;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  } catch {
    // Fall through to raw text.
  }

  return text;
}

async function* parseSseEvents(
  response: Response,
  signal?: AbortSignal,
): AsyncIterable<unknown> {
  if (response.body === null) {
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const abort = () => {
    void reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });

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

      let boundary = buffer.indexOf("\n\n");
      while (boundary !== -1) {
        const chunk = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const data = chunk
          .split("\n")
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice("data:".length).trim())
          .join("\n")
          .trim();
        if (data.length > 0 && data !== "[DONE]") {
          yield JSON.parse(data);
        }
        boundary = buffer.indexOf("\n\n");
      }
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    try {
      await reader.cancel();
    } catch {
      // Reader may already be closed.
    }
    try {
      reader.releaseLock();
    } catch {
      // Reader may already be released.
    }
  }
}

async function* mapCodexEvents(
  events: AsyncIterable<unknown>,
): AsyncIterable<unknown> {
  for await (const rawEvent of events) {
    const event = rawEvent as OpenAiResponsesEvent;
    if (event.type === "error") {
      throw new Error(event.message ?? event.code ?? "Codex stream error.");
    }
    if (event.type === "response.failed") {
      throw new Error(
        event.response?.error?.message ?? "Codex response failed.",
      );
    }
    if (
      event.type === "response.done" ||
      event.type === "response.completed" ||
      event.type === "response.incomplete"
    ) {
      yield {
        ...event,
        response: {
          ...event.response,
          status: normalizeCodexStatus(event.response?.status),
        },
        type: "response.completed",
      };
      return;
    }
    yield event;
  }
}

function normalizeCodexStatus(status: string | undefined): string | undefined {
  if (
    status === "completed" ||
    status === "incomplete" ||
    status === "failed" ||
    status === "cancelled" ||
    status === "queued" ||
    status === "in_progress"
  ) {
    return status;
  }
  return undefined;
}

function usageFromOpenAiResponsesUsage(
  usage: NonNullable<OpenAiResponsesEvent["response"]>["usage"],
): Usage {
  const cachedTokens = usage?.input_tokens_details?.cached_tokens ?? 0;
  return {
    cacheRead: cachedTokens,
    cacheWrite: 0,
    cost: emptyUsage().cost,
    input: (usage?.input_tokens ?? 0) - cachedTokens,
    output: usage?.output_tokens ?? 0,
    totalTokens: usage?.total_tokens ?? 0,
  };
}

function mapOpenAiResponsesStatus(status: string | undefined) {
  if (status === "incomplete") {
    return "length";
  }
  if (status === "failed" || status === "cancelled") {
    return "error";
  }
  return "stop";
}

function successfulStopReason(reason: AssistantMessage["stopReason"]) {
  if (reason === "length" || reason === "toolUse") {
    return reason;
  }
  return "stop";
}
