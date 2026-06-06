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
  const { stdout } = await execFileAsync(
    "git",
    includeStaged
      ? ["-C", resolve(root), "diff", "--no-ext-diff", "HEAD", "--", "."]
      : ["-C", resolve(root), "diff", "--no-ext-diff", "--", "."],
    { maxBuffer },
  );

  return stdout;
}

export function isNotGitRepositoryError(error: unknown): boolean {
  return [getErrorMessage(error), getErrorStderr(error)].some((text) =>
    text.toLowerCase().includes("not a git repository"),
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
