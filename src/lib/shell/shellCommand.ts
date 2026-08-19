import { spawn } from "node:child_process";

export type ShellCommandResult = {
  command: string;
  durationMs: number;
  exitCode: number | null;
  signal?: string;
  stderr: string;
  stdout: string;
  timedOut: boolean;
  truncated: boolean;
};

export type ShellCommandStreamUpdate = {
  chunk: string;
  stream: "stderr" | "stdout";
};

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_STREAM_CHARACTERS = 60_000;
const ABORT_KILL_GRACE_MS = 2_000;

export async function runShellCommand({
  command,
  onOutput,
  root = process.cwd(),
  signal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: {
  command: string;
  onOutput?: (update: ShellCommandStreamUpdate) => void;
  root?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<ShellCommandResult> {
  const startedAt = Date.now();
  if (signal?.aborted === true) {
    return {
      command,
      durationMs: Date.now() - startedAt,
      exitCode: null,
      signal: "SIGTERM",
      stderr: "",
      stdout: "",
      timedOut: false,
      truncated: false,
    };
  }

  return new Promise((resolve) => {
    let aborted = false;
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let abortKillTimer: ReturnType<typeof setTimeout> | null = null;
    let settled = false;
    const child = spawn(command, {
      cwd: root,
      detached: true,
      shell: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const timeout = setTimeout(() => {
      terminate("timeout");
    }, timeoutMs);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => {
      const update = appendStream(stdout, chunk);
      stdout = update.value;
      if (update.appendedChunk.length > 0) {
        onOutput?.({
          chunk: update.appendedChunk,
          stream: "stdout",
        });
      }
    });
    child.stderr?.on("data", (chunk: string) => {
      const update = appendStream(stderr, chunk);
      stderr = update.value;
      if (update.appendedChunk.length > 0) {
        onOutput?.({
          chunk: update.appendedChunk,
          stream: "stderr",
        });
      }
    });
    child.on("error", (error) => {
      const update = appendStream(stderr, error.message);
      stderr = update.value;
      if (update.appendedChunk.length > 0) {
        onOutput?.({
          chunk: update.appendedChunk,
          stream: "stderr",
        });
      }
    });
    child.on("close", (exitCode, exitSignal) => {
      finish(exitCode, exitSignal ?? undefined);
    });

    function abort() {
      terminate("abort");
    }

    function terminate(reason: "abort" | "timeout") {
      if (reason === "abort") {
        aborted = true;
      } else {
        timedOut = true;
      }

      if (settled) {
        return;
      }

      killProcessTree(child.pid, "SIGTERM");
      if (abortKillTimer === null) {
        abortKillTimer = setTimeout(() => {
          killProcessTree(child.pid, "SIGKILL");
        }, ABORT_KILL_GRACE_MS);
      }
    }

    function finish(exitCode: number | null, exitSignal?: NodeJS.Signals) {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      signal?.removeEventListener("abort", abort);
      if (abortKillTimer !== null) {
        clearTimeout(abortKillTimer);
        abortKillTimer = null;
      }
      const truncatedStdout = truncateStream(stdout);
      const truncatedStderr = truncateStream(stderr);

      resolve({
        command,
        durationMs: Date.now() - startedAt,
        exitCode,
        signal: exitSignal ?? (aborted ? "SIGTERM" : undefined),
        stderr: truncatedStderr.value,
        stdout: truncatedStdout.value,
        timedOut: timedOut && !aborted,
        truncated: truncatedStdout.truncated || truncatedStderr.truncated,
      });
    }

    if (signal?.aborted === true) {
      abort();
    } else {
      signal?.addEventListener("abort", abort, { once: true });
    }
  });
}

function appendStream(
  current: string,
  chunk: string,
): { appendedChunk: string; value: string } {
  if (current.length >= MAX_STREAM_CHARACTERS) {
    return {
      appendedChunk: "",
      value: current,
    };
  }

  const remainingCharacterCount = MAX_STREAM_CHARACTERS - current.length;
  const appendedChunk =
    chunk.length <= remainingCharacterCount
      ? chunk
      : chunk.slice(0, remainingCharacterCount);

  return {
    appendedChunk,
    value: `${current}${appendedChunk}`,
  };
}

function killProcessTree(pid: number | undefined, signal: NodeJS.Signals) {
  if (pid === undefined) {
    return;
  }

  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (!isNoSuchProcessError(error)) {
      try {
        process.kill(pid, signal);
      } catch {
        // The child may already have exited between abort and cleanup.
      }
    }
  }
}

function isNoSuchProcessError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ESRCH"
  );
}

function truncateStream(value: string): { truncated: boolean; value: string } {
  if (value.length <= MAX_STREAM_CHARACTERS) {
    return { truncated: false, value };
  }

  return {
    truncated: true,
    value: `${value.slice(0, MAX_STREAM_CHARACTERS)}\n[Output truncated.]`,
  };
}
