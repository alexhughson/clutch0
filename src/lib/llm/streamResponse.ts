import {
  stream,
  type AssistantMessage,
  type TextContent,
  type ToolCall,
} from "@earendil-works/pi-ai";
import type { ContextItem } from "../../types";
import { buildLlmContext } from "./context";
import { resolveLlmModel } from "./model";
import { patchAwareSystemPrompt } from "./prompts";
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
  const model = resolveLlmModel();
  const eventStream = stream(model, context, { signal });
  let streamedText = "";

  for await (const event of eventStream) {
    if (event.type === "text_delta") {
      streamedText += event.delta;
      onDelta?.(event.delta);
      continue;
    }

    if (event.type === "error") {
      throw new Error(
        event.error.errorMessage ??
          "The LLM request failed without an error message.",
      );
    }
  }

  const finalMessage = await eventStream.result();
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

  return `${commandDirective}\n\nUser request:\n${question}`;
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
