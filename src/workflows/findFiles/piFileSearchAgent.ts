import {
  createAgentSession,
  defineTool,
  type AgentSessionEvent,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { RelevantFileCandidate } from "../../app/appTypes";

export type RunPiFileSearchAgentOptions = {
  goal: string;
  hints: readonly string[];
  onActivity?: (line: string) => void;
  root?: string;
};

export async function runPiFileSearchAgent({
  goal,
  hints,
  onActivity,
  root = process.cwd(),
}: RunPiFileSearchAgentOptions): Promise<RelevantFileCandidate[]> {
  let submittedFiles: RelevantFileCandidate[] | null = null;

  const submitRelevantFilesTool = defineTool({
    name: "submit_relevant_files",
    label: "Submit relevant files",
    description:
      "Submit the files that are relevant to the file-search goal. Call this after using read-only search tools.",
    parameters: Type.Object({
      files: Type.Array(
        Type.Object({
          path: Type.String({
            description: "Path relative to the project root.",
          }),
          reason: Type.String({
            description: "Why this file is relevant.",
          }),
          confidence: Type.Optional(
            Type.Union([
              Type.Literal("low"),
              Type.Literal("medium"),
              Type.Literal("high"),
            ]),
          ),
        }),
      ),
    }),
    execute: async (_toolCallId, params) => {
      submittedFiles = normalizeCandidates(params.files);
      onActivity?.(`submit_relevant_files: ${submittedFiles.length} file(s)`);
      return {
        content: [
          {
            type: "text",
            text: `Submitted ${submittedFiles.length} relevant file(s).`,
          },
        ],
        details: { files: submittedFiles },
      };
    },
  });

  const { session } = await createAgentSession({
    cwd: root,
    customTools: [submitRelevantFilesTool],
    sessionManager: SessionManager.inMemory(root),
    tools: ["read", "grep", "find", "ls", "submit_relevant_files"],
  });

  const unsubscribe = session.subscribe((event) => {
    const activityLine = formatAgentActivity(event);
    if (activityLine !== null) {
      onActivity?.(activityLine);
    }
  });

  try {
    onActivity?.("pi: starting file search agent");
    await session.prompt(formatSearchPrompt({ goal, hints }));
  } finally {
    unsubscribe();
    session.dispose();
  }

  return submittedFiles ?? [];
}

function formatAgentActivity(event: AgentSessionEvent): string | null {
  switch (event.type) {
    case "agent_start":
      return "pi: agent started";
    case "agent_end":
      return event.willRetry ? "pi: agent ended; retrying" : "pi: agent done";
    case "turn_start":
      return "pi: thinking";
    case "turn_end":
      return `pi: turn complete (${event.toolResults.length} tool result(s))`;
    case "message_update":
      if (event.assistantMessageEvent.type === "text_delta") {
        return formatDelta("assistant", event.assistantMessageEvent.delta);
      }

      if (event.assistantMessageEvent.type === "thinking_delta") {
        return formatDelta("thinking", event.assistantMessageEvent.delta);
      }

      return null;
    case "tool_execution_start":
      return `tool ${event.toolName}: ${formatSnippet(event.args)}`;
    case "tool_execution_update":
      return `tool ${event.toolName} update: ${formatSnippet(
        event.partialResult,
      )}`;
    case "tool_execution_end":
      return `tool ${event.toolName}: ${event.isError ? "error" : "done"}`;
    case "auto_retry_start":
      return `pi: retry ${event.attempt}/${event.maxAttempts} after ${event.errorMessage}`;
    case "auto_retry_end":
      return event.success
        ? "pi: retry succeeded"
        : `pi: retry failed${event.finalError ? `: ${event.finalError}` : ""}`;
    case "compaction_start":
      return `pi: compaction started (${event.reason})`;
    case "compaction_end":
      return event.errorMessage === undefined
        ? `pi: compaction ended (${event.reason})`
        : `pi: compaction error: ${event.errorMessage}`;
    default:
      return null;
  }
}

function formatDelta(label: string, delta: string): string | null {
  const trimmed = delta.trim();
  if (trimmed.length === 0) {
    return null;
  }

  return `${label}: ${trimmed}`;
}

function formatSnippet(value: unknown): string {
  if (typeof value === "string") {
    return truncate(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value === null || value === undefined) {
    return "";
  }

  try {
    return truncate(JSON.stringify(value));
  } catch {
    return truncate(String(value));
  }
}

function truncate(value: string): string {
  return value.length > 160 ? `${value.slice(0, 157)}...` : value;
}

function formatSearchPrompt({
  goal,
  hints,
}: {
  goal: string;
  hints: readonly string[];
}): string {
  const hintsText = hints.length === 0 ? "No extra hints." : hints.join("\n");

  return `Find files relevant to this goal:\n${goal}\n\nHints:\n${hintsText}\n\nUse only read-only search tools. Do not edit files. When you have a concise candidate list, call submit_relevant_files with the best files. Prefer files directly relevant to implementation over generated or dependency files.`;
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
