import { spawn } from "node:child_process";
import {
  getClutchConfigPaths,
  resolveConfiguredAgentHarness,
  type ClutchConfigPaths,
} from "../config/clutchConfig";
import { getAgentHarness } from "./harnessRegistry";
import { registerBuiltinAgentHarnesses } from "./harnesses/registerBuiltinHarnesses";
import type { AgentOutputUpdate } from "../agentOutput/agentOutputTypes";

export type AgentHarnessSmokeOptions = {
  configPaths?: ClutchConfigPaths;
  harnessKind?: string;
  prompt?: string;
  timeoutMs?: number;
};

export async function runAgentHarnessSmokeTest({
  configPaths = getClutchConfigPaths(),
  harnessKind,
  prompt = "Reply with exactly: clutch-smoke-ok",
  timeoutMs = 120_000,
}: AgentHarnessSmokeOptions = {}): Promise<{
  assistantText: string;
  harnessKind: string;
  session: unknown;
}> {
  registerBuiltinAgentHarnesses();
  const configured = resolveConfiguredAgentHarness(configPaths);
  const kind = harnessKind ?? configured.kind;
  const definition = getAgentHarness(kind);
  const config =
    kind === configured.kind
      ? definition.parseConfig(configured.config)
      : definition.parseConfig(definition.defaultConfig);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let latestAssistant: string | null = null;

  try {
    const ctx = {
      auth: {},
      configDir: configPaths.configDir,
      cwd: process.cwd(),
      mode: "ask" as const,
      onOutputUpdate: (update: AgentOutputUpdate) => {
        if (
          update.kind === "reconcile-stream" &&
          update.streamKind === "assistant"
        ) {
          latestAssistant = update.text;
        } else if (
          update.kind === "append-stream-delta" &&
          update.streamKind === "assistant"
        ) {
          latestAssistant = `${latestAssistant ?? ""}${update.delta}`;
        }
      },
      signal: controller.signal,
    };

    const session = await definition.createSession(ctx, config);
    const driver = await definition.createSessionDriver(ctx, config, session);
    try {
      await driver.prompt(prompt);
      const assistantText = driver.latestAssistantText() ?? latestAssistant;
      if (assistantText === null || assistantText.trim().length === 0) {
        throw new Error(
          `Harness "${kind}" smoke test completed without assistant text.`,
        );
      }
      return { assistantText, harnessKind: kind, session };
    } finally {
      await driver.dispose();
    }
  } finally {
    clearTimeout(timer);
  }
}

export async function assertCommandAvailable(command: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, ["--help"], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    child.on("error", (error) => {
      reject(
        new Error(
          `Command "${command}" is not available: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    });
    child.on("close", () => resolve());
  });
}
