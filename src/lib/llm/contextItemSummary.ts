import type {
  ContextItemSummarizationInput,
  GeneratedContextItemSummary,
} from "../../types";
import { resolveConfiguredLlmRequest } from "../config/clutchConfig";
import { contextItemSummarySystemPrompt, renderPrompt } from "./prompts";
import { configuredLlmRequestOptions } from "./requestOptions";
import { completeDirectLlmResponse } from "./llmClient";
import type { LlmAssistantMessage, LlmContext, LlmTextContent } from "./types";

const MAX_SUMMARY_INPUT_CHARACTERS = 30_000;
const MAX_ONE_LINE_CHARACTERS = 100;
const MAX_DETAILS_CHARACTERS = 700;

export type ContextItemSummaryGenerator = (
  input: ContextItemSummarizationInput,
) => Promise<GeneratedContextItemSummary>;

export async function generateContextItemSummary(
  input: ContextItemSummarizationInput,
): Promise<GeneratedContextItemSummary> {
  const request = await resolveConfiguredLlmRequest("summarization");
  const context = {
    messages: [
      {
        content: renderPrompt("context-summary/user.md", {
          content: input.content.slice(0, MAX_SUMMARY_INPUT_CHARACTERS),
          label: input.label,
          type: input.type,
        }),
        role: "user" as const,
        timestamp: Date.now(),
      },
    ],
    systemPrompt: contextItemSummarySystemPrompt,
    tools: [],
  } satisfies LlmContext;
  const requestOptions = configuredLlmRequestOptions(request);
  const message = await completeDirectLlmResponse(
    request.model,
    context,
    requestOptions,
  );

  const parsed = parseSummaryResponse(getAssistantText(message));
  return {
    details: truncateSummaryText(parsed.details, MAX_DETAILS_CHARACTERS),
    generatedAt: Date.now(),
    oneLine: truncateSummaryText(parsed.oneLine, MAX_ONE_LINE_CHARACTERS),
    sourceHash: input.sourceHash,
  };
}

function parseSummaryResponse(text: string): {
  details: string;
  oneLine: string;
} {
  const parsed = JSON.parse(extractJsonObject(text)) as Partial<{
    details: unknown;
    oneLine: unknown;
  }>;

  if (
    typeof parsed.oneLine !== "string" ||
    typeof parsed.details !== "string"
  ) {
    throw new Error(
      "Summary response did not include oneLine and details strings.",
    );
  }

  return {
    details: parsed.details,
    oneLine: parsed.oneLine,
  };
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  const start = trimmed.indexOf("{");
  const end = trimmed.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Summary response did not contain a JSON object.");
  }

  return trimmed.slice(start, end + 1);
}

function truncateSummaryText(text: string, maxCharacters: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxCharacters) {
    return normalized.length > 0 ? normalized : "No summary available.";
  }

  return `${normalized.slice(0, maxCharacters - 1)}…`;
}

function getAssistantText(
  message: Pick<LlmAssistantMessage, "content">,
): string {
  return message.content
    .filter((block): block is LlmTextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}
