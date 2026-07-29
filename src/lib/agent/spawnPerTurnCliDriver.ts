import { spawn, type ChildProcess } from "node:child_process";
import type { AgentOutputUpdate } from "../agentOutput/agentOutputTypes";
import type { AgentSessionDriver } from "./agentSessionDriver";

export type SpawnPerTurnCliCommand = {
  args: readonly string[];
  command: string;
  cwd: string;
  env?: NodeJS.ProcessEnv;
};

export type SpawnPerTurnCliDriverOptions = {
  buildSpawn: (message: string) => SpawnPerTurnCliCommand;
  onOutputUpdate: (update: AgentOutputUpdate) => void;
  parseLine: (line: string) => readonly AgentOutputUpdate[];
  signal?: AbortSignal;
};

type ActiveTurn = {
  abort: () => void;
  child: ChildProcess;
  done: Promise<void>;
};

/**
 * Optional library helper for CLI harnesses that spawn one child per prompt.
 * Harnesses own parseLine / buildSpawn; core never knows CLI flags.
 */
export function createSpawnPerTurnCliDriver({
  buildSpawn,
  onOutputUpdate,
  parseLine,
  signal,
}: SpawnPerTurnCliDriverOptions): AgentSessionDriver {
  let disposed = false;
  let latestAssistantText: string | null = null;
  let activeTurn: ActiveTurn | null = null;

  const trackAssistantText = (update: AgentOutputUpdate) => {
    if (update.kind === "append-stream-delta" && update.streamKind === "assistant") {
      latestAssistantText = `${latestAssistantText ?? ""}${update.delta}`;
      return;
    }
    if (update.kind === "reconcile-stream" && update.streamKind === "assistant") {
      latestAssistantText = update.text;
      return;
    }
    if (
      update.kind === "append-block" &&
      update.block.kind === "stream" &&
      update.block.streamKind === "assistant"
    ) {
      latestAssistantText = update.block.text;
    }
  };

  const emit = (update: AgentOutputUpdate) => {
    trackAssistantText(update);
    onOutputUpdate(update);
  };

  return {
    async dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      const turn = activeTurn;
      activeTurn = null;
      turn?.abort();
      if (turn !== undefined && turn !== null) {
        await turn.done.catch(() => {});
      }
    },
    latestAssistantText() {
      return latestAssistantText;
    },
    async prompt(message: string) {
      if (disposed) {
        throw new Error("Agent session driver is disposed.");
      }
      if (activeTurn !== null) {
        throw new Error("Agent session already has an in-flight prompt.");
      }
      throwIfAborted(signal);

      latestAssistantText = null;
      const spawnSpec = buildSpawn(message);
      const child = spawn(spawnSpec.command, [...spawnSpec.args], {
        cwd: spawnSpec.cwd,
        env: spawnSpec.env === undefined ? process.env : { ...process.env, ...spawnSpec.env },
        stdio: ["ignore", "pipe", "pipe"],
      });

      const turnController = new AbortController();
      const onParentAbort = () => {
        turnController.abort();
        killChild(child);
      };
      if (signal?.aborted === true) {
        onParentAbort();
      } else {
        signal?.addEventListener("abort", onParentAbort, { once: true });
      }
      turnController.signal.addEventListener(
        "abort",
        () => {
          killChild(child);
        },
        { once: true },
      );

      const done = runTurn({
        child,
        emit,
        parseLine,
        signal: turnController.signal,
      }).finally(() => {
        signal?.removeEventListener("abort", onParentAbort);
        if (activeTurn?.child === child) {
          activeTurn = null;
        }
      });

      activeTurn = {
        abort: () => turnController.abort(),
        child,
        done,
      };

      try {
        await done;
      } finally {
        if (activeTurn?.child === child) {
          activeTurn = null;
        }
      }

      throwIfAborted(signal);
      throwIfAborted(turnController.signal);
    },
  };
}

async function runTurn({
  child,
  emit,
  parseLine,
  signal,
}: {
  child: ChildProcess;
  emit: (update: AgentOutputUpdate) => void;
  parseLine: (line: string) => readonly AgentOutputUpdate[];
  signal: AbortSignal;
}): Promise<void> {
  let stdout = "";
  let stderr = "";
  let parseError: Error | null = null;

  if (child.stdout === null || child.stderr === null) {
    throw new Error("Agent CLI child is missing stdout/stderr pipes.");
  }

  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  child.stdout.on("data", (chunk: string) => {
    stdout += chunk;
    const lines = stdout.split("\n");
    stdout = lines.pop() ?? "";
    for (const line of lines) {
      if (line.trim().length === 0) {
        continue;
      }
      try {
        for (const update of parseLine(line)) {
          emit(update);
        }
      } catch (error) {
        parseError =
          error instanceof Error ? error : new Error(String(error));
        killChild(child);
      }
    }
  });

  child.stderr.on("data", (chunk: string) => {
    stderr += chunk;
  });

  const exit = await waitForChildExit(child);
  if (stdout.trim().length > 0 && parseError === null) {
    try {
      for (const update of parseLine(stdout)) {
        emit(update);
      }
    } catch (error) {
      parseError = error instanceof Error ? error : new Error(String(error));
    }
  }

  if (signal.aborted) {
    throw new Error("Agent session was aborted.");
  }
  if (parseError !== null) {
    throw parseError;
  }
  if (exit.code !== 0) {
    const detail = stderr.trim() || `exit code ${exit.code ?? "null"}`;
    throw new Error(`Agent CLI failed: ${detail}`);
  }
}

function waitForChildExit(
  child: ChildProcess,
): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code, signalName) => {
      resolve({ code, signal: signalName });
    });
  });
}

function killChild(child: ChildProcess): void {
  if (child.killed) {
    return;
  }
  child.kill("SIGTERM");
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) {
    throw new Error("Agent session was aborted.");
  }
}
