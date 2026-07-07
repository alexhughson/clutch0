import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function readGitDiff({
  includeStaged,
  maxBuffer,
  root,
}: {
  includeStaged: boolean;
  maxBuffer: number;
  root: string;
}): Promise<string> {
  const resolvedRoot = resolve(root);
  const trackedDiff = includeStaged
    ? await readDiffFromHeadOrIndex({ maxBuffer, root: resolvedRoot })
    : await readWorkingTreeDiff({ maxBuffer, root: resolvedRoot });
  const untrackedDiff = await readUntrackedFileDiffs({
    maxBuffer,
    root: resolvedRoot,
  });

  return joinDiffs([trackedDiff, untrackedDiff]);
}

export function isNotGitRepositoryError(error: unknown): boolean {
  return [getErrorMessage(error), getErrorStderr(error)].some((text) =>
    text.toLowerCase().includes("not a git repository") ||
    text.includes("Could not access 'HEAD'"),
  );
}

async function readDiffFromHeadOrIndex({
  maxBuffer,
  root,
}: {
  maxBuffer: number;
  root: string;
}): Promise<string> {
  try {
    return await readGitStdout({
      args: ["diff", "--no-ext-diff", "HEAD", "--", "."],
      maxBuffer,
      root,
    });
  } catch (error) {
    if (!isMissingHeadError(error)) {
      throw error;
    }

    return joinDiffs([
      await readGitStdout({
        args: ["diff", "--no-ext-diff", "--cached", "--", "."],
        maxBuffer,
        root,
      }),
      await readWorkingTreeDiff({ maxBuffer, root }),
    ]);
  }
}

async function readWorkingTreeDiff({
  maxBuffer,
  root,
}: {
  maxBuffer: number;
  root: string;
}): Promise<string> {
  return await readGitStdout({
    args: ["diff", "--no-ext-diff", "--", "."],
    maxBuffer,
    root,
  });
}

async function readUntrackedFileDiffs({
  maxBuffer,
  root,
}: {
  maxBuffer: number;
  root: string;
}): Promise<string> {
  const stdout = await readGitStdout({
    args: ["ls-files", "--others", "--exclude-standard", "-z", "--", "."],
    maxBuffer,
    root,
  });
  const filePaths = stdout.split("\0").filter((path) => path.length > 0);
  const diffs = await Promise.all(
    filePaths.map((path) => readUntrackedFileDiff({ maxBuffer, path, root })),
  );

  return joinDiffs(diffs);
}

async function readUntrackedFileDiff({
  maxBuffer,
  path,
  root,
}: {
  maxBuffer: number;
  path: string;
  root: string;
}): Promise<string> {
  try {
    return await readGitStdout({
      args: ["diff", "--no-ext-diff", "--no-index", "--", "/dev/null", path],
      maxBuffer,
      root,
    });
  } catch (error) {
    if (getErrorExitCode(error) === 1) {
      return getErrorStdout(error);
    }

    throw error;
  }
}

async function readGitStdout({
  args,
  maxBuffer,
  root,
}: {
  args: readonly string[];
  maxBuffer: number;
  root: string;
}): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", root, ...args], {
    encoding: "utf8",
    maxBuffer,
  });

  return stdout;
}

function joinDiffs(diffs: readonly string[]): string {
  return diffs
    .map((diff) => diff.trimEnd())
    .filter((diff) => diff.length > 0)
    .join("\n");
}

function isMissingHeadError(error: unknown): boolean {
  return [getErrorMessage(error), getErrorStderr(error)].some(
    (text) =>
      text.includes("bad revision 'HEAD'") ||
      text.includes("ambiguous argument 'HEAD'"),
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function getErrorStderr(error: unknown): string {
  if (error === null || typeof error !== "object" || !("stderr" in error)) {
    return "";
  }

  const stderr = (error as { stderr: unknown }).stderr;
  return typeof stderr === "string" ? stderr : "";
}

function getErrorStdout(error: unknown): string {
  if (error === null || typeof error !== "object" || !("stdout" in error)) {
    return "";
  }

  const stdout = (error as { stdout: unknown }).stdout;
  return typeof stdout === "string" ? stdout : "";
}

function getErrorExitCode(error: unknown): unknown {
  if (error === null || typeof error !== "object" || !("code" in error)) {
    return undefined;
  }

  return (error as { code: unknown }).code;
}
