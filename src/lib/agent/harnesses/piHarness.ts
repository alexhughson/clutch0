import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { createAgentOutputId } from "../../agentOutput/agentOutputBlocks";
import type { AgentOutputUpdate } from "../../agentOutput/agentOutputTypes";
import type { AgentSessionDriver } from "../agentSessionDriver";
import type {
  AgentHarnessDefinition,
  AgentHarnessRuntimeContext,
} from "../harnessTypes";
import { createSpawnPerTurnCliDriver } from "../spawnPerTurnCliDriver";

export const PI_HARNESS_ID = "pi";

const DEFAULT_PI_COMMAND = "pi";

type PiHarnessConfig = {
  command: string;
  model?: string;
  provider?: string;
  thinking?: string;
};

type PiHarnessSession = {
  sessionDir?: string;
  sessionId: string;
};

export const piHarnessDefinition: AgentHarnessDefinition = {
  id: PI_HARNESS_ID,
  label: "Pi",
  authProviderIds: [],
  defaultConfig: {
    command: DEFAULT_PI_COMMAND,
  } satisfies PiHarnessConfig,
  configFields: [
    { key: "command", kind: "string", label: "Command", optional: true },
    { key: "provider", kind: "string", label: "Provider", optional: true },
    { key: "model", kind: "string", label: "Model", optional: true },
    { key: "thinking", kind: "string", label: "Thinking", optional: true },
  ],

  parseConfig(raw: unknown): PiHarnessConfig {
    return normalizePiConfig(raw);
  },

  salvageConfig(raw: unknown): PiHarnessConfig | undefined {
    try {
      return normalizePiConfig(raw);
    } catch {
      return undefined;
    }
  },

  parseSession(raw: unknown): PiHarnessSession {
    return normalizePiSession(raw);
  },

  async createSession(
    ctx: AgentHarnessRuntimeContext,
    _config: unknown,
  ): Promise<PiHarnessSession> {
    return {
      sessionId: randomUUID(),
      sessionDir: join(ctx.configDir, "pi-agent-sessions"),
    };
  },

  canResume(session: unknown) {
    try {
      normalizePiSession(session);
      return { ok: true as const };
    } catch (error) {
      return {
        ok: false as const,
        reason: error instanceof Error ? error.message : String(error),
      };
    }
  },

  async createSessionDriver(
    ctx: AgentHarnessRuntimeContext,
    config: unknown,
    session: unknown,
  ): Promise<AgentSessionDriver> {
    const parsedConfig = normalizePiConfig(config);
    const parsedSession = normalizePiSession(session);
    let assistantStreamId: string | null = null;
    let thinkingStreamId: string | null = null;

    return createSpawnPerTurnCliDriver({
      buildSpawn: (message) => ({
        command: parsedConfig.command,
        cwd: ctx.cwd,
        args: buildPiPromptArgs({
          config: parsedConfig,
          message,
          session: parsedSession,
        }),
      }),
      onOutputUpdate: ctx.onOutputUpdate,
      parseLine: (line) =>
        parsePiStreamLine(line, {
          getAssistantStreamId: () => assistantStreamId,
          getThinkingStreamId: () => thinkingStreamId,
          setAssistantStreamId: (id) => {
            assistantStreamId = id;
          },
          setThinkingStreamId: (id) => {
            thinkingStreamId = id;
          },
        }),
      signal: ctx.signal,
    });
  },
};

function normalizePiConfig(raw: unknown): PiHarnessConfig {
  if (raw === undefined || raw === null) {
    return {
      command: DEFAULT_PI_COMMAND,
    };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Pi harness config must be an object.");
  }
  const record = raw as Record<string, unknown>;
  const command =
    record.command === undefined || record.command === ""
      ? DEFAULT_PI_COMMAND
      : assertNonEmptyString(record.command, "pi.config.command");
  const provider =
    record.provider === undefined || record.provider === ""
      ? undefined
      : assertNonEmptyString(record.provider, "pi.config.provider");
  const model =
    record.model === undefined || record.model === ""
      ? undefined
      : assertNonEmptyString(record.model, "pi.config.model");
  const thinking =
    record.thinking === undefined || record.thinking === ""
      ? undefined
      : assertNonEmptyString(record.thinking, "pi.config.thinking");
  return {
    command,
    ...(provider === undefined ? {} : { provider }),
    ...(model === undefined ? {} : { model }),
    ...(thinking === undefined ? {} : { thinking }),
  };
}

function normalizePiSession(raw: unknown): PiHarnessSession {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Pi harness session must be an object.");
  }
  const record = raw as Record<string, unknown>;
  const sessionId = assertNonEmptyString(
    record.sessionId,
    "pi.session.sessionId",
  );
  const sessionDir =
    record.sessionDir === undefined
      ? undefined
      : assertNonEmptyString(record.sessionDir, "pi.session.sessionDir");
  return {
    sessionId,
    ...(sessionDir === undefined ? {} : { sessionDir }),
  };
}

function buildPiPromptArgs({
  config,
  message,
  session,
}: {
  config: PiHarnessConfig;
  message: string;
  session: PiHarnessSession;
}): string[] {
  const args = [
    "--print",
    "--mode",
    "json",
    "--session-id",
    session.sessionId,
  ];
  if (config.provider !== undefined) {
    args.push("--provider", config.provider);
  }
  if (config.model !== undefined) {
    args.push("--model", config.model);
  }
  if (session.sessionDir !== undefined) {
    args.push("--session-dir", session.sessionDir);
  }
  if (config.thinking !== undefined) {
    args.push("--thinking", config.thinking);
  }
  args.push(message);
  return args;
}

function parsePiStreamLine(
  line: string,
  streamIds: {
    getAssistantStreamId: () => string | null;
    getThinkingStreamId: () => string | null;
    setAssistantStreamId: (id: string | null) => void;
    setThinkingStreamId: (id: string | null) => void;
  },
): readonly AgentOutputUpdate[] {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return [];
  }

  const type = event.type;
  if (type === "message_update") {
    const assistantEvent =
      event.assistantMessageEvent !== null &&
      typeof event.assistantMessageEvent === "object" &&
      !Array.isArray(event.assistantMessageEvent)
        ? (event.assistantMessageEvent as Record<string, unknown>)
        : null;
    if (assistantEvent === null) {
      return [];
    }
    const eventType = assistantEvent.type;
    if (eventType === "text_delta" || eventType === "text_start") {
      const delta =
        typeof assistantEvent.delta === "string"
          ? assistantEvent.delta
          : typeof assistantEvent.content === "string"
            ? assistantEvent.content
            : "";
      if (delta.length === 0 && eventType === "text_start") {
        let streamId = streamIds.getAssistantStreamId();
        if (streamId === null) {
          streamId = createAgentOutputId();
          streamIds.setAssistantStreamId(streamId);
        }
        return [];
      }
      if (delta.length === 0) {
        return [];
      }
      let streamId = streamIds.getAssistantStreamId();
      if (streamId === null) {
        streamId = createAgentOutputId();
        streamIds.setAssistantStreamId(streamId);
      }
      return [
        {
          delta,
          id: streamId,
          kind: "append-stream-delta",
          streamKind: "assistant",
          timestamp: Date.now(),
        },
      ];
    }
    if (eventType === "thinking_delta" || eventType === "thinking_start") {
      const delta =
        typeof assistantEvent.delta === "string" ? assistantEvent.delta : "";
      if (delta.length === 0) {
        return [];
      }
      let streamId = streamIds.getThinkingStreamId();
      if (streamId === null) {
        streamId = createAgentOutputId();
        streamIds.setThinkingStreamId(streamId);
      }
      return [
        {
          delta,
          id: streamId,
          kind: "append-stream-delta",
          streamKind: "thinking",
          timestamp: Date.now(),
        },
      ];
    }
    if (eventType === "text_end") {
      streamIds.setAssistantStreamId(null);
      return [];
    }
    if (eventType === "thinking_end") {
      streamIds.setThinkingStreamId(null);
      return [];
    }
  }

  if (type === "tool_execution_start") {
    const toolName =
      typeof event.toolName === "string"
        ? event.toolName
        : typeof event.name === "string"
          ? event.name
          : "tool";
    const summary =
      typeof event.args === "string"
        ? event.args
        : typeof event.summary === "string"
          ? event.summary
          : toolName;
    return [
      {
        block: {
          id: createAgentOutputId(),
          kind: "tool",
          phase: "start",
          summary,
          timestamp: Date.now(),
          toolName,
        },
        kind: "append-block",
      },
    ];
  }

  if (type === "message_end") {
    const message =
      event.message !== null &&
      typeof event.message === "object" &&
      !Array.isArray(event.message)
        ? (event.message as Record<string, unknown>)
        : null;
    if (message?.role !== "assistant") {
      return [];
    }
    const text = extractPiAssistantText(message.content);
    if (text.length === 0) {
      return [];
    }
    streamIds.setAssistantStreamId(null);
    return [
      {
        id: createAgentOutputId(),
        kind: "reconcile-stream",
        streamKind: "assistant",
        text,
        timestamp: Date.now(),
      },
    ];
  }

  return [];
}

function extractPiAssistantText(content: unknown): string {
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts: string[] = [];
  for (const part of content) {
    if (part === null || typeof part !== "object" || Array.isArray(part)) {
      continue;
    }
    const record = part as Record<string, unknown>;
    if (record.type === "text" && typeof record.text === "string") {
      parts.push(record.text);
    }
  }
  return parts.join("");
}

function assertNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${label} must be a non-empty string.`);
  }
  return value.trim();
}
