import { spawn } from "node:child_process";
import { cp, mkdtemp, realpath, readdir, rm } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";

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
}: {
  root?: string;
} = {}): Promise<AgentSandbox> {
  const resolvedRoot = await realpath(resolve(root));
  const gitRoot = await realpath(
    await gitOutput(["rev-parse", "--show-toplevel"], {
      cwd: resolvedRoot,
    }),
  );
  if (gitRoot !== resolvedRoot) {
    throw new Error(
      `Agent edit sandbox root must be the git repository root. Got ${resolvedRoot}; git root is ${gitRoot}`,
    );
  }

  const sandboxPath = await mkdtemp(join(tmpdir(), "clutch-agent-edit-"));

  try {
    await gitOutput(["worktree", "add", "--detach", sandboxPath, "HEAD"], {
      cwd: resolvedRoot,
    });
    await replaceWorktreeFilesWithWorkspaceSnapshot({
      root: resolvedRoot,
      sandboxPath,
    });
    const baselineTree = await writeSnapshotTree(sandboxPath);
    return { baselineTree, path: sandboxPath, root: resolvedRoot };
  } catch (error) {
    await removeAgentSandbox({ path: sandboxPath, root: resolvedRoot });
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

export async function removeAgentSandbox(sandbox: {
  path: string;
  root: string;
}) {
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
  sandboxPath,
}: {
  root: string;
  sandboxPath: string;
}) {
  for (const entry of await readdir(sandboxPath)) {
    if (entry !== ".git") {
      await rm(join(sandboxPath, entry), { force: true, recursive: true });
    }
  }

  await cp(root, sandboxPath, {
    errorOnExist: false,
    filter: (source) => basename(source) !== ".git",
    force: true,
    recursive: true,
  });
}

async function writeSnapshotTree(sandboxPath: string): Promise<string> {
  const indexPath = await mkdtemp(
    join(tmpdir(), "clutch-agent-baseline-index-"),
  );
  const gitIndexFile = join(indexPath, "index");

  try {
    const env = { GIT_INDEX_FILE: gitIndexFile };
    await gitOutput(["read-tree", "HEAD"], { cwd: sandboxPath, env });
    await gitOutput(["add", "-A", "--", "."], { cwd: sandboxPath, env });
    return await gitOutput(["write-tree"], { cwd: sandboxPath, env });
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
    trimOutput?: boolean;
  },
): Promise<string> {
  return new Promise((resolveOutput, reject) => {
    const child = spawn("git", args, {
      cwd: options.cwd,
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

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolveOutput(options.trimOutput === false ? stdout : stdout.trimEnd());
        return;
      }

      reject(
        new Error(
          `git ${args.join(" ")} failed with exit code ${code}: ${stderr.trim()}`,
        ),
      );
    });

    if (options.input !== undefined) {
      child.stdin?.end(options.input);
    }
  });
}
