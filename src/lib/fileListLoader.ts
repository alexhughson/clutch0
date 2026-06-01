import { execFile } from "node:child_process";
import { lstat, readdir } from "node:fs/promises";
import { basename, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type FileListEntry = {
  name: string;
  path: string;
  absolutePath: string;
  isDirectory: boolean;
};

export type FileExclusionFilter = (entry: FileListEntry) => boolean;

export type LoadFileListOptions = {
  root?: string;
  exclusionFilters?: readonly FileExclusionFilter[];
};

const ignoredDirectoryNames = new Set([
  ".git",
  ".next",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

export const defaultFileExclusionFilters: FileExclusionFilter[] = [
  (entry) => entry.isDirectory && ignoredDirectoryNames.has(entry.name),
];

export async function loadFileList({
  root = process.cwd(),
  exclusionFilters = defaultFileExclusionFilters,
}: LoadFileListOptions = {}): Promise<string[]> {
  const absoluteRoot = resolve(root);
  const gitFilePaths = await loadGitFileList({
    exclusionFilters,
    root: absoluteRoot,
  });
  if (gitFilePaths !== null) {
    return gitFilePaths;
  }

  const filePaths: string[] = [];

  await walkDirectory(absoluteRoot, absoluteRoot, exclusionFilters, filePaths);

  return filePaths.sort();
}

async function loadGitFileList({
  exclusionFilters,
  root,
}: {
  exclusionFilters: readonly FileExclusionFilter[];
  root: string;
}): Promise<string[] | null> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      "git",
      [
        "-C",
        root,
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
        ".",
      ],
      { encoding: "utf8", maxBuffer: 10 * 1024 * 1024 },
    ));
  } catch {
    return null;
  }

  const seen = new Set<string>();
  const filePaths: string[] = [];
  for (const path of stdout.split("\0")) {
    if (path.length === 0 || seen.has(path)) {
      continue;
    }
    seen.add(path);

    const absolutePath = resolve(root, path);
    const stat = await lstatExistingGitPath(absolutePath);
    if (stat === null || stat.isSymbolicLink() || !stat.isFile()) {
      continue;
    }

    const entry: FileListEntry = {
      absolutePath,
      isDirectory: false,
      name: basename(path),
      path,
    };
    if (!exclusionFilters.some((filter) => filter(entry))) {
      filePaths.push(path);
    }
  }

  return filePaths.sort();
}

async function lstatExistingGitPath(absolutePath: string) {
  try {
    return await lstat(absolutePath);
  } catch (error) {
    if (isNotFoundError(error)) {
      return null;
    }

    throw error;
  }
}

async function walkDirectory(
  root: string,
  directory: string,
  exclusionFilters: readonly FileExclusionFilter[],
  filePaths: string[],
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue;
    }

    const absolutePath = resolve(directory, entry.name);
    const path = toPosixPath(relative(root, absolutePath));
    const fileListEntry: FileListEntry = {
      name: entry.name,
      path,
      absolutePath,
      isDirectory: entry.isDirectory(),
    };

    if (exclusionFilters.some((filter) => filter(fileListEntry))) {
      continue;
    }

    if (entry.isDirectory()) {
      await walkDirectory(root, absolutePath, exclusionFilters, filePaths);
    } else if (entry.isFile()) {
      filePaths.push(path);
    }
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

function toPosixPath(path: string): string {
  return path.split(sep).join("/");
}
