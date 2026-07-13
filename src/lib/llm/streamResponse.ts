import type { ContextItem } from "../../types";
import { resolveConfiguredLlmRequest } from "../config/clutchConfig";
import { buildLlmInteractionContext } from "./interactionContext";
import { configuredLlmRequestOptions } from "./requestOptions";
import { streamDirectLlmResponse } from "./llmClient";
import { APPLY_PATCH_TOOL_NAME, patchProposalFromToolCall } from "./patchTool";
import type {
  LlmWorkflowToolResult,
  PatchToolMode,
} from "../../workflows/llmTools/types";
import { applyPatchProposalWithRuntimeEvents } from "../../workflows/patch/patchApplyRuntime";
import { buildPatchValidationFailureToolOutput } from "../patch/patchToolOutput";
import type { PatchProgressState } from "../patch/types";
import type {
  AssistantMessageEventStream,
  LlmAssistantMessage,
  LlmContext,
  LlmTextContent,
  LlmToolCall,
  LlmToolResultMessage,
} from "./types";

type ConfiguredLlmRequest = Awaited<
  ReturnType<typeof resolveConfiguredLlmRequest>
>;
type ConfiguredLlmRequestOptions = ReturnType<
  typeof configuredLlmRequestOptions
>;

const MAX_INVALID_PATCH_TOOL_RETRIES = 3;
const MAX_PATCH_TOOL_CONTINUATIONS = 8;

export type { PatchToolMode };

export type StreamLlmResponseOptions = {
  allowedToolNames?: readonly string[];
  commandDirective?: string;
  question: string;
  contextItems: readonly ContextItem[];
  focusedContextItemId?: string | null;
  root?: string;
  signal?: AbortSignal;
  requestId?: number;
  onDelta?: (delta: string) => void;
  onCompletionLatency?: (stats: LlmCompletionLatencyStats) => void;
  onPatchProgress?: (progress: PatchProgressState) => void;
  patchToolMode?: PatchToolMode;
};

export type LlmCompletionLatencyStats = {
  totalMs: number;
  ttftMs?: number;
};

export type StreamLlmInteractionResult =
  | {
      kind: "text";
      responseText: string;
    }
  | ({ responseText: string } & LlmWorkflowToolResult);

export type LlmToolContinuationOutput = {
  content: string;
  isError?: boolean;
  toolCallId: string;
  toolName: string;
};

export type StreamLlmToolContinuationResult = {
  assistantMessage: LlmAssistantMessage;
  context: LlmContext;
  responseText: string;
};

export class LlmCompletionError extends Error {
  constructor(readonly debugOutput: string) {
    super("LLM completion failed. See response output for full details.");
    this.name = "LlmCompletionError";
  }
}

export async function streamLlmResponse(
  options: StreamLlmResponseOptions,
): Promise<string> {
  const result = await streamLlmInteraction(options);
  return result.kind === "text" ? result.responseText : "";
}

export function buildLlmToolContinuationContext({
  assistantMessage,
  context,
  timestamp = Date.now(),
  toolOutput,
  toolOutputs,
}: {
  assistantMessage: LlmAssistantMessage;
  context: LlmContext;
  timestamp?: number;
  toolOutput?: LlmToolContinuationOutput;
  toolOutputs?: readonly LlmToolContinuationOutput[];
}): LlmContext {
  const outputs = normalizeToolOutputs({ toolOutput, toolOutputs });
  const toolResults: LlmToolResultMessage[] = outputs.map((output) => ({
    content: [{ text: output.content, type: "text" }],
    isError: output.isError ?? false,
    role: "toolResult",
    timestamp,
    toolCallId: output.toolCallId,
    toolName: output.toolName,
  }));

  return {
    ...context,
    messages: [...context.messages, assistantMessage, ...toolResults],
  };
}

export async function streamLlmToolContinuation({
  assistantMessage,
  context,
  onCompletionLatency,
  onDelta,
  onPatchProgress,
  signal,
  toolOutput,
  toolOutputs,
}: {
  assistantMessage: LlmAssistantMessage;
  context: LlmContext;
  onCompletionLatency?: (stats: LlmCompletionLatencyStats) => void;
  onDelta?: (delta: string) => void;
  onPatchProgress?: (progress: PatchProgressState) => void;
  signal?: AbortSignal;
  toolOutput?: LlmToolContinuationOutput;
  toolOutputs?: readonly LlmToolContinuationOutput[];
}): Promise<StreamLlmToolContinuationResult> {
  const continuationContext = buildLlmToolContinuationContext({
    assistantMessage,
    context,
    toolOutput,
    toolOutputs,
  });
  const request = await resolveConfiguredLlmRequest("primary");
  const requestOptions = configuredLlmRequestOptions({
    ...request,
    signal,
  });
  const completionStartedAtMs = Date.now();
  const eventStream = createConfiguredEventStream({
    context: continuationContext,
    onPatchProgress,
    request,
    requestOptions,
  });
  const { finalMessage, responseText } = await collectAssistantMessage({
    completionStartedAtMs,
    eventStream,
    onCompletionLatency,
    onDelta,
  });

  return {
    assistantMessage: finalMessage,
    context: continuationContext,
    responseText,
  };
}

export async function streamLlmInteraction({
  allowedToolNames,
  commandDirective,
  question,
  contextItems,
  focusedContextItemId,
  root,
  signal,
  requestId,
  onDelta,
  onCompletionLatency,
  onPatchProgress,
  patchToolMode = "review",
}: StreamLlmResponseOptions): Promise<StreamLlmInteractionResult> {
  const { context } = await buildLlmInteractionContext({
    allowedToolNames,
    commandDirective,
    question,
    contextItems,
    focusedContextItemId,
    root,
  });
  const routeWorkflowToolCalls = async (toolCalls: readonly LlmToolCall[]) => {
    const { routeLlmWorkflowToolCalls } = await import(
      "../../workflows/llmTools/toolRegistry"
    );
    return await routeLlmWorkflowToolCalls({
      allowedToolNames,
      root,
      signal,
      toolCalls,
    });
  };
  const request = await resolveConfiguredLlmRequest("primary");
  const requestOptions = configuredLlmRequestOptions({
    ...request,
    signal,
  });
  const completionStartedAtMs = Date.now();
  const eventStream = createConfiguredEventStream({
    context,
    onPatchProgress,
    request,
    requestOptions,
  });
  const { finalMessage, responseText } = await collectAssistantMessage({
    completionStartedAtMs,
    eventStream,
    onCompletionLatency,
    onDelta,
  });
  const toolCalls = getAssistantToolCalls(finalMessage);
  if (patchToolMode === "apply" && areOnlyApplyPatchToolCalls(toolCalls)) {
    return await continueApplyPatchToolCalls({
      context,
      firstAssistantMessage: finalMessage,
      firstResponseText: responseText,
      requestId,
      root,
      routeAssistantMessageToolCalls: (assistantMessage) =>
        routeWorkflowToolCalls(getAssistantToolCalls(assistantMessage)),
      streamContinuation: ({ assistantMessage, context, toolOutputs }) =>
        streamLlmToolContinuation({
          assistantMessage,
          context,
          onCompletionLatency,
          onDelta,
          onPatchProgress,
          signal,
          toolOutputs,
      }),
    });
  }
  if (toolCalls.length === 0) {
    return {
      kind: "text",
      responseText,
    };
  }

  const workflowResult = await routeWorkflowToolCalls(toolCalls);

  if (workflowResult !== null) {
    return await continuePatchToolCalls({
      context,
      firstAssistantMessage: finalMessage,
      firstResponseText: responseText,
      firstWorkflowResult: workflowResult,
      patchToolMode,
      requestId,
      routeAssistantMessageToolCalls: (assistantMessage) =>
        routeWorkflowToolCalls(getAssistantToolCalls(assistantMessage)),
      root,
      streamContinuation: ({ assistantMessage, context, toolOutput }) =>
        streamLlmToolContinuation({
          assistantMessage,
          context,
          onCompletionLatency,
          onDelta,
          onPatchProgress,
          signal,
          toolOutput,
        }),
    });
  }

  return {
    kind: "text",
    responseText,
  };
}

export async function continuePatchToolCalls({
  context,
  firstAssistantMessage,
  firstResponseText,
  firstWorkflowResult,
  maxInvalidPatchRetries = MAX_INVALID_PATCH_TOOL_RETRIES,
  maxToolContinuations = MAX_PATCH_TOOL_CONTINUATIONS,
  patchToolMode = "review",
  requestId,
  root,
  routeAssistantMessageToolCalls,
  streamContinuation,
}: {
  context: LlmContext;
  firstAssistantMessage: LlmAssistantMessage;
  firstResponseText: string;
  firstWorkflowResult: LlmWorkflowToolResult;
  maxInvalidPatchRetries?: number;
  maxToolContinuations?: number;
  patchToolMode?: PatchToolMode;
  requestId?: number;
  root?: string;
  routeAssistantMessageToolCalls: (
    assistantMessage: LlmAssistantMessage,
  ) => Promise<LlmWorkflowToolResult | null>;
  streamContinuation: (options: {
    assistantMessage: LlmAssistantMessage;
    context: LlmContext;
    toolOutput: LlmToolContinuationOutput;
  }) => Promise<StreamLlmToolContinuationResult>;
}): Promise<StreamLlmInteractionResult> {
  let assistantMessage = firstAssistantMessage;
  let continuationContext = context;
  let responseText = firstResponseText;
  let workflowResult = firstWorkflowResult;
  let invalidPatchRetryCount = 0;
  let toolContinuationCount = 0;

  while (true) {
    if (workflowResult.kind !== "patch") {
      return {
        ...workflowResult,
        responseText,
      };
    }

    const toolCall = getAssistantToolCalls(assistantMessage)[0];
    if (toolCall === undefined) {
      return {
        ...workflowResult,
        responseText,
      };
    }

    if (workflowResult.patch.status === "valid") {
      if (patchToolMode === "review") {
        return {
          ...workflowResult,
          responseText,
        };
      }

      if (toolContinuationCount >= maxToolContinuations) {
        return {
          ...workflowResult,
          responseText,
        };
      }

      const applyResult = await applyPatchProposalWithRuntimeEvents({
        proposal: workflowResult.patch.proposal,
        requestId,
        root,
      });
      if (applyResult.status === "invalid") {
        workflowResult = {
          kind: "patch",
          patch: applyResult,
        };
        continue;
      }

      toolContinuationCount += 1;
      const continuation = await streamContinuation({
        assistantMessage,
        context: continuationContext,
        toolOutput: {
          content: applyResult.toolOutput.content,
          isError: false,
          toolCallId: toolCall.id,
          toolName: toolCall.name,
        },
      });
      const retryWorkflowResult = await routeAssistantMessageToolCalls(
        continuation.assistantMessage,
      );

      continuationContext = continuation.context;
      assistantMessage = continuation.assistantMessage;
      responseText = continuation.responseText;

      if (retryWorkflowResult === null) {
        return {
          applyStatus: "applied",
          kind: "patch",
          patch: applyResult,
          responseText,
        };
      }

      workflowResult = retryWorkflowResult;
      continue;
    }

    if (invalidPatchRetryCount >= maxInvalidPatchRetries) {
      return {
        ...workflowResult,
        responseText,
      };
    }

    const toolOutput = buildPatchValidationFailureToolOutput({
      result: workflowResult.patch,
    });
    invalidPatchRetryCount += 1;
    toolContinuationCount += 1;
    const continuation = await streamContinuation({
      assistantMessage,
      context: continuationContext,
      toolOutput: {
        content: toolOutput.content,
        isError: true,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
      },
    });
    const retryWorkflowResult = await routeAssistantMessageToolCalls(
      continuation.assistantMessage,
    );

    continuationContext = continuation.context;
    assistantMessage = continuation.assistantMessage;
    responseText = continuation.responseText;

    if (retryWorkflowResult === null) {
      return {
        kind: "text",
        responseText,
      };
    }

    workflowResult = retryWorkflowResult;
  }
}

export async function continueApplyPatchToolCalls({
  context,
  firstAssistantMessage,
  firstResponseText,
  maxToolContinuations = MAX_PATCH_TOOL_CONTINUATIONS,
  requestId,
  root,
  routeAssistantMessageToolCalls,
  streamContinuation,
}: {
  context: LlmContext;
  firstAssistantMessage: LlmAssistantMessage;
  firstResponseText: string;
  maxToolContinuations?: number;
  requestId?: number;
  root?: string;
  routeAssistantMessageToolCalls: (
    assistantMessage: LlmAssistantMessage,
  ) => Promise<LlmWorkflowToolResult | null>;
  streamContinuation: (options: {
    assistantMessage: LlmAssistantMessage;
    context: LlmContext;
    toolOutputs: readonly LlmToolContinuationOutput[];
  }) => Promise<StreamLlmToolContinuationResult>;
}): Promise<StreamLlmInteractionResult> {
  let assistantMessage = firstAssistantMessage;
  let continuationContext = context;
  let responseText = firstResponseText;
  let lastAppliedPatch: (LlmWorkflowToolResult & { kind: "patch" }) | null =
    null;

  for (
    let continuationCount = 0;
    continuationCount < maxToolContinuations;
    continuationCount += 1
  ) {
    const patchToolCalls = getAssistantToolCalls(assistantMessage);
    if (!areOnlyApplyPatchToolCalls(patchToolCalls)) {
      const workflowResult =
        await routeAssistantMessageToolCalls(assistantMessage);
      return workflowResult === null
        ? { kind: "text", responseText }
        : { ...workflowResult, responseText };
    }

    const toolOutputs: LlmToolContinuationOutput[] = [];
    let hadApplyFailure = false;
    for (const toolCall of patchToolCalls) {
      const applyResult = await applyPatchProposalWithRuntimeEvents({
        proposal: patchProposalFromToolCall(toolCall),
        requestId,
        root,
      });
      if (applyResult.status === "valid") {
        lastAppliedPatch = {
          applyStatus: "applied",
          kind: "patch",
          patch: applyResult,
        };
      } else {
        hadApplyFailure = true;
      }
      toolOutputs.push({
        content: applyResult.toolOutput.content,
        isError: !applyResult.toolOutput.success,
        toolCallId: toolCall.id,
        toolName: toolCall.name,
      });
    }

    const continuation = await streamContinuation({
      assistantMessage,
      context: continuationContext,
      toolOutputs,
    });

    continuationContext = continuation.context;
    assistantMessage = continuation.assistantMessage;
    responseText = continuation.responseText;
    if (hadApplyFailure) {
      lastAppliedPatch = null;
    }

    if (getAssistantToolCalls(assistantMessage).length === 0) {
      return lastAppliedPatch === null
        ? {
            kind: "text",
            responseText,
          }
        : {
            ...lastAppliedPatch,
            responseText,
          };
    }
  }

  const workflowResult = await routeAssistantMessageToolCalls(assistantMessage);
  return workflowResult === null
    ? { kind: "text", responseText }
    : { ...workflowResult, responseText };
}

function createConfiguredEventStream({
  context,
  request,
  requestOptions,
}: {
  context: LlmContext;
  onPatchProgress?: (progress: PatchProgressState) => void;
  request: ConfiguredLlmRequest;
  requestOptions: ConfiguredLlmRequestOptions;
}): AssistantMessageEventStream {
  return streamDirectLlmResponse(request.model, context, requestOptions);
}

async function collectAssistantMessage({
  completionStartedAtMs = Date.now(),
  eventStream,
  onCompletionLatency,
  onDelta,
}: {
  completionStartedAtMs?: number;
  eventStream: AssistantMessageEventStream;
  onCompletionLatency?: (stats: LlmCompletionLatencyStats) => void;
  onDelta?: (delta: string) => void;
}): Promise<{ finalMessage: LlmAssistantMessage; responseText: string }> {
  const latencyTracker = createCompletionLatencyTracker(
    onCompletionLatency,
    completionStartedAtMs,
  );
  let streamedText = "";

  let finalMessage: LlmAssistantMessage;
  try {
    for await (const event of eventStream) {
      if (event.type === "text_delta") {
        streamedText += event.delta;
        latencyTracker.recordToken();
        onDelta?.(event.delta);
        continue;
      }

      if (event.type === "error") {
        throw new LlmCompletionError(
          formatCompletionFailureOutput({
            assistantMessage: event.error,
            error:
              event.error.errorMessage ??
              "The LLM request failed without an error message.",
            streamedText,
          }),
        );
      }
    }

    finalMessage = await eventStream.result();
  } catch (error) {
    if (error instanceof LlmCompletionError) {
      throw error;
    }

    throw new LlmCompletionError(
      formatCompletionFailureOutput({ error, streamedText }),
    );
  } finally {
    latencyTracker.finish();
  }

  const finalText = getAssistantText(finalMessage);
  const responseText = finalText.length > 0 ? finalText : streamedText;

  return { finalMessage, responseText };
}

function createCompletionLatencyTracker(
  onCompletionLatency: ((stats: LlmCompletionLatencyStats) => void) | undefined,
  startedAtMs = Date.now(),
): {
  finish: () => void;
  recordToken: () => void;
} {
  let finished = false;
  let ttftMs: number | undefined;

  return {
    finish: () => {
      if (finished) {
        return;
      }

      finished = true;
      onCompletionLatency?.({
        totalMs: elapsedSince(startedAtMs),
        ...(ttftMs === undefined ? {} : { ttftMs }),
      });
    },
    recordToken: () => {
      ttftMs ??= elapsedSince(startedAtMs);
    },
  };
}

function elapsedSince(startedAtMs: number): number {
  return Math.max(0, Date.now() - startedAtMs);
}

function formatCompletionFailureOutput({
  assistantMessage,
  error,
  streamedText,
}: {
  assistantMessage?: LlmAssistantMessage;
  error: unknown;
  streamedText: string;
}): string {
  return [
    "# LLM completion failed",
    "",
    "## Error",
    "```text",
    formatUnknownError(error),
    "```",
    "",
    "## Partial streamed text",
    streamedText.trim().length === 0 ? "(none)" : streamedText,
    "",
    "## Provider error response",
    assistantMessage === undefined
      ? "(none)"
      : `\`\`\`json\n${safeJsonStringify(assistantMessage)}\n\`\`\``,
  ].join("\n");
}

function formatUnknownError(error: unknown): string {
  if (error instanceof Error) {
    const parts = [
      `${error.name}: ${error.message}`,
      error.stack === undefined ? undefined : `\nStack:\n${error.stack}`,
      error.cause === undefined
        ? undefined
        : `\nCause:\n${formatUnknownError(error.cause)}`,
    ];

    return parts.filter((part) => part !== undefined).join("\n");
  }

  return typeof error === "string" ? error : safeJsonStringify(error);
}

function safeJsonStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return `Could not serialize value: ${error instanceof Error ? error.message : String(error)}`;
  }
}

function getAssistantText(message: LlmAssistantMessage): string {
  return message.content
    .filter((block): block is LlmTextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function getAssistantToolCalls(message: LlmAssistantMessage): LlmToolCall[] {
  return message.content.filter(
    (block): block is LlmToolCall => block.type === "toolCall",
  );
}

function areOnlyApplyPatchToolCalls(toolCalls: readonly LlmToolCall[]): boolean {
  return (
    toolCalls.length > 0 &&
    toolCalls.every((toolCall) => toolCall.name === APPLY_PATCH_TOOL_NAME)
  );
}

function normalizeToolOutputs({
  toolOutput,
  toolOutputs,
}: {
  toolOutput?: LlmToolContinuationOutput;
  toolOutputs?: readonly LlmToolContinuationOutput[];
}): readonly LlmToolContinuationOutput[] {
  if (toolOutputs !== undefined) {
    if (toolOutput !== undefined) {
      throw new Error("Specify toolOutput or toolOutputs, not both.");
    }
    if (toolOutputs.length === 0) {
      throw new Error("toolOutputs must include at least one tool result.");
    }
    return toolOutputs;
  }

  if (toolOutput === undefined) {
    throw new Error("Expected a tool output for LLM continuation.");
  }

  return [toolOutput];
}
