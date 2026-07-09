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
  let untrackedDiff: string;
  try {
    untrackedDiff = await readUntrackedFileDiffs({
      maxBuffer,
      root: resolvedRoot,
    });
  } catch (error) {
    if (isMaxBufferError(error)) {
      const untrackedPartial = getErrorStdout(error);
      throw withErrorStdout(
        error,
        joinDiffs([
          trackedDiff,
          untrackedPartial.includes("\0") ? "" : untrackedPartial,
        ]),
      );
    }

    throw error;
  }

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

    const cachedDiff = await readGitStdout({
      args: ["diff", "--no-ext-diff", "--cached", "--", "."],
      maxBuffer,
      root,
    });
    try {
      return joinDiffs([
        cachedDiff,
        await readWorkingTreeDiff({ maxBuffer, root }),
      ]);
    } catch (workingTreeError) {
      if (isMaxBufferError(workingTreeError)) {
        throw withErrorStdout(
          workingTreeError,
          joinDiffs([cachedDiff, getErrorStdout(workingTreeError)]),
        );
      }

      throw workingTreeError;
    }
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
  const diffs: string[] = [];
  for (const path of filePaths) {
    try {
      diffs.push(await readUntrackedFileDiff({ maxBuffer, path, root }));
    } catch (error) {
      if (isMaxBufferError(error)) {
        throw withErrorStdout(error, joinDiffs([...diffs, getErrorStdout(error)]));
      }

      throw error;
    }
  }

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

function isMaxBufferError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code ===
      "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
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

function withErrorStdout(error: unknown, stdout: string): unknown {
  if (error !== null && typeof error === "object") {
    (error as { stdout: string }).stdout = stdout;
    return error;
  }

  return Object.assign(new Error(String(error)), { stdout });
}

function getErrorExitCode(error: unknown): unknown {
  if (error === null || typeof error !== "object" || !("code" in error)) {
    return undefined;
  }

  return (error as { code: unknown }).code;
}
