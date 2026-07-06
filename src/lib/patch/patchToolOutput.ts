import type {
  PatchAffectedPaths,
  PatchFileChange,
  PatchFileChangeMap,
  PatchValidationResult,
} from "./types";

export type PatchToolOutput = {
  content: string;
  exitCode: 0 | 1;
  stderr: string;
  stdout: string;
  success: boolean;
};

export function buildSuccessfulPatchToolOutput({
  affectedPaths,
  changes,
  durationMs,
}: {
  affectedPaths?: PatchAffectedPaths;
  changes: PatchFileChangeMap;
  durationMs: number;
}): PatchToolOutput {
  const stdout =
    affectedPaths === undefined
      ? formatPatchApplyStdout(changes)
      : formatPatchAffectedPathsStdout(affectedPaths);
  return {
    content: formatExecOutputForModel({
      durationMs,
      exitCode: 0,
      output: stdout,
    }),
    exitCode: 0,
    stderr: "",
    stdout,
    success: true,
  };
}

export function formatPatchAffectedPathsStdout(
  affectedPaths: PatchAffectedPaths,
): string {
  const lines = [
    ...affectedPaths.added.map((path) => `A ${path}`),
    ...affectedPaths.modified.map((path) => `M ${path}`),
    ...affectedPaths.deleted.map((path) => `D ${path}`),
  ];
  if (lines.length === 0) {
    return "";
  }

  return `Success. Updated the following files:\n${lines.join("\n")}\n`;
}

export function buildFailedPatchToolOutput({
  errorMessage,
}: {
  errorMessage: string;
}): PatchToolOutput {
  const stderr = formatPatchVerificationFailure(errorMessage);
  return {
    content: stderr,
    exitCode: 1,
    stderr,
    stdout: "",
    success: false,
  };
}

export function buildPatchValidationFailureToolOutput({
  result,
}: {
  result: Extract<PatchValidationResult, { status: "invalid" }>;
}): PatchToolOutput {
  return buildFailedPatchToolOutput({
    errorMessage: result.errors
      .map((error) =>
        error.path.length === 0
          ? error.message
          : `${error.path}: ${error.message}`,
      )
      .join("\n"),
  });
}

export function formatPatchApplyStdout(changes: PatchFileChangeMap): string {
  const entries = Object.entries(changes);
  const lines = [
    ...formatPatchChangeLines(entries, "A"),
    ...formatPatchChangeLines(entries, "M"),
    ...formatPatchChangeLines(entries, "D"),
  ];
  if (lines.length === 0) {
    return "";
  }

  return `Success. Updated the following files:\n${lines.join("\n")}\n`;
}

function formatPatchChangeLines(
  entries: [string, PatchFileChange][],
  status: "A" | "D" | "M",
): string[] {
  return entries.flatMap(([path, change]) =>
    patchChangeStatus(change) === status
      ? [`${status} ${patchChangePath(path, change)}`]
      : [],
  );
}

function formatExecOutputForModel({
  durationMs,
  exitCode,
  output,
}: {
  durationMs: number;
  exitCode: 0 | 1;
  output: string;
}): string {
  return [
    `Exit code: ${exitCode}`,
    `Wall time: ${formatDurationSeconds(durationMs)} seconds`,
    "Output:",
    output,
  ].join("\n");
}

function formatDurationSeconds(durationMs: number): string {
  return String(Math.round((durationMs / 1000) * 10) / 10);
}

function formatPatchVerificationFailure(errorMessage: string): string {
  return errorMessage.startsWith("apply_patch verification failed:") ||
    errorMessage.startsWith("patch rejected:")
    ? errorMessage
    : `apply_patch verification failed: ${errorMessage}`;
}

function patchChangeStatus(change: PatchFileChange): "A" | "D" | "M" {
  switch (change.type) {
    case "add":
      return "A";
    case "delete":
      return "D";
    case "update":
      return "M";
  }
}

function patchChangePath(path: string, change: PatchFileChange): string {
  return change.type === "update" && change.move_path !== undefined
    ? change.move_path
    : path;
}
