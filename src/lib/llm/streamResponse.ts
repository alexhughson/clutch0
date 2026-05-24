import {
  stream,
  type AssistantMessage,
  type TextContent,
  type ToolCall,
} from "@earendil-works/pi-ai";
import type { FilePath } from "../../types";
import { validatePatchProposal } from "../patch/patchEngine";
import type { PatchValidationResult } from "../patch/types";
import { buildLlmContext } from "./context";
import { resolveLlmModel } from "./model";
import { getPatchProposalFromToolCalls, proposePatchTool } from "./patchTool";
import { patchAwareSystemPrompt } from "./prompts";

export type StreamLlmResponseOptions = {
  question: string;
  selectedFilePaths: readonly FilePath[];
  root?: string;
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
};

export type StreamLlmInteractionResult = {
  patch: PatchValidationResult | null;
  responseText: string;
};

export async function streamLlmResponse(
  options: StreamLlmResponseOptions,
): Promise<string> {
  const result = await streamLlmInteraction(options);
  return result.responseText;
}

export async function streamLlmInteraction({
  question,
  selectedFilePaths,
  root,
  signal,
  onDelta,
}: StreamLlmResponseOptions): Promise<StreamLlmInteractionResult> {
  const { context } = await buildLlmContext({
    question,
    selectedFilePaths,
    root,
    systemPrompt: patchAwareSystemPrompt,
    tools: [proposePatchTool],
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
  const patchProposal = getPatchProposalFromToolCalls(
    getAssistantToolCalls(finalMessage),
  );

  return {
    patch:
      patchProposal === null
        ? null
        : await validatePatchProposal({ proposal: patchProposal, root }),
    responseText,
  };
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
