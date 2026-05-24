import {
  stream,
  type AssistantMessage,
  type TextContent,
} from "@earendil-works/pi-ai";
import type { FilePath } from "../../types";
import { buildLlmContext } from "./context";
import { resolveLlmModel } from "./model";

export type StreamLlmResponseOptions = {
  question: string;
  selectedFilePaths: readonly FilePath[];
  root?: string;
  signal?: AbortSignal;
  onDelta?: (delta: string) => void;
};

export async function streamLlmResponse({
  question,
  selectedFilePaths,
  root,
  signal,
  onDelta,
}: StreamLlmResponseOptions): Promise<string> {
  const { context } = await buildLlmContext({
    question,
    selectedFilePaths,
    root,
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
  return finalText.length > 0 ? finalText : streamedText;
}

function getAssistantText(message: AssistantMessage): string {
  return message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}
