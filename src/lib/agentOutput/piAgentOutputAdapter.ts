import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { AgentOutputBlock, AgentOutputUpdate } from "./agentOutputTypes";

let nextAgentOutputId = 1;

export function formatPiAgentOutputUpdate(
  event: AgentSessionEvent,
): AgentOutputUpdate | null {
  switch (event.type) {
    case "agent_start":
      return appendStatus("pi: agent started");
    case "agent_end":
      return appendStatus(
        event.willRetry ? "pi: agent ended; retrying" : "pi: agent done",
      );
    case "turn_start":
      return appendStatus("pi: thinking");
    case "turn_end":
      return appendStatus(
        `pi: turn complete (${event.toolResults.length} tool result(s))`,
      );
    case "message_update":
      if (event.assistantMessageEvent.type === "text_delta") {
        return appendStreamDelta(
          "assistant",
          event.assistantMessageEvent.delta,
        );
      }

      if (event.assistantMessageEvent.type === "thinking_delta") {
        return appendStreamDelta("thinking", event.assistantMessageEvent.delta);
      }

      return null;
    case "tool_execution_start":
      return appendTool({
        phase: "start",
        summary: formatSnippet(event.args),
        toolName: event.toolName,
      });
    case "tool_execution_update":
      return appendTool({
        phase: "update",
        summary: formatSnippet(event.partialResult),
        toolName: event.toolName,
      });
    case "tool_execution_end":
      return appendTool({
        isError: event.isError,
        phase: "end",
        summary: event.isError ? "error" : "done",
        toolName: event.toolName,
      });
    case "auto_retry_start":
      return appendStatus(
        `pi: retry ${event.attempt}/${event.maxAttempts} after ${event.errorMessage}`,
      );
    case "auto_retry_end":
      return appendStatus(
        event.success
          ? "pi: retry succeeded"
          : `pi: retry failed${event.finalError ? `: ${event.finalError}` : ""}`,
      );
    case "compaction_start":
      return appendStatus(`pi: compaction started (${event.reason})`);
    case "compaction_end":
      return appendStatus(
        event.errorMessage === undefined
          ? `pi: compaction ended (${event.reason})`
          : `pi: compaction error: ${event.errorMessage}`,
      );
    default:
      return null;
  }
}

export function createAgentStatusBlock(message: string): AgentOutputBlock {
  return {
    id: createAgentOutputId(),
    kind: "status",
    message,
    timestamp: Date.now(),
  };
}

export function createAgentToolBlock({
  isError,
  phase,
  summary,
  toolName,
}: {
  isError?: boolean;
  phase: "end" | "start" | "update";
  summary: string;
  toolName: string;
}): AgentOutputBlock {
  return {
    id: createAgentOutputId(),
    isError,
    kind: "tool",
    phase,
    summary,
    timestamp: Date.now(),
    toolName,
  };
}

function appendStatus(message: string): AgentOutputUpdate {
  return {
    block: createAgentStatusBlock(message),
    kind: "append-block",
  };
}

function appendTool(options: {
  isError?: boolean;
  phase: "end" | "start" | "update";
  summary: string;
  toolName: string;
}): AgentOutputUpdate {
  return {
    block: createAgentToolBlock(options),
    kind: "append-block",
  };
}

function appendStreamDelta(
  streamKind: "assistant" | "thinking",
  delta: string,
): AgentOutputUpdate {
  return {
    delta,
    id: createAgentOutputId(),
    kind: "append-stream-delta",
    streamKind,
    timestamp: Date.now(),
  };
}

function createAgentOutputId(): string {
  const id = `agent-output:${nextAgentOutputId}`;
  nextAgentOutputId += 1;
  return id;
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
