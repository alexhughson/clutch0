import type { RelevantFileCandidate } from "../../app/appTypes";
import type { AgentOutputUpdate } from "../../lib/agentOutput/agentOutputTypes";
import { resolveConfiguredLlmRequest } from "../../lib/config/clutchConfig";
import { buildAgentContextSnapshot } from "../../lib/llm/agentContext";
import { completeDirectLlmResponse } from "../../lib/llm/directLlmClient";
import { renderPrompt } from "../../lib/llm/prompts";
import { configuredLlmRequestOptions } from "../../lib/llm/requestOptions";
import type { LlmContext } from "../../lib/llm/types";
import type { ContextItem } from "../../types";

export type RunDirectFileSearchOptions = {
  contextItems: readonly ContextItem[];
  focusedContextItemId: string | null;
  goal: string;
  hints: readonly string[];
  onAgentOutput?: (update: AgentOutputUpdate) => void;
  root?: string;
  signal?: AbortSignal;
};

let nextFileSearchOutputId = 1;

export async function runDirectFileSearch({
  contextItems,
  focusedContextItemId,
  goal,
  hints,
  onAgentOutput,
  root = process.cwd(),
  signal,
}: RunDirectFileSearchOptions): Promise<RelevantFileCandidate[]> {
  throwIfFileSearchAborted(signal);
  onAgentOutput?.(
    appendFileSearchToolBlock({ phase: "start", summary: "file search" }),
  );

  const contextSnapshot = await buildAgentContextSnapshot({
    contextItems,
    focusedContextItemId,
    root,
  });
  throwIfFileSearchAborted(signal);

  const request = await resolveConfiguredLlmRequest("summarization");
  const llmContext: LlmContext = {
    messages: [
      {
        content: formatSearchPrompt({ context: contextSnapshot, goal, hints }),
        role: "user",
        timestamp: Date.now(),
      },
    ],
  };

  try {
    const message = await completeDirectLlmResponse(
      request.model,
      llmContext,
      configuredLlmRequestOptions({ ...request, signal }),
    );
    throwIfFileSearchAborted(signal);

    const candidates = parseDirectFileSearchResponse(getAssistantText(message));
    onAgentOutput?.(
      appendFileSearchToolBlock({
        phase: "end",
        summary: `${candidates.length} file(s)`,
      }),
    );
    return candidates;
  } catch (error) {
    if (isAbortSignalAborted(signal)) {
      throw createFileSearchAbortError();
    }

    throw error;
  }
}

export function parseDirectFileSearchResponse(
  text: string,
): RelevantFileCandidate[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.trim());
  } catch (error) {
    throw createInvalidFileSearchResponseError(
      "File search response was not valid JSON.",
      text,
    );
  }

  if (!isRecord(parsed) || !Array.isArray(parsed.files)) {
    throw createInvalidFileSearchResponseError(
      'File search response must be a JSON object with a "files" array.',
      text,
    );
  }

  const candidates = normalizeCandidates(
    parsed.files.map((file) => parseCandidate(file, text)),
  );
  if (candidates.length === 0) {
    throw createInvalidFileSearchResponseError(
      "File search response did not include any usable files.",
      text,
    );
  }

  return candidates;
}

function formatSearchPrompt({
  context,
  goal,
  hints,
}: {
  context: string;
  goal: string;
  hints: readonly string[];
}): string {
  const hintsText = hints.length === 0 ? "No extra hints." : hints.join("\n");

  return renderPrompt("agents/file-search.md", {
    context,
    goal,
    hints: hintsText,
  });
}

function parseCandidate(
  file: unknown,
  rawResponseText: string,
): {
  confidence?: "high" | "low" | "medium";
  path: string;
  reason: string;
} {
  if (!isRecord(file)) {
    throw createInvalidFileSearchResponseError(
      "Each file search candidate must be an object.",
      rawResponseText,
    );
  }

  const { confidence, path, reason } = file;
  if (typeof path !== "string" || typeof reason !== "string") {
    throw createInvalidFileSearchResponseError(
      "Each file search candidate must include path and reason strings.",
      rawResponseText,
    );
  }

  if (
    confidence !== undefined &&
    confidence !== "high" &&
    confidence !== "medium" &&
    confidence !== "low"
  ) {
    throw createInvalidFileSearchResponseError(
      'File search candidate confidence must be "low", "medium", or "high".',
      rawResponseText,
    );
  }

  return {
    confidence,
    path,
    reason,
  };
}

function normalizeCandidates(
  files: readonly {
    confidence?: "high" | "low" | "medium";
    path: string;
    reason: string;
  }[],
): RelevantFileCandidate[] {
  const seen = new Set<string>();
  const candidates: RelevantFileCandidate[] = [];

  for (const file of files) {
    const path = normalizePath(file.path);
    if (path.length === 0 || seen.has(path)) {
      continue;
    }

    seen.add(path);
    candidates.push({
      confidence: file.confidence,
      path,
      reason: file.reason.trim() || "Relevant to the search goal.",
    });
  }

  return candidates;
}

function normalizePath(path: string): string {
  return path.trim().replace(/^\.\//, "").split("\\").join("/");
}

function getAssistantText(message: {
  content: readonly { text?: string; type: string }[];
}): string {
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("\n");
}

function appendFileSearchToolBlock({
  phase,
  summary,
}: {
  phase: "end" | "start";
  summary: string;
}): AgentOutputUpdate {
  return {
    block: {
      id: `file-search:${nextFileSearchOutputId++}`,
      kind: "tool",
      phase,
      summary,
      timestamp: Date.now(),
      toolName: "LLM file search",
    },
    kind: "append-block",
  };
}

function createInvalidFileSearchResponseError(
  message: string,
  rawResponseText: string,
): Error {
  return new Error(
    `${message} Raw response prefix: ${rawPrefix(rawResponseText)}`,
  );
}

function rawPrefix(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length === 0) {
    return "<empty>";
  }

  return normalized.slice(0, 200);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAbortSignalAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function throwIfFileSearchAborted(signal: AbortSignal | undefined) {
  if (isAbortSignalAborted(signal)) {
    throw createFileSearchAbortError();
  }
}

function createFileSearchAbortError(): Error {
  return new Error("File search was aborted.");
}
