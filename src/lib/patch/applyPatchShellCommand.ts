import { isAbsolute, posix } from "node:path";
import { parseCodexPatch } from "./patchEngine";

const APPLY_PATCH_HEREDOC_PATTERN = new RegExp(
  String.raw`^(?:(?:cd\s+(?<cwd>(?:'[^']+'|"[^"]+"|[^\s&;|]+))\s+&&\s+)?(?:apply_patch|applypatch)\s+<<['"]?(?<marker>[A-Za-z_][A-Za-z0-9_]*)['"]?\n(?<patch>[\s\S]*)\n\k<marker>\s*)$`,
);

const FILE_OPERATION_PREFIXES = [
  "*** Add File: ",
  "*** Delete File: ",
  "*** Update File: ",
  "*** Move to: ",
] as const;

export function parseApplyPatchShellCommand(command: string): string | null {
  const directPatch = parseDirectApplyPatchCommand(command.trim());
  if (directPatch !== null) {
    return directPatch;
  }

  const match = APPLY_PATCH_HEREDOC_PATTERN.exec(extractShellScript(command));
  if (match === null) {
    return null;
  }

  const patch = match.groups?.patch;
  if (patch === undefined) {
    return null;
  }

  const cwd = match.groups?.cwd;
  if (cwd === undefined) {
    return patch;
  }

  return prefixPatchPaths({ cwd: parseCdPath(cwd), patch });
}

export function isImplicitApplyPatchShellCommand(command: string): boolean {
  return parseCodexPatch(extractShellScript(command)).status === "valid";
}

function parseDirectApplyPatchCommand(command: string): string | null {
  const words = parseShellWords(command);
  if (
    words?.length === 2 &&
    (words[0] === "apply_patch" || words[0] === "applypatch")
  ) {
    return words[1]!;
  }

  return null;
}

function extractShellScript(command: string): string {
  const trimmed = command.trim();
  const words = parseShellWords(trimmed);
  if (words === null) {
    return trimmed;
  }

  if (
    words.length === 3 &&
    isUnixShell(words[0]!) &&
    isUnixShellFlag(words[1]!)
  ) {
    return words[2]!;
  }

  if (
    words.length === 4 &&
    isPowerShell(words[0]!) &&
    words[1]!.toLowerCase() === "-noprofile" &&
    words[2]!.toLowerCase() === "-command"
  ) {
    return words[3]!;
  }

  if (
    words.length === 3 &&
    isPowerShell(words[0]!) &&
    words[1]!.toLowerCase() === "-command"
  ) {
    return words[2]!;
  }

  if (
    words.length === 3 &&
    shellBasename(words[0]!) === "cmd" &&
    words[1]!.toLowerCase() === "/c"
  ) {
    return words[2]!;
  }

  return trimmed;
}

function parseShellWords(command: string): string[] | null {
  const words: string[] = [];
  let current = "";
  let quote: "'" | '"' | null = null;
  let index = 0;

  while (index < command.length) {
    const char = command[index]!;
    if (quote !== null) {
      if (char === quote) {
        quote = null;
        index += 1;
        continue;
      }
      if (quote === '"' && char === "\\" && index + 1 < command.length) {
        current += command[index + 1]!;
        index += 2;
        continue;
      }
      current += char;
      index += 1;
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      index += 1;
      continue;
    }
    if (char === "\\" && index + 1 < command.length) {
      current += command[index + 1]!;
      index += 2;
      continue;
    }
    if (/\s/.test(char)) {
      if (current.length > 0) {
        words.push(current);
        current = "";
      }
      index += 1;
      continue;
    }

    current += char;
    index += 1;
  }

  if (quote !== null) {
    return null;
  }
  if (current.length > 0) {
    words.push(current);
  }

  return words;
}

function isUnixShell(command: string): boolean {
  return ["bash", "sh", "zsh"].includes(shellBasename(command));
}

function isUnixShellFlag(flag: string): boolean {
  return flag === "-c" || flag === "-lc";
}

function isPowerShell(command: string): boolean {
  return ["powershell", "pwsh"].includes(shellBasename(command));
}

function shellBasename(command: string): string {
  // split(/[\\/]/) always returns an array of length >= 1, so pop() is never undefined.
  const basename = command.split(/[\\/]/).pop()!.toLowerCase();
  const extensionIndex = basename.lastIndexOf(".");
  return extensionIndex > 0 ? basename.slice(0, extensionIndex) : basename;
}

function parseCdPath(rawPath: string): string {
  const path =
    (rawPath.startsWith("'") && rawPath.endsWith("'")) ||
    (rawPath.startsWith('"') && rawPath.endsWith('"'))
      ? rawPath.slice(1, -1)
      : rawPath;
  if (
    path.length === 0 ||
    isAbsolute(path) ||
    path.split(/[\\/]+/).includes("..")
  ) {
    throw new Error(
      "apply_patch shell interception only supports relative cd paths.",
    );
  }

  return normalizeRelativePath(path);
}

function prefixPatchPaths({
  cwd,
  patch,
}: {
  cwd: string;
  patch: string;
}): string {
  return patch
    .split("\n")
    .map((line) => {
      const prefix = FILE_OPERATION_PREFIXES.find((candidate) =>
        line.startsWith(candidate),
      );
      if (prefix === undefined) {
        return line;
      }

      const path = line.slice(prefix.length);
      return `${prefix}${prefixRelativePatchPath({ cwd, path })}`;
    })
    .join("\n");
}

function prefixRelativePatchPath({
  cwd,
  path,
}: {
  cwd: string;
  path: string;
}): string {
  return isPatchAbsolutePath(path)
    ? path
    : normalizeRelativePath(posix.join(cwd, path));
}

function isPatchAbsolutePath(path: string): boolean {
  return isAbsolute(path) || /^[A-Za-z]:[\\/]/.test(path);
}

function normalizeRelativePath(path: string): string {
  const normalized = posix.normalize(path.replace(/\\/g, "/"));
  return normalized === "." ? "" : normalized.replace(/^\.\//, "");
}
