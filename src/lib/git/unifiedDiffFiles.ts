import { formatPatch, parsePatch } from "diff";

export type UnifiedDiffFile = {
  diff: string;
  path: string;
};

/** Split a unified/git multi-file diff into per-file patches for display. */
export function splitUnifiedDiffByFile(
  diffText: string,
): readonly UnifiedDiffFile[] {
  const trimmed = diffText.replace(/^\uFEFF/, "");
  if (trimmed.trim().length === 0) {
    return [];
  }

  const patches = parsePatch(trimmed);
  if (patches.length === 0) {
    return [{ diff: trimmed, path: "diff" }];
  }

  return patches.map((patch) => ({
    diff: formatPatch(patch).trimEnd(),
    path: displayPathForPatch(patch),
  }));
}

/** Cheap path listing for labels — avoids full patch parse on layout/list. */
export function listUnifiedDiffFilePaths(
  diffText: string,
): readonly string[] {
  const paths: string[] = [];
  for (const line of diffText.split("\n")) {
    if (line.startsWith("diff --git ")) {
      const path = pathFromGitDiffHeader(line);
      if (path !== null) {
        paths.push(path);
      }
      continue;
    }

    if (paths.length > 0) {
      continue;
    }

    const plusPath = pathFromPlusPlusLine(line);
    if (plusPath !== null) {
      paths.push(plusPath);
    }
  }
  return paths;
}

export function formatUnifiedDiffFilesLabel(
  diffText: string,
  {
    maxPaths = 3,
  }: {
    maxPaths?: number;
  } = {},
): string {
  const paths = listUnifiedDiffFilePaths(diffText);
  if (paths.length === 0) {
    return "no files";
  }
  if (paths.length === 1) {
    return paths[0] ?? "diff";
  }

  const shown = paths.slice(0, maxPaths);
  const suffix = paths.length > maxPaths ? ", …" : "";
  return `${paths.length} files · ${shown.join(", ")}${suffix}`;
}

function displayPathForPatch(patch: {
  isDelete?: boolean;
  newFileName?: string;
  oldFileName?: string;
}): string {
  const preferred =
    patch.isDelete === true
      ? (patch.oldFileName ?? patch.newFileName)
      : (patch.newFileName ?? patch.oldFileName);

  if (preferred === undefined || preferred.length === 0) {
    return "diff";
  }
  if (preferred === "/dev/null") {
    return stripDiffPathPrefix(patch.oldFileName ?? preferred);
  }
  return stripDiffPathPrefix(preferred);
}

function pathFromGitDiffHeader(line: string): string | null {
  const rest = line.slice("diff --git ".length).trim();
  if (rest.startsWith("a/")) {
    const mid = rest.indexOf(" b/");
    if (mid === -1) {
      return null;
    }
    return stripDiffPathPrefix(rest.slice(mid + 1));
  }

  // Quoted or unusual headers — fall back to parsePatch for that one file later.
  return null;
}

function pathFromPlusPlusLine(line: string): string | null {
  if (!line.startsWith("+++ ")) {
    return null;
  }
  const raw = line.slice(4).replace(/\t.*$/, "").trim();
  if (raw === "/dev/null" || raw.length === 0) {
    return null;
  }
  return stripDiffPathPrefix(raw);
}

function stripDiffPathPrefix(path: string): string {
  if (path.startsWith("a/") || path.startsWith("b/")) {
    return path.slice(2);
  }
  return path;
}
