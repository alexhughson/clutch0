import { exec, type ExecException } from "node:child_process";

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

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_STREAM_CHARACTERS = 60_000;

export async function runShellCommand({
  command,
  root = process.cwd(),
  timeoutMs = DEFAULT_TIMEOUT_MS,
}: {
  command: string;
  root?: string;
  timeoutMs?: number;
}): Promise<ShellCommandResult> {
  const startedAt = Date.now();

  return new Promise((resolve) => {
    exec(
      command,
      {
        cwd: root,
        maxBuffer: MAX_STREAM_CHARACTERS * 4,
        timeout: timeoutMs,
      },
      (error, stdout, stderr) => {
        const execError = error as ExecException | null;
        const truncatedStdout = truncateStream(stdout);
        const truncatedStderr = truncateStream(stderr);

        resolve({
          command,
          durationMs: Date.now() - startedAt,
          exitCode: execError?.code ?? 0,
          signal: execError?.signal ?? undefined,
          stderr: truncatedStderr.value,
          stdout: truncatedStdout.value,
          timedOut: execError?.killed === true,
          truncated: truncatedStdout.truncated || truncatedStderr.truncated,
        });
      },
    );
  });
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
