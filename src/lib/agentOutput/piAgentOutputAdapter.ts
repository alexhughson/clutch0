import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { AgentOutputBlock, AgentOutputUpdate } from "./agentOutputTypes";

let nextAgentOutputId = 1;

export type PiAgentOutputFormatter = {
  beginPrompt: () => void;
  format: (event: AgentSessionEvent) => AgentOutputUpdate[];
  formatFinalMessages: (messages: readonly AgentMessage[]) => AgentOutputUpdate[];
};

export function createPiAgentOutputFormatter(): PiAgentOutputFormatter {
  let currentAssistantStreamId: string | null = null;
  let currentThinkingStreamId: string | null = null;
  let lastAssistantStreamId: string | null = null;

  const ensureAssistantStreamId = () => {
    currentAssistantStreamId ??= createAgentOutputId();
    return currentAssistantStreamId;
  };

  const ensureThinkingStreamId = () => {
    currentThinkingStreamId ??= createAgentOutputId();
    return currentThinkingStreamId;
  };

  const resetMessageStreams = () => {
    currentAssistantStreamId = null;
    currentThinkingStreamId = null;
  };

  const completeMessageStreams = () => {
    lastAssistantStreamId = currentAssistantStreamId ?? lastAssistantStreamId;
    resetMessageStreams();
  };

  const prepareAssistantRun = () => {
    currentAssistantStreamId ??= createAgentOutputId();
    currentThinkingStreamId = null;
    lastAssistantStreamId = null;
  };

  const beginPrompt = () => {
    currentAssistantStreamId = createAgentOutputId();
    currentThinkingStreamId = null;
    lastAssistantStreamId = null;
  };

  const finalAssistantStreamId = () => {
    if (currentAssistantStreamId !== null) {
      return currentAssistantStreamId;
    }

    if (lastAssistantStreamId !== null) {
      return lastAssistantStreamId;
    }

    lastAssistantStreamId = createAgentOutputId();
    return lastAssistantStreamId;
  };

  return {
    beginPrompt,
    format(event) {
      switch (event.type) {
        case "agent_start":
          prepareAssistantRun();
          return [appendStatus("pi: agent started")];
        case "agent_end": {
          const updates = event.willRetry
            ? []
            : createFinalAssistantMessageUpdate(event.messages, {
                streamId: finalAssistantStreamId(),
              });
          completeMessageStreams();
          return [
            ...updates,
            appendStatus(
              event.willRetry ? "pi: agent ended; retrying" : "pi: agent done",
            ),
          ];
        }
        case "turn_start":
          return [appendStatus("pi: thinking")];
        case "turn_end":
          return [
            ...createAssistantMessageUpdate(event.message, {
              streamId: currentAssistantStreamId,
            }),
            appendStatus(
              `pi: turn complete (${event.toolResults.length} tool result(s))`,
            ),
          ];
        case "message_start":
          if (event.message.role === "assistant") {
            currentThinkingStreamId = null;
            ensureAssistantStreamId();
          }
          return [];
        case "message_update":
          return formatAssistantMessageEventUpdate({
            assistantStreamId: ensureAssistantStreamId,
            event: event.assistantMessageEvent,
            message: event.message,
            thinkingStreamId: ensureThinkingStreamId,
          });
        case "message_end": {
          const updates = createAssistantMessageUpdate(event.message, {
            streamId: currentAssistantStreamId,
          });
          completeMessageStreams();
          return updates;
        }
        case "tool_execution_start":
          return [
            appendTool({
              phase: "start",
              summary: agentToolPayloadToActivitySnippet(event.args),
              toolName: event.toolName,
            }),
          ];
        case "tool_execution_update":
          return [
            appendTool({
              phase: "update",
              summary: agentToolPayloadToActivitySnippet(event.partialResult),
              toolName: event.toolName,
            }),
          ];
        case "tool_execution_end":
          return [
            appendTool({
              isError: event.isError,
              phase: "end",
              summary: event.isError ? "error" : "done",
              toolName: event.toolName,
            }),
          ];
        case "auto_retry_start":
          return [
            appendStatus(
              `pi: retry ${event.attempt}/${event.maxAttempts} after ${event.errorMessage}`,
            ),
          ];
        case "auto_retry_end":
          return [
            appendStatus(
              event.success
                ? "pi: retry succeeded"
                : `pi: retry failed${event.finalError ? `: ${event.finalError}` : ""}`,
            ),
          ];
        case "compaction_start":
          return [appendStatus(`pi: compaction started (${event.reason})`)];
        case "compaction_end":
          return [
            appendStatus(
              event.errorMessage === undefined
                ? `pi: compaction ended (${event.reason})`
                : `pi: compaction error: ${event.errorMessage}`,
            ),
          ];
        default:
          return [];
      }
    },
    formatFinalMessages(messages) {
      return createFinalAssistantMessageUpdate(messages, {
        streamId: finalAssistantStreamId(),
      });
    },
  };
}

export function formatPiAgentOutputUpdate(
  event: AgentSessionEvent,
): AgentOutputUpdate | null {
  return formatPiAgentOutputUpdates(event)[0] ?? null;
}

export function formatPiAgentOutputUpdates(
  event: AgentSessionEvent,
): AgentOutputUpdate[] {
  return createPiAgentOutputFormatter().format(event);
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
  id = createAgentOutputId(),
): AgentOutputUpdate {
  return {
    delta,
    id,
    kind: "append-stream-delta",
    streamKind,
    timestamp: Date.now(),
  };
}

function reconcileStreamText({
  id,
  streamKind,
  text,
}: {
  id: string;
  streamKind: "assistant" | "thinking";
  text: string;
}): AgentOutputUpdate {
  return {
    id,
    kind: "reconcile-stream",
    reconcileStrategy: "stream-id",
    streamKind,
    text,
    timestamp: Date.now(),
  };
}

function formatAssistantMessageEventUpdate({
  assistantStreamId,
  event,
  message,
  thinkingStreamId,
}: {
  assistantStreamId: () => string;
  event: Extract<AgentSessionEvent, { type: "message_update" }>["assistantMessageEvent"];
  message: AgentMessage;
  thinkingStreamId: () => string;
}): AgentOutputUpdate[] {
  switch (event.type) {
    case "text_delta":
      return [appendStreamDelta("assistant", event.delta, assistantStreamId())];
    case "text_end":
      return createAssistantMessageUpdate(event.partial, {
        streamId: assistantStreamId(),
      });
    case "thinking_delta":
      return [appendStreamDelta("thinking", event.delta, thinkingStreamId())];
    case "thinking_end":
      return [
        reconcileStreamText({
          id: thinkingStreamId(),
          streamKind: "thinking",
          text: event.content,
        }),
      ];
    case "done":
      return createAssistantMessageUpdate(event.message, {
        streamId: assistantStreamId(),
      });
    case "error":
      return createAssistantMessageUpdate(event.error, {
        streamId: assistantStreamId(),
      });
    default:
      return createAssistantMessageUpdate(message, {
        streamId: assistantStreamId(),
      });
  }
}

function createFinalAssistantMessageUpdate(
  messages: readonly AgentMessage[],
  options: { streamId?: string | null } = {},
): AgentOutputUpdate[] {
  const message = getLatestAssistantMessage(messages);
  return message === null ? [] : createAssistantMessageUpdate(message, options);
}

export function getLatestAssistantText(
  messages: readonly AgentMessage[],
): string | null {
  const message = getLatestAssistantMessage(messages);
  return message === null ? null : getAssistantText(message);
}

function getLatestAssistantMessage(
  messages: readonly AgentMessage[],
): Extract<AgentMessage, { role: "assistant" }> | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message?.role !== "assistant") {
      continue;
    }

    if (getAssistantText(message).length > 0) {
      return message;
    }
  }

  return null;
}

function createAssistantMessageUpdate(
  message: AgentMessage | AssistantMessage,
  options: { streamId?: string | null } = {},
): AgentOutputUpdate[] {
  if (message.role !== "assistant") {
    return [];
  }

  const text = getAssistantText(message);
  if (text.trim().length === 0) {
    return [];
  }

  if (options.streamId !== undefined && options.streamId !== null) {
    return [
      reconcileStreamText({
        id: options.streamId,
        streamKind: "assistant",
        text,
      }),
    ];
  }

  return [
    {
      id: createAgentOutputId(),
      kind: "reconcile-stream",
      reconcileStrategy: "partial-text",
      streamKind: "assistant",
      text,
      timestamp: Date.now(),
    },
  ];
}

function getAssistantText(message: Extract<AgentMessage, { role: "assistant" }>) {
  return message.content
    .filter((content) => content.type === "text")
    .map((content) => content.text)
    .join("");
}

function createAgentOutputId(): string {
  const id = `agent-output:${nextAgentOutputId}`;
  nextAgentOutputId += 1;
  return id;
}

function agentToolPayloadToActivitySnippet(value: unknown): string {
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
