import {
  stream,
  type AssistantMessage,
  type TextContent,
  type ToolCall,
} from "@earendil-works/pi-ai";
import type { ContextItem } from "../../types";
import { buildLlmContext } from "./context";
import { resolveConfiguredLlmModel } from "../config/clutchConfig";
import { patchAwareSystemPrompt, renderPrompt } from "./prompts";
import { maxOutputTokensForModel } from "./requestOptions";
import {
  getLlmWorkflowTools,
  routeLlmWorkflowToolCalls,
} from "../../workflows/llmTools/toolRegistry";
import type { LlmWorkflowToolResult } from "../../workflows/llmTools/types";

export type StreamLlmResponseOptions = {
  allowedToolNames?: readonly string[];
  commandDirective?: string;
  question: string;
  contextItems: readonly ContextItem[];
  focusedContextItemId?: string | null;
  root?: string;
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
};

export type StreamLlmInteractionResult =
  | {
      kind: "text";
      responseText: string;
    }
  | ({ responseText: string } & LlmWorkflowToolResult);

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

export async function streamLlmInteraction({
  allowedToolNames,
  commandDirective,
  question,
  contextItems,
  focusedContextItemId,
  root,
  signal,
  onDelta,
}: StreamLlmResponseOptions): Promise<StreamLlmInteractionResult> {
  const { context } = await buildLlmContext({
    question: formatQuestionForCommand({ commandDirective, question }),
    contextItems,
    focusedContextItemId,
    root,
    systemPrompt: patchAwareSystemPrompt,
    tools: getLlmWorkflowTools({ allowedToolNames }),
  });
  const { apiKey, model } = resolveConfiguredLlmModel("primary");
  const eventStream = stream(model, context, {
    apiKey,
    maxTokens: maxOutputTokensForModel(model),
    signal,
  });
  let streamedText = "";

  let finalMessage: AssistantMessage;
  try {
    for await (const event of eventStream) {
      if (event.type === "text_delta") {
        streamedText += event.delta;
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
  }
  const finalText = getAssistantText(finalMessage);
  const responseText = finalText.length > 0 ? finalText : streamedText;
  const workflowResult = await routeLlmWorkflowToolCalls({
    allowedToolNames,
    root,
    toolCalls: getAssistantToolCalls(finalMessage),
  });

  if (workflowResult !== null) {
    return {
      ...workflowResult,
      responseText,
    };
  }

  return {
    kind: "text",
    responseText,
  };
}

function formatQuestionForCommand({
  commandDirective,
  question,
}: {
  commandDirective?: string;
  question: string;
}): string {
  if (commandDirective === undefined) {
    return question;
  }

  return renderPrompt("context/command-user-message.md", {
    commandDirective,
    question,
  });
}

function formatCompletionFailureOutput({
  assistantMessage,
  error,
  streamedText,
}: {
  assistantMessage?: AssistantMessage;
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

function getAssistantText(message: AssistantMessage): string {
  return message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

function getAssistantToolCalls(message: AssistantMessage): ToolCall[] {
  return message.content.filter(
    (block): block is ToolCall => block.type === "toolCall",
  );
}
