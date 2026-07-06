import {
  defineTool,
  type AgentSession,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { RelevantFileCandidate } from "../../app/appTypes";
import { buildAgentContextSnapshot } from "../../lib/llm/agentContext";
import { createConfiguredPiAgentSession } from "../../lib/llm/piAgentSession";
import { renderPrompt } from "../../lib/llm/prompts";
import type { AgentOutputUpdate } from "../../lib/agentOutput/agentOutputTypes";
import type { ContextItem } from "../../types";
import {
  createAgentToolBlock,
  createPiAgentOutputFormatter,
} from "../../lib/agentOutput/piAgentOutputAdapter";

export type RunPiFileSearchAgentOptions = {
  contextItems: readonly ContextItem[];
  focusedContextItemId: string | null;
  goal: string;
  hints: readonly string[];
  onAgentOutput?: (update: AgentOutputUpdate) => void;
  root?: string;
  signal?: AbortSignal;
};

export async function runPiFileSearchAgent({
  contextItems,
  focusedContextItemId,
  goal,
  hints,
  onAgentOutput,
  root = process.cwd(),
  signal,
}: RunPiFileSearchAgentOptions): Promise<RelevantFileCandidate[]> {
  if (isAbortSignalAborted(signal)) {
    throw new Error("File search was aborted.");
  }

  let submittedFiles: RelevantFileCandidate[] | null = null;
  const context = await buildAgentContextSnapshot({
    contextItems,
    focusedContextItemId,
    root,
  });
  throwIfFileSearchAborted(signal);

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

  let session: AgentSession | null = null;
  let disposed = false;
  function disposeSession() {
    if (disposed) {
      return;
    }

    disposed = true;
    session?.dispose();
  }

  const abortHandle = createFileSearchAbortHandle(signal, disposeSession);
  const sessionCreation = createConfiguredPiAgentSession({
    cwd: root,
    customTools: [submitRelevantFilesTool],
    sessionManager: SessionManager.inMemory(root),
    tools: ["read", "grep", "find", "ls", "submit_relevant_files"],
  }).then((created) => {
    session = created.session;
    if (isAbortSignalAborted(signal)) {
      disposeSession();
      throw createFileSearchAbortError();
    }

    return created;
  });
  sessionCreation.catch(() => {});

  try {
    const created =
      abortHandle.promise === null
        ? await sessionCreation
        : await Promise.race([sessionCreation, abortHandle.promise]);
    session = created.session;

    const outputFormatter = createPiAgentOutputFormatter();
    const unsubscribe = session.subscribe((event) => {
      for (const update of outputFormatter.format(event)) {
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
      outputFormatter.beginPrompt();
      const prompt = session.prompt(formatSearchPrompt({ context, goal, hints }));
      await (abortHandle.promise === null
        ? prompt
        : Promise.race([prompt, abortHandle.promise]));
      for (const update of outputFormatter.formatFinalMessages(
        session.messages,
      )) {
        onAgentOutput?.(update);
      }
    } finally {
      unsubscribe();
      disposeSession();
    }
  } finally {
    abortHandle.dispose();
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

function createFileSearchAbortHandle(
  signal: AbortSignal | undefined,
  onAbort: () => void,
): { dispose: () => void; promise: Promise<never> | null } {
  if (signal === undefined) {
    return { dispose: () => {}, promise: null };
  }

  let rejectAbort: (error: Error) => void = () => {};
  const promise = new Promise<never>((_resolve, reject) => {
    rejectAbort = reject;
  });
  const abort = () => {
    onAbort();
    rejectAbort(createFileSearchAbortError());
  };

  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) {
    abort();
  }

  return {
    dispose: () => {
      signal.removeEventListener("abort", abort);
    },
    promise,
  };
}
