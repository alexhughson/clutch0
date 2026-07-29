import type { AgentOutputUpdate } from "../agentOutput/agentOutputTypes";
import type { ClutchAuth } from "../config/clutchConfig";
import type { AgentAskMode } from "../../types";
import type { AgentSessionDriver } from "./agentSessionDriver";

export type AgentHarnessRuntimeContext = {
  auth: ClutchAuth;
  configDir: string;
  cwd: string;
  mode: AgentAskMode;
  onOutputUpdate: (update: AgentOutputUpdate) => void;
  signal?: AbortSignal;
};

export type HarnessConfigField = {
  key: string;
  kind: "string";
  label: string;
  optional?: boolean;
};

export type AgentHarnessCanResumeResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * One module per backend. Core stores opaque blobs; never opens them.
 * Mirror toolRegistry: static register at import; duplicate/unknown kind fails loud.
 */
export type AgentHarnessDefinition = {
  readonly authProviderIds: readonly string[];
  readonly configFields: readonly HarnessConfigField[];
  readonly defaultConfig: unknown;
  readonly id: string;
  readonly label: string;

  canResume(
    session: unknown,
    ctx: Pick<AgentHarnessRuntimeContext, "cwd" | "mode">,
  ): AgentHarnessCanResumeResult;

  createSession(
    ctx: AgentHarnessRuntimeContext,
    config: unknown,
  ): Promise<unknown>;

  createSessionDriver(
    ctx: AgentHarnessRuntimeContext,
    config: unknown,
    session: unknown,
  ): Promise<AgentSessionDriver>;

  parseConfig(raw: unknown): unknown;
  parseSession(raw: unknown): unknown;
  salvageConfig?(raw: unknown): unknown | undefined;
};

/** settings.json — no per-backend fields in clutchConfig types */
export type ClutchAgentHarnessSettings = {
  config: unknown;
  kind: string;
};

/** Persisted on agent context item */
export type AgentHarnessPersistence = {
  kind: string;
  session: unknown;
};
