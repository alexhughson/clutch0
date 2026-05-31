import {
  createAgentSession,
  defineTool,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { RelevantFileCandidate } from "../../app/appTypes";
import { buildAgentContextSnapshot } from "../../lib/llm/agentContext";
import { renderPrompt } from "../../lib/llm/prompts";
import type { AgentOutputUpdate } from "../../lib/agentOutput/agentOutputTypes";
import type { ContextItem } from "../../types";
import {
  createAgentToolBlock,
  formatPiAgentOutputUpdate,
} from "../../lib/agentOutput/piAgentOutputAdapter";

export type RunPiFileSearchAgentOptions = {
  contextItems: readonly ContextItem[];
  focusedContextItemId: string | null;
  goal: string;
  hints: readonly string[];
  onAgentOutput?: (update: AgentOutputUpdate) => void;
  root?: string;
};

export async function runPiFileSearchAgent({
  contextItems,
  focusedContextItemId,
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
    const context = await buildAgentContextSnapshot({
      contextItems,
      focusedContextItemId,
      root,
    });
    await session.prompt(formatSearchPrompt({ context, goal, hints }));
  } finally {
    unsubscribe();
    session.dispose();
  }

  return submittedFiles ?? [];
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
