import { Agent, Cursor } from "@cursor/sdk";
import type { ClutchAuth } from "../../config/clutchConfig";
import type { AgentSessionDriver } from "../agentSessionDriver";
import type {
  AgentHarnessDefinition,
  AgentHarnessRuntimeContext,
} from "../harnessTypes";
import { createCursorSdkDriver } from "./cursorSdkDriver";

export const CURSOR_HARNESS_ID = "cursor";
const CURSOR_AUTH_PROVIDER_ID = "cursor";

const DEFAULT_CURSOR_MODEL = "composer-2.5";
let sdkConfigured = false;

type CursorHarnessConfig = {
  model: string;
};

type CursorHarnessSession = {
  agentId: string;
};

export const cursorHarnessDefinition: AgentHarnessDefinition = {
  id: CURSOR_HARNESS_ID,
  label: "Cursor Agent",
  authProviderIds: [CURSOR_AUTH_PROVIDER_ID],
  defaultConfig: {
    model: DEFAULT_CURSOR_MODEL,
  } satisfies CursorHarnessConfig,
  configFields: [
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
    const apiKey = resolveCursorApiKey(ctx.auth);
    ensureCursorSdkConfigured();
    throwIfAborted(ctx.signal);

    const agent = await Agent.create({
      apiKey,
      model: { id: parsed.model },
      local: { cwd: ctx.cwd, settingSources: [] },
    });
    const agentId = agent.agentId;
    await agent[Symbol.asyncDispose]();
    throwIfAborted(ctx.signal);
    return { agentId };
  },

  canResume(session: unknown, ctx: Pick<AgentHarnessRuntimeContext, "cwd">) {
    try {
      normalizeCursorSession(session);
      if (ctx.cwd.trim().length === 0) {
        return {
          ok: false as const,
          reason: "Agent sandbox path is missing.",
        };
      }
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
    const apiKey = resolveCursorApiKey(ctx.auth);
    ensureCursorSdkConfigured();

    const agent = await Agent.resume(parsedSession.agentId, {
      apiKey,
      model: { id: parsedConfig.model },
      local: { cwd: ctx.cwd, settingSources: [] },
    });

    return createCursorSdkDriver({
      agent,
      cwd: ctx.cwd,
      onOutputUpdate: ctx.onOutputUpdate,
      signal: ctx.signal,
    });
  },
};

function ensureCursorSdkConfigured(): void {
  if (sdkConfigured) {
    return;
  }
  Cursor.configure({ local: { useHttp1ForAgent: true } });
  sdkConfigured = true;
}

function normalizeCursorConfig(raw: unknown): CursorHarnessConfig {
  if (raw === undefined || raw === null) {
    return { model: DEFAULT_CURSOR_MODEL };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Cursor harness config must be an object.");
  }
  const record = raw as Record<string, unknown>;
  const model =
    record.model === undefined || record.model === ""
      ? DEFAULT_CURSOR_MODEL
      : assertNonEmptyString(record.model, "cursor.config.model");
  return { model };
}

function normalizeCursorSession(raw: unknown): CursorHarnessSession {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Cursor harness session must be an object.");
  }
  const agentId = assertNonEmptyString(
    (raw as Record<string, unknown>).agentId,
    "cursor.session.agentId",
  );
  return { agentId };
}

function resolveCursorApiKey(auth: ClutchAuth): string {
  const credential = auth[CURSOR_AUTH_PROVIDER_ID];
  if (
    credential?.type !== "api_key" ||
    credential.key.trim().length === 0
  ) {
    throw new Error(
      'Missing Cursor API key. Configure it under /config → agent harness → "Cursor API key".',
    );
  }
  return credential.key.trim();
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
