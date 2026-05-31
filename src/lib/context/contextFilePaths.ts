import { stat } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import { invariant } from "../invariant";
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
  const seen = new Set<string>();
  const validPaths: FilePath[] = [];

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

    const fileStat = await statExistingFile(path, absolutePath, index);
    invariant(
      fileStat.isFile(),
      `add_context_files.paths[${index}] must point to a regular file.`,
    );

    if (!seen.has(path)) {
      seen.add(path);
      validPaths.push(path);
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

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}
