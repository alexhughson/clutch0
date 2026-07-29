import { spawn } from "node:child_process";
import { createAgentOutputId } from "../../agentOutput/agentOutputBlocks";
import type { AgentOutputUpdate } from "../../agentOutput/agentOutputTypes";
import { hasUsableApiKey, type ClutchAuth } from "../../config/clutchConfig";
import type { AgentSessionDriver } from "../agentSessionDriver";
import type {
  AgentHarnessDefinition,
  AgentHarnessRuntimeContext,
} from "../harnessTypes";
import { createSpawnPerTurnCliDriver } from "../spawnPerTurnCliDriver";

export const CURSOR_HARNESS_ID = "cursor";
export const CURSOR_AUTH_PROVIDER_ID = "cursor";

const DEFAULT_CURSOR_COMMAND = "cursor-agent";
const DEFAULT_CURSOR_MODEL = "composer-2.5";

type CursorHarnessConfig = {
  command: string;
  model: string;
};

type CursorHarnessSession = {
  chatId: string;
};

export const cursorHarnessDefinition: AgentHarnessDefinition = {
  id: CURSOR_HARNESS_ID,
  label: "Cursor Agent",
  authProviderIds: [CURSOR_AUTH_PROVIDER_ID],
  defaultConfig: {
    command: DEFAULT_CURSOR_COMMAND,
    model: DEFAULT_CURSOR_MODEL,
  } satisfies CursorHarnessConfig,
  configFields: [
    { key: "command", kind: "string", label: "Command", optional: true },
    { key: "model", kind: "string", label: "Model", optional: true },
  ],

  parseConfig(raw: unknown): CursorHarnessConfig {
    return normalizeCursorConfig(raw);
  },

  salvageConfig(raw: unknown): CursorHarnessConfig | undefined {
    try {
      return normalizeCursorConfig(raw);
    } catch {
      return undefined;
    }
  },

  parseSession(raw: unknown): CursorHarnessSession {
    return normalizeCursorSession(raw);
  },

  async createSession(
    ctx: AgentHarnessRuntimeContext,
    config: unknown,
  ): Promise<CursorHarnessSession> {
    const parsed = normalizeCursorConfig(config);
    const chatId = await createCursorChat({
      auth: ctx.auth,
      command: parsed.command,
      cwd: ctx.cwd,
      signal: ctx.signal,
    });
    return { chatId };
  },

  canResume(session: unknown) {
    try {
      normalizeCursorSession(session);
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
    const parsedConfig = normalizeCursorConfig(config);
    const parsedSession = normalizeCursorSession(session);
    const env = resolveCursorEnv(ctx.auth);
    let assistantStreamId: string | null = null;

    return createSpawnPerTurnCliDriver({
      buildSpawn: (message) => ({
        command: parsedConfig.command,
        cwd: ctx.cwd,
        env,
        args: buildCursorPromptArgs({
          chatId: parsedSession.chatId,
          message,
          mode: ctx.mode,
          model: parsedConfig.model,
        }),
      }),
      onOutputUpdate: ctx.onOutputUpdate,
      parseLine: (line) =>
        parseCursorStreamLine(line, {
          getAssistantStreamId: () => assistantStreamId,
          setAssistantStreamId: (id) => {
            assistantStreamId = id;
          },
        }),
      signal: ctx.signal,
    });
  },
};

function normalizeCursorConfig(raw: unknown): CursorHarnessConfig {
  if (raw === undefined || raw === null) {
    return {
      command: DEFAULT_CURSOR_COMMAND,
      model: DEFAULT_CURSOR_MODEL,
    };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Cursor harness config must be an object.");
  }
  const record = raw as Record<string, unknown>;
  const command =
    record.command === undefined || record.command === ""
      ? DEFAULT_CURSOR_COMMAND
      : assertNonEmptyString(record.command, "cursor.config.command");
  const model =
    record.model === undefined || record.model === ""
      ? DEFAULT_CURSOR_MODEL
      : assertNonEmptyString(record.model, "cursor.config.model");
  return { command, model };
}

function normalizeCursorSession(raw: unknown): CursorHarnessSession {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Cursor harness session must be an object.");
  }
  const chatId = assertNonEmptyString(
    (raw as Record<string, unknown>).chatId,
    "cursor.session.chatId",
  );
  return { chatId };
}

function buildCursorPromptArgs({
  chatId,
  message,
  mode,
  model,
}: {
  chatId: string;
  message: string;
  mode: "ask" | "edit";
  model: string;
}): string[] {
  const args = [
    "--print",
    "--output-format",
    "stream-json",
    "--stream-partial-output",
    "--model",
    model,
    "--trust",
    "--resume",
    chatId,
  ];
  if (mode === "edit") {
    args.push("--force");
  } else {
    args.push("--mode", "ask");
  }
  args.push(message);
  return args;
}

async function createCursorChat({
  auth,
  command,
  cwd,
  signal,
}: {
  auth: ClutchAuth;
  command: string;
  cwd: string;
  signal?: AbortSignal;
}): Promise<string> {
  throwIfAborted(signal);
  const child = spawn(command, ["create-chat"], {
    cwd,
    env: { ...process.env, ...resolveCursorEnv(auth) },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const onAbort = () => {
    if (!child.killed) {
      child.kill("SIGTERM");
    }
  };
  if (signal?.aborted === true) {
    onAbort();
  } else {
    signal?.addEventListener("abort", onAbort, { once: true });
  }

  try {
    const exit = await new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signalName) => {
        resolve({ code, signal: signalName });
      });
    });
    throwIfAborted(signal);
    if (exit.code !== 0) {
      throw new Error(
        `cursor-agent create-chat failed: ${stderr.trim() || `exit ${exit.code}`}`,
      );
    }
    const chatId = stdout.trim();
    if (chatId.length === 0) {
      throw new Error("cursor-agent create-chat returned an empty chat id.");
    }
    return chatId;
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

function resolveCursorEnv(auth: ClutchAuth): NodeJS.ProcessEnv {
  const credential = auth[CURSOR_AUTH_PROVIDER_ID];
  if (!hasUsableApiKey(credential)) {
    return {};
  }
  return { CURSOR_API_KEY: credential.key };
}

function parseCursorStreamLine(
  line: string,
  streamIds: {
    getAssistantStreamId: () => string | null;
    setAssistantStreamId: (id: string | null) => void;
  },
): readonly AgentOutputUpdate[] {
  let event: Record<string, unknown>;
  try {
    event = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return [];
  }

  const type = event.type;
  if (type === "assistant") {
    const text = extractCursorMessageText(event.message);
    if (text.length === 0) {
      return [];
    }
    let streamId = streamIds.getAssistantStreamId();
    if (streamId === null) {
      streamId = createAgentOutputId();
      streamIds.setAssistantStreamId(streamId);
    }
    return [
      {
        id: streamId,
        kind: "reconcile-stream",
        streamKind: "assistant",
        text,
        timestamp: Date.now(),
      },
    ];
  }

  if (type === "thinking" && event.subtype === "delta") {
    const delta = typeof event.text === "string" ? event.text : "";
    if (delta.length === 0) {
      return [];
    }
    return [
      {
        delta,
        id: createAgentOutputId(),
        kind: "append-stream-delta",
        streamKind: "thinking",
        timestamp: Date.now(),
      },
    ];
  }

  if (type === "tool_call" && event.subtype === "started") {
    const toolCall =
      event.tool_call !== null &&
      typeof event.tool_call === "object" &&
      !Array.isArray(event.tool_call)
        ? (event.tool_call as Record<string, unknown>)
        : {};
    const shellCall =
      toolCall.shellToolCall !== null &&
      typeof toolCall.shellToolCall === "object" &&
      !Array.isArray(toolCall.shellToolCall)
        ? (toolCall.shellToolCall as Record<string, unknown>)
        : {};
    const summary =
      (typeof shellCall.description === "string" && shellCall.description) ||
      (typeof toolCall.description === "string" && toolCall.description) ||
      "tool";
    return [
      {
        block: {
          id: createAgentOutputId(),
          kind: "tool",
          phase: "start",
          summary,
          timestamp: Date.now(),
          toolName: typeof toolCall.name === "string" ? toolCall.name : "tool",
        },
        kind: "append-block",
      },
    ];
  }

  if (type === "result") {
    streamIds.setAssistantStreamId(null);
    if (event.is_error === true) {
      const detail =
        event.result === undefined || event.result === null
          ? "Cursor agent reported an error."
          : String(event.result);
      throw new Error(detail);
    }
    const text =
      event.result === undefined || event.result === null
        ? ""
        : String(event.result);
    if (text.length === 0) {
      return [];
    }
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

function extractCursorMessageText(message: unknown): string {
  if (message === null || typeof message !== "object" || Array.isArray(message)) {
    return "";
  }
  const content = (message as Record<string, unknown>).content;
  if (typeof content === "string") {
    return content;
  }
  if (!Array.isArray(content)) {
    return "";
  }
  const parts: string[] = [];
  for (const part of content) {
    if (typeof part === "string") {
      parts.push(part);
      continue;
    }
    if (part === null || typeof part !== "object" || Array.isArray(part)) {
      continue;
    }
    const record = part as Record<string, unknown>;
    if (typeof record.text === "string") {
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

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new Error("Agent session was aborted.");
  }
}
