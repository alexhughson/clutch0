import {
  CursorAgentError,
  type InteractionUpdate,
  type Run,
  type SDKAgent,
} from "@cursor/sdk";
import { createAgentOutputId } from "../../agentOutput/agentOutputBlocks";
import { stripAgentSandboxPathPrefix } from "../../agentOutput/agentOutputDisplay";
import type { AgentOutputUpdate } from "../../agentOutput/agentOutputTypes";
import type { AgentSessionDriver } from "../agentSessionDriver";

type SdkStreamState = {
  assistantStreamId: string | null;
  thinkingStreamId: string | null;
};

export function createCursorSdkDriver({
  agent,
  cwd,
  onOutputUpdate,
  signal,
}: {
  agent: SDKAgent;
  cwd: string;
  onOutputUpdate: (update: AgentOutputUpdate) => void;
  signal?: AbortSignal;
}): AgentSessionDriver {
  let disposed = false;
  let latestAssistantText: string | null = null;
  let activeRun: Run | null = null;

  const emit = (update: AgentOutputUpdate) => {
    if (
      update.kind === "append-stream-delta" &&
      update.streamKind === "assistant"
    ) {
      latestAssistantText = `${latestAssistantText ?? ""}${update.delta}`;
    } else if (
      update.kind === "reconcile-stream" &&
      update.streamKind === "assistant"
    ) {
      latestAssistantText = update.text;
    }
    onOutputUpdate(update);
  };

  return {
    async dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      const run = activeRun;
      activeRun = null;
      if (run !== null && run.supports("cancel")) {
        await run.cancel().catch(() => {});
      }
      await agent[Symbol.asyncDispose]().catch(() => {});
    },
    latestAssistantText() {
      return latestAssistantText;
    },
    async prompt(message: string) {
      if (disposed) {
        throw new Error("Agent session driver is disposed.");
      }
      if (activeRun !== null) {
        throw new Error("Agent session already has an in-flight prompt.");
      }
      throwIfAborted(signal);

      latestAssistantText = null;
      const streamState = createSdkStreamState();

      let run: Run;
      try {
        run = await agent.send(message, {
          local: { force: true },
          onDelta: ({ update }) => {
            for (const mapped of mapDeltaToAgentOutputUpdates(
              update,
              streamState,
              cwd,
            )) {
              emit(mapped);
            }
          },
        });
      } catch (error) {
        if (error instanceof CursorAgentError) {
          throw new Error(`Cursor agent startup failed: ${error.message}`);
        }
        throw error;
      }

      activeRun = run;
      const onAbort = () => {
        if (run.supports("cancel")) {
          void run.cancel().catch(() => {});
        }
      };
      if (signal?.aborted === true) {
        onAbort();
      } else {
        signal?.addEventListener("abort", onAbort, { once: true });
      }

      try {
        let streamError: unknown = null;
        // Drain normalized stream events so the run can complete; text/tools
        // come from onDelta only.
        const streamTask = (async () => {
          try {
            for await (const _event of run.stream()) {
              // intentionally ignored
            }
          } catch (error) {
            streamError = error;
          }
        })();

        const result = await run.wait();
        await streamTask;

        throwIfAborted(signal);
        if (result.status === "cancelled") {
          throw new Error("Agent session was aborted.");
        }
        if (result.status === "error") {
          throw new Error(
            result.error?.message ?? "Cursor agent run failed.",
          );
        }
        if (streamError !== null) {
          throw streamError;
        }
        const finalText = result.result?.trim() ?? "";
        if (finalText.length > 0 && latestAssistantText !== finalText) {
          latestAssistantText = finalText;
          emit({
            id: ensureStreamId(streamState, "assistant"),
            kind: "reconcile-stream",
            streamKind: "assistant",
            text: finalText,
            timestamp: Date.now(),
          });
        }
      } finally {
        signal?.removeEventListener("abort", onAbort);
        if (activeRun === run) {
          activeRun = null;
        }
      }
    },
  };
}

function createSdkStreamState(): SdkStreamState {
  return {
    assistantStreamId: null,
    thinkingStreamId: null,
  };
}

/**
 * Token-level updates from `send({ onDelta })`.
 * `run.stream()` is normalized step events — do not treat those as deltas.
 */
export function mapDeltaToAgentOutputUpdates(
  update: InteractionUpdate,
  streamState: SdkStreamState,
  cwd?: string,
): readonly AgentOutputUpdate[] {
  if (update.type === "text-delta") {
    if (update.text.length === 0) {
      return [];
    }
    return [
      {
        delta: update.text,
        id: ensureStreamId(streamState, "assistant"),
        kind: "append-stream-delta",
        streamKind: "assistant",
        timestamp: Date.now(),
      },
    ];
  }

  if (update.type === "thinking-delta") {
    if (update.text.length === 0) {
      return [];
    }
    return [
      {
        delta: update.text,
        id: ensureStreamId(streamState, "thinking"),
        kind: "append-stream-delta",
        streamKind: "thinking",
        timestamp: Date.now(),
      },
    ];
  }

  if (update.type === "thinking-completed") {
    streamState.thinkingStreamId = null;
    return [];
  }

  if (update.type === "tool-call-started") {
    streamState.assistantStreamId = null;
    streamState.thinkingStreamId = null;
    const toolName = update.toolCall.type;
    const args =
      "args" in update.toolCall ? update.toolCall.args : undefined;
    return [
      {
        block: {
          id: createAgentOutputId(),
          kind: "tool",
          phase: "start",
          summary: summarizeToolPayload(args, cwd) || toolName,
          timestamp: Date.now(),
          toolName,
        },
        kind: "append-block",
      },
    ];
  }

  if (update.type === "tool-call-completed") {
    streamState.assistantStreamId = null;
    streamState.thinkingStreamId = null;
    const toolName = update.toolCall.type;
    const args =
      "args" in update.toolCall ? update.toolCall.args : undefined;
    const result =
      "result" in update.toolCall ? update.toolCall.result : undefined;
    const isError =
      result !== undefined &&
      typeof result === "object" &&
      result !== null &&
      "status" in result &&
      result.status === "error";
    return [
      {
        block: {
          id: createAgentOutputId(),
          isError,
          kind: "tool",
          phase: "end",
          // Prefer the call target over raw result JSON — keep the log tight.
          summary: summarizeToolPayload(args, cwd) || toolName,
          timestamp: Date.now(),
          toolName,
        },
        kind: "append-block",
      },
    ];
  }

  return [];
}

function ensureStreamId(
  streamState: SdkStreamState,
  kind: "assistant" | "thinking",
): string {
  if (kind === "assistant") {
    if (streamState.assistantStreamId === null) {
      streamState.assistantStreamId = createAgentOutputId();
    }
    return streamState.assistantStreamId;
  }
  if (streamState.thinkingStreamId === null) {
    streamState.thinkingStreamId = createAgentOutputId();
  }
  return streamState.thinkingStreamId;
}

function summarizeToolPayload(value: unknown, cwd?: string): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return collapseWhitespace(stripAgentSandboxPathPrefix(value, cwd));
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return collapseWhitespace(
      stripAgentSandboxPathPrefix(safeJson(value), cwd),
    );
  }

  const record = value as Record<string, unknown>;
  for (const key of [
    "command",
    "cmd",
    "path",
    "file_path",
    "filePath",
    "target_file",
    "query",
    "pattern",
    "url",
  ]) {
    const candidate = record[key];
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return collapseWhitespace(stripAgentSandboxPathPrefix(candidate, cwd));
    }
  }

  return collapseWhitespace(
    stripAgentSandboxPathPrefix(safeJson(value), cwd),
  );
}

function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 160);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new Error("Agent session was aborted.");
  }
}
