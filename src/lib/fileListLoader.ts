import { readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

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
  const filePaths: string[] = [];

  await walkDirectory(absoluteRoot, absoluteRoot, exclusionFilters, filePaths);

  return filePaths.sort();
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

function toPosixPath(path: string): string {
  return path.split(sep).join("/");
}
