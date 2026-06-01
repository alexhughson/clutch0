import { stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { invariant } from "../invariant";
import { loadFileList } from "../fileListLoader";
import type { FilePath } from "../../types";

export async function validateExistingContextFilePaths({
  paths,
  root = process.cwd(),
}: {
  paths: readonly string[];
  root?: string;
}): Promise<FilePath[]> {
  invariant(paths.length > 0, "add_context_files.paths must not be empty.");

  const absoluteRoot = resolve(root);
  const candidates: Array<{
    index: number;
    path: string;
    normalizedPath: FilePath;
  }> = [];

  for (const [index, rawPath] of paths.entries()) {
    const path = rawPath.trim();
    invariant(
      path.length > 0,
      `add_context_files.paths[${index}] must be a non-empty path.`,
    );
    invariant(
      !isAbsolute(path),
      `add_context_files.paths[${index}] must be relative to the working directory.`,
    );
    invariant(
      !path.endsWith("/") && !path.endsWith("\\"),
      `add_context_files.paths[${index}] must point to a file, not a directory.`,
    );

    const absolutePath = resolve(absoluteRoot, path);
    const relativePath = relative(absoluteRoot, absolutePath);
    invariant(
      relativePath === "" ||
        (!relativePath.startsWith("..") && !isAbsolute(relativePath)),
      `add_context_files.paths[${index}] is outside the working directory.`,
    );
    const normalizedPath = toPosixPath(relativePath);

    const fileStat = await statExistingFile(path, absolutePath, index);
    invariant(
      fileStat.isFile(),
      `add_context_files.paths[${index}] must point to a regular file.`,
    );

    candidates.push({ index, normalizedPath, path });
  }

  const addableFilePaths = new Set(await loadFileList({ root: absoluteRoot }));
  const seen = new Set<string>();
  const validPaths: FilePath[] = [];

  for (const candidate of candidates) {
    invariant(
      addableFilePaths.has(candidate.normalizedPath),
      `add_context_files.paths[${candidate.index}] is ignored by .gitignore or Clutch file exclusions: ${candidate.path}`,
    );

    if (!seen.has(candidate.normalizedPath)) {
      seen.add(candidate.normalizedPath);
      validPaths.push(candidate.normalizedPath);
    }
  }

  return validPaths;
}

async function statExistingFile(
  path: string,
  absolutePath: string,
  index: number,
) {
  try {
    return await stat(absolutePath);
  } catch (error) {
    if (isNotFoundError(error)) {
      throw new Error(
        `add_context_files.paths[${index}] does not exist: ${path}`,
      );
    }

    throw new Error(
      `Could not check add_context_files.paths[${index}]: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function toPosixPath(path: string): string {
  return path.split(sep).join("/");
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
