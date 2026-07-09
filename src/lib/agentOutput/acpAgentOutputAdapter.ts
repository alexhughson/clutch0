import type {
  ActiveSessionMessage,
  ContentBlock,
  PromptResponse,
  SessionUpdate,
  ToolCallContent,
  Usage,
} from "@agentclientprotocol/sdk";
import type { AgentOutputBlock, AgentOutputUpdate } from "./agentOutputTypes";

let nextAgentOutputId = 1;

export type AcpAgentOutputFormatter = {
  beginPrompt: () => void;
  format: (message: ActiveSessionMessage) => AgentOutputUpdate[];
  getLatestAssistantText: () => string | null;
};

export function createAcpAgentOutputFormatter(): AcpAgentOutputFormatter {
  let currentAssistantStreamId: string | null = null;
  let currentThinkingStreamId: string | null = null;
  let latestAssistantStreamId: string | null = null;
  let latestAssistantText: string | null = null;
  const assistantTextByStreamId = new Map<string, string>();

  const streamIdForContentChunk = ({
    messageId,
    streamKind,
  }: {
    messageId?: string | null;
    streamKind: "assistant" | "thinking";
  }) => {
    if (messageId !== undefined && messageId !== null) {
      return `acp-message:${messageId}`;
    }

    if (streamKind === "assistant") {
      currentAssistantStreamId ??= createAgentOutputId();
      return currentAssistantStreamId;
    }

    currentThinkingStreamId ??= createAgentOutputId();
    return currentThinkingStreamId;
  };

  return {
    beginPrompt() {
      currentAssistantStreamId = createAgentOutputId();
      currentThinkingStreamId = null;
      latestAssistantStreamId = currentAssistantStreamId;
      latestAssistantText = null;
      assistantTextByStreamId.clear();
    },
    format(message) {
      if (message.kind === "stop") {
        return formatStopMessage({
          latestAssistantText,
          response: message.response,
          streamId: latestAssistantStreamId,
        });
      }

      const updates = formatSessionUpdate({
        assistantTextByStreamId,
        setLatestAssistantStreamId: (streamId) => {
          latestAssistantStreamId = streamId;
        },
        streamIdForContentChunk,
        update: message.update,
      });
      latestAssistantText = getLatestAssistantText(assistantTextByStreamId);
      return updates;
    },
    getLatestAssistantText() {
      return latestAssistantText;
    },
  };
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

function formatSessionUpdate({
  assistantTextByStreamId,
  setLatestAssistantStreamId,
  streamIdForContentChunk,
  update,
}: {
  assistantTextByStreamId: Map<string, string>;
  setLatestAssistantStreamId: (streamId: string) => void;
  streamIdForContentChunk: (options: {
    messageId?: string | null;
    streamKind: "assistant" | "thinking";
  }) => string;
  update: SessionUpdate;
}): AgentOutputUpdate[] {
  switch (update.sessionUpdate) {
    case "agent_message_chunk":
      return formatTextContentChunk({
        assistantTextByStreamId,
        messageId: update.messageId,
        setLatestAssistantStreamId,
        streamId: streamIdForContentChunk({
          messageId: update.messageId,
          streamKind: "assistant",
        }),
        streamKind: "assistant",
        update,
      });
    case "agent_thought_chunk":
      return formatTextContentChunk({
        assistantTextByStreamId,
        messageId: update.messageId,
        streamId: streamIdForContentChunk({
          messageId: update.messageId,
          streamKind: "thinking",
        }),
        streamKind: "thinking",
        update,
      });
    case "tool_call":
      return [
        appendTool({
          isError: update.status === "failed",
          phase: toolPhaseFromStatus(update.status, "start"),
          summary: toolSummary(update),
          toolName: update.kind ?? "tool",
        }),
      ];
    case "tool_call_update":
      return [
        appendTool({
          isError: update.status === "failed",
          phase: toolPhaseFromStatus(update.status, "update"),
          summary: toolSummary(update),
          toolName: update.kind ?? "tool",
        }),
      ];
    case "plan":
      return [appendStatus(formatPlanStatus(update))];
    case "plan_update":
      return [appendStatus("agent plan updated")];
    case "plan_removed":
      return [appendStatus(`agent plan removed: ${update.planId}`)];
    case "current_mode_update":
      return [appendStatus(`agent mode: ${update.currentModeId}`)];
    case "session_info_update":
      return update.title === undefined || update.title === null
        ? []
        : [appendStatus(`agent session: ${truncate(update.title)}`)];
    case "usage_update":
      return [
        appendStatus(
          `agent usage: ${update.used}/${update.size} tokens${update.cost === undefined || update.cost === null ? "" : `, ${update.cost.amount} ${update.cost.currency}`}`,
        ),
      ];
    case "available_commands_update":
      return update.availableCommands.length === 0
        ? []
        : [
            appendStatus(
              `agent commands: ${update.availableCommands
                .slice(0, 3)
                .map((command) => command.name)
                .join(", ")}`,
            ),
          ];
    case "config_option_update":
    case "user_message_chunk":
      return [];
    default:
      return [];
  }
}

function formatTextContentChunk({
  assistantTextByStreamId,
  setLatestAssistantStreamId,
  streamId,
  streamKind,
  update,
}: {
  assistantTextByStreamId: Map<string, string>;
  messageId?: string | null;
  setLatestAssistantStreamId?: (streamId: string) => void;
  streamId: string;
  streamKind: "assistant" | "thinking";
  update: Extract<
    SessionUpdate,
    { sessionUpdate: "agent_message_chunk" | "agent_thought_chunk" }
  >;
}): AgentOutputUpdate[] {
  if (update.content.type !== "text") {
    return [
      appendStatus(`agent ${update.sessionUpdate}: ${update.content.type}`),
    ];
  }

  if (streamKind === "assistant") {
    assistantTextByStreamId.set(
      streamId,
      `${assistantTextByStreamId.get(streamId) ?? ""}${update.content.text}`,
    );
    setLatestAssistantStreamId?.(streamId);
  }

  return [appendStreamDelta(streamKind, update.content.text, streamId)];
}

function formatStopMessage({
  latestAssistantText,
  response,
  streamId,
}: {
  latestAssistantText: string | null;
  response: PromptResponse;
  streamId: string | null;
}): AgentOutputUpdate[] {
  return [
    ...(latestAssistantText === null || streamId === null
      ? []
      : [
          reconcileStreamText({
            id: streamId,
            streamKind: "assistant" as const,
            text: latestAssistantText,
          }),
        ]),
    appendStatus(`agent stopped: ${response.stopReason}`),
    ...formatPromptUsage(response.usage),
  ];
}

function formatPromptUsage(
  usage: Usage | null | undefined,
): AgentOutputUpdate[] {
  if (usage === undefined || usage === null) {
    return [];
  }

  return [
    appendStatus(
      `agent usage: input ${usage.inputTokens}, output ${usage.outputTokens}, total ${usage.totalTokens}`,
    ),
  ];
}

function formatPlanStatus(
  update: Extract<SessionUpdate, { sessionUpdate: "plan" }>,
) {
  const active = update.entries.find((entry) => entry.status === "in_progress");
  const next =
    active ?? update.entries.find((entry) => entry.status === "pending");
  return next === undefined
    ? `agent plan: ${update.entries.length} item(s)`
    : `agent plan: ${truncate(next.content)}`;
}

function toolPhaseFromStatus(
  status: "pending" | "in_progress" | "completed" | "failed" | null | undefined,
  fallback: "start" | "update",
): "end" | "start" | "update" {
  if (status === "completed" || status === "failed") {
    return "end";
  }
  if (status === "pending") {
    return "start";
  }
  return fallback;
}

function toolSummary(
  update: Extract<
    SessionUpdate,
    { sessionUpdate: "tool_call" | "tool_call_update" }
  >,
): string {
  const parts = [
    "title" in update && update.title !== undefined && update.title !== null
      ? update.title
      : update.toolCallId,
    update.status,
    toolPayloadSnippet(update.content),
    toolPayloadSnippet(update.rawInput),
    toolPayloadSnippet(update.rawOutput),
  ].filter(
    (part): part is string =>
      part !== undefined && part !== null && part.length > 0,
  );

  return truncate(parts.join(" | "));
}

function toolPayloadSnippet(value: unknown): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }

  if (Array.isArray(value)) {
    const text = value.map((item) => toolContentSnippet(item)).find(Boolean);
    return text === undefined ? undefined : truncate(text);
  }

  if (typeof value === "string") {
    return truncate(value);
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  try {
    return truncate(JSON.stringify(value));
  } catch {
    return truncate(String(value));
  }
}

function toolContentSnippet(content: ToolCallContent): string | undefined {
  if (content.type === "content") {
    return contentBlockSnippet(content.content);
  }
  if (content.type === "diff") {
    return `diff ${content.path}`;
  }
  if (content.type === "terminal") {
    return `terminal ${content.terminalId}`;
  }
  return undefined;
}

function contentBlockSnippet(content: ContentBlock): string | undefined {
  if (content.type === "text") {
    return content.text;
  }
  return content.type;
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

function getLatestAssistantText(
  assistantTextByStreamId: Map<string, string>,
): string | null {
  let latest: string | null = null;
  for (const text of assistantTextByStreamId.values()) {
    if (text.trim().length > 0) {
      latest = text;
    }
  }
  return latest;
}

function createAgentOutputId(): string {
  const id = `agent-output:${nextAgentOutputId}`;
  nextAgentOutputId += 1;
  return id;
}

function truncate(value: string): string {
  return value.length > 160 ? `${value.slice(0, 157)}...` : value;
}
