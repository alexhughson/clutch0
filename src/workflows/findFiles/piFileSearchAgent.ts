import {
  createAgentSession,
  defineTool,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { RelevantFileCandidate } from "../../app/appTypes";
import type { AgentOutputUpdate } from "../../lib/agentOutput/agentOutputTypes";
import {
  createAgentToolBlock,
  formatPiAgentOutputUpdate,
} from "../../lib/agentOutput/piAgentOutputAdapter";

export type RunPiFileSearchAgentOptions = {
  goal: string;
  hints: readonly string[];
  onAgentOutput?: (update: AgentOutputUpdate) => void;
  root?: string;
};

export async function runPiFileSearchAgent({
  goal,
  hints,
  onAgentOutput,
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
      onAgentOutput?.({
        block: createAgentToolBlock({
          phase: "end",
          summary: `${submittedFiles.length} file(s)`,
          toolName: "submit_relevant_files",
        }),
        kind: "append-block",
      });
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
    const update = formatPiAgentOutputUpdate(event);
    if (update !== null) {
      onAgentOutput?.(update);
    }
  });

  try {
    onAgentOutput?.({
      block: createAgentToolBlock({
        phase: "start",
        summary: "file search agent",
        toolName: "pi",
      }),
      kind: "append-block",
    });
    await session.prompt(formatSearchPrompt({ goal, hints }));
  } finally {
    unsubscribe();
    session.dispose();
  }

  return submittedFiles ?? [];
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
