import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runShellCommand } from "./shellCommand";

test("shell commands can be aborted without marking the run as a timeout", async () => {
  const controller = new AbortController();
  const resultPromise = runShellCommand({
    command: "sleep 10",
    signal: controller.signal,
  });

  controller.abort();
  const result = await resultPromise;

  expect(result.exitCode).toBeNull();
  expect(result.signal).toBe("SIGTERM");
  expect(result.timedOut).toBe(false);
});

test("shell commands respect already-aborted signals", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-shell-aborted-"));
  const markerPath = join(root, "spawned");
  const controller = new AbortController();
  controller.abort();

  try {
    const result = await runShellCommand({
      command: `touch ${markerPath}`,
      signal: controller.signal,
    });

    expect(result.exitCode).toBeNull();
    expect(result.signal).toBe("SIGTERM");
    expect(result.timedOut).toBe(false);
    expect(existsSync(markerPath)).toBe(false);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("shell commands stream stdout and stderr chunks", async () => {
  const updates: { chunk: string; stream: "stderr" | "stdout" }[] = [];
  const result = await runShellCommand({
    command: "printf out && printf err 1>&2",
    onOutput: (update) => {
      updates.push(update);
    },
  });

  expect(result.exitCode).toBe(0);
  expect(result.stdout).toBe("out");
  expect(result.stderr).toBe("err");
  expect(updates).toEqual([
    { chunk: "out", stream: "stdout" },
    { chunk: "err", stream: "stderr" },
  ]);
});

test("shell commands accept stdin input when piped", async () => {
  let endInput: () => void = () => {
    throw new Error("Expected shell command input handle.");
  };
  let writeInput: (input: string) => void = () => {
    throw new Error("Expected shell command input handle.");
  };
  const resultPromise = runShellCommand({
    command: "bash -lc 'read value; printf \"stdin:%s\" \"$value\"'",
    onSpawn: (inputHandle) => {
      endInput = inputHandle.endInput;
      writeInput = inputHandle.writeInput;
    },
    stdinMode: "pipe",
  });

  writeInput("hello\n");
  endInput();

  const result = await resultPromise;
  expect(result.exitCode).toBe(0);
  expect(result.stdout).toBe("stdin:hello");
});
