import { spawn } from "node:child_process";
import { access, cp, mkdtemp, realpath, readdir, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { AgentSandboxContext } from "../../types";

export type AgentSandbox = {
  baselineTree: string;
  path: string;
  root: string;
};

export type AgentSandboxDiff = {
  diffText: string;
  summary: string;
};

export async function createAgentSandbox({
  root = process.cwd(),
  signal,
}: {
  root?: string;
  signal?: AbortSignal;
} = {}): Promise<AgentSandbox> {
  throwIfSandboxAborted(signal);
  const resolvedRoot = await realpath(resolve(root));
  const gitRoot = await realpath(
    await gitOutput(["rev-parse", "--show-toplevel"], {
      cwd: resolvedRoot,
      signal,
    }),
  );
  throwIfSandboxAborted(signal);
  if (gitRoot !== resolvedRoot) {
    throw new Error(
      `Agent edit sandbox root must be the git repository root. Got ${resolvedRoot}; git root is ${gitRoot}`,
    );
  }

  const sandboxPath = await mkdtemp(join(tmpdir(), "clutch-agent-edit-"));

  try {
    throwIfSandboxAborted(signal);
    await gitOutput(["worktree", "add", "--detach", sandboxPath, "HEAD"], {
      cwd: resolvedRoot,
      signal,
    });
    throwIfSandboxAborted(signal);
    await replaceWorktreeFilesWithWorkspaceSnapshot({
      root: resolvedRoot,
      signal,
      sandboxPath,
    });
    const baselineTree = await writeSnapshotTree(sandboxPath, signal);
    return { baselineTree, path: sandboxPath, root: resolvedRoot };
  } catch (error) {
    try {
      await removeAgentSandbox({ path: sandboxPath, root: resolvedRoot });
    } catch (cleanupError) {
      if (!isSandboxAborted(signal)) {
        throw new Error(
          `Agent sandbox creation failed: ${formatErrorMessage(error)} Cleanup failed: ${formatErrorMessage(cleanupError)}`,
        );
      }
    }
    throw error;
  }
}

export async function getAgentSandboxDiff(
  sandbox: AgentSandbox,
): Promise<AgentSandboxDiff> {
  const indexPath = await mkdtemp(join(tmpdir(), "clutch-agent-edit-index-"));
  const gitIndexFile = join(indexPath, "index");

  try {
    const env = { GIT_INDEX_FILE: gitIndexFile };
    await gitOutput(["read-tree", sandbox.baselineTree], {
      cwd: sandbox.path,
      env,
    });
    await gitOutput(["add", "-A", "--", "."], { cwd: sandbox.path, env });
    const diffText = await gitOutput(
      [
        "diff",
        "--cached",
        "--binary",
        "--full-index",
        sandbox.baselineTree,
        "--",
      ],
      { cwd: sandbox.path, env, trimOutput: false },
    );
    const summary = await gitOutput(
      ["diff", "--cached", "--stat", "--summary", sandbox.baselineTree, "--"],
      { cwd: sandbox.path, env },
    );
    return { diffText, summary };
  } finally {
    await rm(indexPath, { force: true, recursive: true });
  }
}

export async function applyAgentSandboxDiff({
  diffText,
  root = process.cwd(),
}: {
  diffText: string;
  root?: string;
}) {
  await gitOutput(["apply", "--check", "--binary", "-"], {
    cwd: root,
    input: diffText,
  });
  await gitOutput(["apply", "--binary", "-"], { cwd: root, input: diffText });
}

/** Reopen a sandbox that was retained across Clutch restarts. */
export async function openAgentSandboxFromPersisted(
  sandbox: AgentSandboxContext,
): Promise<AgentSandbox> {
  try {
    await access(sandbox.path);
  } catch {
    throw new Error(
      `Agent edit sandbox path no longer exists: ${sandbox.path}`,
    );
  }
  return {
    baselineTree: sandbox.baselineTree,
    path: sandbox.path,
    root: sandbox.root,
  };
}

export async function removeAgentSandbox(sandbox: {
  path: string;
  root: string;
}) {
  let pathExists = true;
  try {
    await access(sandbox.path);
  } catch {
    pathExists = false;
  }

  if (!pathExists) {
    return;
  }

  try {
    await gitOutput(["worktree", "remove", "--force", sandbox.path], {
      cwd: sandbox.root,
    });
  } finally {
    await rm(sandbox.path, { force: true, recursive: true });
  }
}

async function replaceWorktreeFilesWithWorkspaceSnapshot({
  root,
  signal,
  sandboxPath,
}: {
  root: string;
  signal?: AbortSignal;
  sandboxPath: string;
}) {
  throwIfSandboxAborted(signal);
  for (const entry of await readdir(sandboxPath)) {
    throwIfSandboxAborted(signal);
    if (entry !== ".git") {
      await rm(join(sandboxPath, entry), { force: true, recursive: true });
    }
  }

  throwIfSandboxAborted(signal);
  await cp(root, sandboxPath, {
    errorOnExist: false,
    filter: (source) => basename(source) !== ".git",
    force: true,
    recursive: true,
  });
  throwIfSandboxAborted(signal);
}

async function writeSnapshotTree(
  sandboxPath: string,
  signal: AbortSignal | undefined,
): Promise<string> {
  const indexPath = await mkdtemp(
    join(tmpdir(), "clutch-agent-baseline-index-"),
  );
  const gitIndexFile = join(indexPath, "index");

  try {
    const env = { GIT_INDEX_FILE: gitIndexFile };
    await gitOutput(["read-tree", "HEAD"], { cwd: sandboxPath, env, signal });
    await gitOutput(["add", "-A", "--", "."], {
      cwd: sandboxPath,
      env,
      signal,
    });
    return await gitOutput(["write-tree"], { cwd: sandboxPath, env, signal });
  } finally {
    await rm(indexPath, { force: true, recursive: true });
  }
}

function gitOutput(
  args: readonly string[],
  options: {
    cwd: string;
    env?: Record<string, string>;
    input?: string;
    signal?: AbortSignal;
    trimOutput?: boolean;
  },
): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    if (isSandboxAborted(options.signal)) {
      reject(new Error("Agent sandbox operation was aborted."));
      return;
    }

    let settled = false;
    let aborted = false;
    const child = spawn("git", args, {
      cwd: options.cwd,
      detached: true,
      env: { ...process.env, ...options.env },
      stdio: [options.input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    if (child.stdout === null || child.stderr === null) {
      reject(new Error("git process did not expose output streams."));
      return;
    }
    if (options.input !== undefined && child.stdin === null) {
      reject(new Error("git process did not expose an input stream."));
      return;
    }

    function abort() {
      aborted = true;
      killProcessTree(child.pid, "SIGTERM");
    }

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", (error) => {
      finish(error);
    });
    child.on("close", (code) => {
      if (aborted) {
        finish(new Error("Agent sandbox operation was aborted."));
        return;
      }

      if (code === 0) {
        finish(null, options.trimOutput === false ? stdout : stdout.trimEnd());
        return;
      }

      finish(
        new Error(
          `git ${args.join(" ")} failed with exit code ${code}: ${stderr.trim()}`,
        ),
      );
    });

    options.signal?.addEventListener("abort", abort, { once: true });
    if (isSandboxAborted(options.signal)) {
      abort();
    }

    if (options.input !== undefined) {
      child.stdin?.end(options.input);
    }

    function finish(error: Error | null, output?: string) {
      if (settled) {
        return;
      }

      settled = true;
      options.signal?.removeEventListener("abort", abort);
      if (error === null) {
        resolveOutput(output ?? "");
      } else {
        reject(error);
      }
    }
  });
}

function throwIfSandboxAborted(signal: AbortSignal | undefined) {
  if (isSandboxAborted(signal)) {
    throw new Error("Agent sandbox operation was aborted.");
  }
}

function isSandboxAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function formatErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
        // The git process may already have exited between abort and cleanup.
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
