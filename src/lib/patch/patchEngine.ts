import { readFile, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { createTwoFilesPatch } from "diff";
import type {
  PatchAffectedPaths,
  PatchFileChangeMap,
  PatchProgressFile,
  PatchProgressState,
  PatchProposal,
  PatchValidationError,
  PatchValidationResult,
} from "./types";

export type ParsedPatch = {
  environmentId?: string;
  operations: PatchOperation[];
};

type PatchOperation =
  | {
      content: string;
      path: string;
      type: "add";
    }
  | {
      path: string;
      type: "delete";
    }
  | {
      chunks: UpdateChunk[];
      movePath?: string;
      path: string;
      type: "update";
    };

type UpdateChunk = {
  context?: string;
  isEndOfFile: boolean;
  newLines: string[];
  oldLines: string[];
};

const ENVIRONMENT_ID_MARKER = "*** Environment ID:";

export type ValidatedPatch = {
  diffText: string;
  files: ValidatedPatchFile[];
  parsed: ParsedPatch;
  proposal: PatchProposal;
};

type ValidatedPatchFile = {
  absolutePath: string;
  newDiffPath: string;
  nextContent: string | null;
  oldDiffPath: string;
  originalExisted: boolean;
  path: string;
  previousContent: string;
  writeAbsolutePath?: string;
  writePath?: string;
};

type MutableFileState = {
  absolutePath: string;
  content: string;
  existed: boolean;
  originalAbsolutePath: string;
  originalExisted: boolean;
  originalPath: string;
  path: string;
  previousContent: string;
};

type ParseResult =
  | { patch: ParsedPatch; status: "valid" }
  | { error: string; path?: string; status: "invalid" };

type Replacement = {
  newLines: string[];
  oldLength: number;
  startIndex: number;
};

export function patchProposalFromLegacyEdits({
  edits,
  summary,
}: {
  edits: readonly { newText: string; oldText: string; path: string }[];
  summary: string;
}): PatchProposal {
  const patchLines = ["*** Begin Patch"];
  for (const edit of edits) {
    if (edit.oldText.length === 0) {
      patchLines.push(`*** Add File: ${edit.path}`);
      for (const line of splitTextForPatch(edit.newText)) {
        patchLines.push(`+${line}`);
      }
      continue;
    }

    patchLines.push(`*** Update File: ${edit.path}`);
    patchLines.push("@@");
    for (const line of splitTextForPatch(edit.oldText)) {
      patchLines.push(`-${line}`);
    }
    for (const line of splitTextForPatch(edit.newText)) {
      patchLines.push(`+${line}`);
    }
  }
  patchLines.push("*** End Patch");

  return {
    patch: patchLines.join("\n"),
    summary,
  };
}

export async function validatePatchProposal({
  proposal,
  root = process.cwd(),
}: {
  proposal: PatchProposal;
  root?: string;
}): Promise<PatchValidationResult> {
  const validation = await validatePatch({ proposal, root });

  if (validation.status === "invalid") {
    return validation;
  }

  return {
    diffText: validation.patch.diffText,
    proposal,
    status: "valid",
  };
}

export async function applyPatchProposal({
  proposal,
  root = process.cwd(),
}: {
  proposal: PatchProposal;
  root?: string;
}): Promise<PatchValidationResult> {
  const validation = await validatePatch({ proposal, root });

  if (validation.status === "invalid") {
    return validation;
  }

  for (const file of validation.patch.files) {
    if (file.nextContent === null) {
      await rm(file.absolutePath);
      if (
        file.writeAbsolutePath !== undefined &&
        file.writeAbsolutePath !== file.absolutePath
      ) {
        await rm(file.writeAbsolutePath, { force: true });
      }
      continue;
    }

    const writePath = file.writeAbsolutePath ?? file.absolutePath;
    await mkdir(dirname(writePath), { recursive: true });
    await writeFile(writePath, file.nextContent, "utf8");
    if (
      file.writeAbsolutePath !== undefined &&
      file.writeAbsolutePath !== file.absolutePath
    ) {
      await rm(file.absolutePath);
    }
  }

  return {
    diffText: validation.patch.diffText,
    proposal,
    status: "valid",
  };
}

export function getPatchProposalPaths(proposal: PatchProposal): string[] {
  const parsed = parseCodexPatch(proposal.patch);
  if (parsed.status === "invalid") {
    return [];
  }

  const paths = new Set<string>();
  for (const operation of parsed.patch.operations) {
    paths.add(operation.path);
    if (operation.type === "update" && operation.movePath !== undefined) {
      paths.add(operation.movePath);
    }
  }

  return [...paths];
}

export function getPatchProposalFileChanges(
  proposal: PatchProposal,
): PatchFileChangeMap {
  const parsed = parseCodexPatch(proposal.patch);
  if (parsed.status === "invalid") {
    return {};
  }

  const changes: PatchFileChangeMap = {};
  for (const operation of parsed.patch.operations) {
    switch (operation.type) {
      case "add":
        changes[operation.path] = {
          content: operation.content,
          type: "add",
        };
        break;
      case "delete":
        changes[operation.path] = {
          content: "",
          type: "delete",
        };
        break;
      case "update":
        changes[operation.path] = {
          ...(operation.movePath === undefined
            ? {}
            : { move_path: operation.movePath }),
          type: "update",
          unified_diff: formatUpdateChunksForProgress(operation.chunks),
        };
        break;
    }
  }

  return changes;
}

export function getPatchProposalAffectedPaths(
  proposal: PatchProposal,
): PatchAffectedPaths {
  const parsed = parseCodexPatch(proposal.patch);
  const affected: PatchAffectedPaths = {
    added: [],
    deleted: [],
    modified: [],
  };
  if (parsed.status === "invalid") {
    return affected;
  }

  for (const operation of parsed.patch.operations) {
    switch (operation.type) {
      case "add":
        affected.added.push(operation.path);
        break;
      case "delete":
        affected.deleted.push(operation.path);
        break;
      case "update":
        affected.modified.push(operation.movePath ?? operation.path);
        break;
    }
  }

  return affected;
}

export function getPatchProgressFromText(
  patchText: string,
): PatchProgressState | null {
  const files = new Map<string, PatchProgressFile>();
  let currentUpdatePath: string | null = null;

  for (const line of patchText
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")) {
    const normalized = markerLine(line);
    if (normalized.startsWith("*** Add File: ")) {
      const path = normalized.slice("*** Add File: ".length).trim();
      if (path.length > 0) {
        files.set(path, { operation: "add", path });
      }
      currentUpdatePath = null;
      continue;
    }

    if (normalized.startsWith("*** Delete File: ")) {
      const path = normalized.slice("*** Delete File: ".length).trim();
      if (path.length > 0) {
        files.set(path, { operation: "delete", path });
      }
      currentUpdatePath = null;
      continue;
    }

    if (normalized.startsWith("*** Update File: ")) {
      const path = normalized.slice("*** Update File: ".length).trim();
      currentUpdatePath = path.length === 0 ? null : path;
      if (currentUpdatePath !== null) {
        files.set(currentUpdatePath, {
          operation: "update",
          path: currentUpdatePath,
        });
      }
      continue;
    }

    if (normalized.startsWith("*** Move to: ") && currentUpdatePath !== null) {
      const movePath = normalized.slice("*** Move to: ".length).trim();
      if (movePath.length > 0) {
        files.set(currentUpdatePath, {
          operation: "update",
          path: currentUpdatePath,
          movePath,
        });
      }
    }
  }

  if (files.size === 0) {
    return null;
  }

  return {
    files: [...files.values()],
    patchCharacterCount: patchText.length,
  };
}

async function validatePatch({
  proposal,
  root,
}: {
  proposal: PatchProposal;
  root: string;
}): Promise<
  | { status: "valid"; patch: ValidatedPatch }
  | {
      status: "invalid";
      errors: PatchValidationError[];
      proposal: PatchProposal;
    }
> {
  const absoluteRoot = resolve(root);
  const errors: PatchValidationError[] = [];
  const parsed = parseCodexPatch(proposal.patch);
  const fileStates = new Map<string, MutableFileState>();
  const changedFiles = new Map<string, ValidatedPatchFile>();

  if (parsed.status === "invalid") {
    return {
      errors: [
        {
          editIndex: 0,
          message: parsed.error,
          path: parsed.path ?? "",
        },
      ],
      proposal,
      status: "invalid",
    };
  }
  if (parsed.patch.environmentId !== undefined) {
    return {
      errors: [
        {
          editIndex: 0,
          message: "apply_patch environment selection is unavailable for this turn",
          path: "",
        },
      ],
      proposal,
      status: "invalid",
    };
  }

  if (parsed.patch.operations.length === 0) {
    errors.push({
      editIndex: 0,
      message: "patch rejected: empty patch",
      path: "",
    });
  }

  for (const [operationIndex, operation] of parsed.patch.operations.entries()) {
    const pathValidation = validateRelativePath({
      absoluteRoot,
      editIndex: operationIndex,
      path: operation.path,
    });

    if (pathValidation.status === "invalid") {
      errors.push(pathValidation.error);
      continue;
    }

    if (operation.type === "add") {
      const state = await readOptionalFileState({
        absolutePath: pathValidation.absolutePath,
        editIndex: operationIndex,
        fileStates,
        path: operation.path,
      });
      if (state.status === "invalid") {
        errors.push(state.error);
        continue;
      }

      state.file.content = operation.content;
      state.file.existed = true;
      setChangedFile(changedFiles, state.file);
      continue;
    }

    const state = await getExistingFileState({
      absolutePath: pathValidation.absolutePath,
      editIndex: operationIndex,
      fileStates,
      missingKind: operation.type,
      path: operation.path,
    });
    if (state.status === "invalid") {
      errors.push(state.error);
      continue;
    }

    if (operation.type === "delete") {
      state.file.content = "";
      state.file.existed = false;
      setChangedFile(changedFiles, state.file);
      continue;
    }

    const nextContent = deriveUpdatedContent({
      chunks: operation.chunks,
      content: state.file.content,
      path: operation.path,
    });
    if (nextContent.status === "invalid") {
      errors.push({
        editIndex: operationIndex,
        message: nextContent.error,
        path: operation.path,
      });
      continue;
    }

    const moveValidation =
      operation.movePath === undefined
        ? undefined
        : validateRelativePath({
            absoluteRoot,
            editIndex: operationIndex,
            path: operation.movePath,
          });
    if (moveValidation?.status === "invalid") {
      errors.push(moveValidation.error);
      continue;
    }

    state.file.content = nextContent.content;
    state.file.existed = true;
    if (operation.movePath !== undefined) {
      moveFileState({
        file: state.file,
        fileStates,
        nextAbsolutePath: moveValidation!.absolutePath,
        nextPath: operation.movePath,
      });
    }
    setChangedFile(changedFiles, state.file);
  }

  if (errors.length > 0) {
    return { errors, proposal, status: "invalid" };
  }

  const changedFileList = [...changedFiles.values()].filter(
    (file) =>
      file.originalExisted !== (file.nextContent !== null) ||
      (file.nextContent !== null &&
        file.previousContent !== file.nextContent) ||
      file.writePath !== undefined,
  );

  return {
    patch: {
      diffText: createUnifiedDiff(changedFileList),
      files: changedFileList,
      parsed: parsed.patch,
      proposal,
    },
    status: "valid",
  };
}

function setChangedFile(
  changedFiles: Map<string, ValidatedPatchFile>,
  file: MutableFileState,
) {
  changedFiles.set(file.originalAbsolutePath, {
    absolutePath: file.originalAbsolutePath,
    newDiffPath: file.existed ? file.path : "/dev/null",
    nextContent: file.existed ? file.content : null,
    oldDiffPath: file.originalExisted ? file.originalPath : "/dev/null",
    originalExisted: file.originalExisted,
    path: file.originalPath,
    previousContent: file.previousContent,
    ...(file.absolutePath === file.originalAbsolutePath
      ? {}
      : {
          writeAbsolutePath: file.absolutePath,
          writePath: file.path,
        }),
  });
}

function moveFileState({
  file,
  fileStates,
  nextAbsolutePath,
  nextPath,
}: {
  file: MutableFileState;
  fileStates: Map<string, MutableFileState>;
  nextAbsolutePath: string;
  nextPath: string;
}) {
  const previousAbsolutePath = file.absolutePath;
  const previousPath = file.path;
  file.absolutePath = nextAbsolutePath;
  file.path = nextPath;
  fileStates.set(previousAbsolutePath, {
    absolutePath: previousAbsolutePath,
    content: "",
    existed: false,
    originalAbsolutePath: previousAbsolutePath,
    originalExisted: false,
    originalPath: previousPath,
    path: previousPath,
    previousContent: "",
  });
  fileStates.set(nextAbsolutePath, file);
}

export function parseCodexPatch(patchText: string): ParseResult {
  const input = codexPatchInputLines(patchText);
  const lines = [...input.lines];
  if (!input.preserveBoundaryBlankLines) {
    while (lines.length > 0 && lines[0]!.trim().length === 0) {
      lines.shift();
    }
    while (lines.length > 0 && lines[lines.length - 1]!.trim().length === 0) {
      lines.pop();
    }
  }

  if (lines[0]?.trim() !== "*** Begin Patch") {
    return {
      error: "invalid patch: The first line of the patch must be '*** Begin Patch'",
      status: "invalid",
    };
  }
  if (lines[lines.length - 1]?.trim() !== "*** End Patch") {
    return {
      error: "invalid patch: The last line of the patch must be '*** End Patch'",
      status: "invalid",
    };
  }

  const operations: PatchOperation[] = [];
  let index = 1;
  const endIndex = lines.length - 1;
  let environmentId: string | undefined;
  const firstEnvironmentId =
    index < endIndex ? parseEnvironmentIdLine(lines[index]!) : null;
  if (firstEnvironmentId !== null) {
    if (firstEnvironmentId.length === 0) {
      return {
        error: "apply_patch environment_id cannot be empty",
        status: "invalid",
      };
    }
    environmentId = firstEnvironmentId;
    index += 1;
  }

  while (index < endIndex) {
    const line = markerLine(lines[index]!);
    if (parseEnvironmentIdLine(line) !== null) {
      return {
        error: "apply_patch environment_id cannot be specified more than once",
        status: "invalid",
      };
    }
    if (line.startsWith("*** Add File: ")) {
      const path = line.slice("*** Add File: ".length);
      const addLines: string[] = [];
      index += 1;
      while (index < endIndex && !isFileOperationHeader(lines[index]!)) {
        const contentLine = lines[index]!;
        if (!contentLine.startsWith("+")) {
          return {
            error: invalidHunkHeaderMessage({
              line: contentLine,
              lineNumber: index + 1,
            }),
            status: "invalid",
          };
        }
        addLines.push(contentLine.slice(1));
        index += 1;
      }
      if (path.length === 0) {
        return { error: "Add file path is empty.", path, status: "invalid" };
      }
      operations.push({
        content:
          addLines.length === 0 ? "" : ensureTrailingNewline(addLines.join("\n")),
        path,
        type: "add",
      });
      continue;
    }

    if (line.startsWith("*** Delete File: ")) {
      const path = line.slice("*** Delete File: ".length);
      if (path.length === 0) {
        return { error: "Delete file path is empty.", path, status: "invalid" };
      }
      operations.push({ path, type: "delete" });
      index += 1;
      continue;
    }

    if (line.startsWith("*** Update File: ")) {
      const path = line.slice("*** Update File: ".length);
      if (path.length === 0) {
        return { error: "Update file path is empty.", path, status: "invalid" };
      }
      index += 1;
      let movePath: string | undefined;
      if (
        index < endIndex &&
        markerLine(lines[index]!).startsWith("*** Move to: ")
      ) {
        movePath = markerLine(lines[index]!).slice("*** Move to: ".length);
        if (movePath.length === 0) {
          return { error: "Move path is empty.", path, status: "invalid" };
        }
        index += 1;
      }

      const chunks: UpdateChunk[] = [];
      let currentChunk: UpdateChunk | null = null;
      while (
        index < endIndex &&
        !isFileOperationHeader(lines[index]!.trimEnd(), {
          allowPadding: false,
        })
      ) {
        const changeLine = lines[index]!;
        const structuralLine = changeLine.trimEnd();
        const contextMarker = parseUpdateHunkContextMarker(structuralLine);
        if (contextMarker.isMarker) {
          if (currentChunk !== null) {
            if (!hasChunkLines(currentChunk)) {
              return {
                error: unexpectedUpdateHunkLineMessage(changeLine),
                path,
                status: "invalid",
              };
            }
            chunks.push(currentChunk);
          }
          currentChunk = {
            ...(contextMarker.context === undefined
              ? {}
              : { context: contextMarker.context }),
            isEndOfFile: false,
            newLines: [],
            oldLines: [],
          };
          index += 1;
          continue;
        }
        if (structuralLine.startsWith("@@")) {
          return {
            error: unexpectedUpdateHunkLineMessage(changeLine),
            path,
            status: "invalid",
          };
        }

        if (currentChunk === null && structuralLine === "*** End of File") {
          index += 1;
          continue;
        }

        currentChunk ??= {
          isEndOfFile: false,
          newLines: [],
          oldLines: [],
        };

        if (structuralLine === "*** End of File") {
          if (!hasChunkLines(currentChunk)) {
            return {
              error: "Update hunk does not contain any lines",
              path,
              status: "invalid",
            };
          }
          currentChunk.isEndOfFile = true;
          index += 1;
          continue;
        }

        if (currentChunk.isEndOfFile) {
          if (structuralLine.length === 0) {
            index += 1;
            continue;
          }
          return {
            error: `Expected update hunk to start with a @@ context marker, got: '${changeLine}'`,
            path,
            status: "invalid",
          };
        }

        if (changeLine === "") {
          currentChunk.oldLines.push("");
          currentChunk.newLines.push("");
          index += 1;
          continue;
        }

        const prefix = changeLine[0];
        if (prefix !== "+" && prefix !== "-" && prefix !== " ") {
          return {
            error: hasChunkLines(currentChunk)
              ? expectedUpdateContextMarkerMessage(changeLine)
              : unexpectedUpdateHunkLineMessage(changeLine),
            path,
            status: "invalid",
          };
        }
        const content = changeLine.slice(1);
        if (prefix === " " || prefix === "-") {
          currentChunk.oldLines.push(content);
        }
        if (prefix === " " || prefix === "+") {
          currentChunk.newLines.push(content);
        }
        index += 1;
      }
      if (currentChunk !== null) {
        if (!hasChunkLines(currentChunk)) {
          return {
            error:
              index < endIndex
                ? unexpectedUpdateHunkLineMessage(lines[index]!)
                : "Update hunk does not contain any lines",
            path,
            status: "invalid",
          };
        }
        chunks.push(currentChunk);
      }
      if (chunks.length === 0) {
        return {
          error: `Update file hunk for path '${path}' is empty`,
          path,
          status: "invalid",
        };
      }
      operations.push({
        chunks,
        ...(movePath === undefined ? {} : { movePath }),
        path,
        type: "update",
      });
      continue;
    }

    return {
      error: invalidHunkHeaderMessage({
        line,
        lineNumber: index + 1,
      }),
      status: "invalid",
    };
  }

  return {
    patch: {
      ...(environmentId === undefined ? {} : { environmentId }),
      operations,
    },
    status: "valid",
  };
}

function validateRelativePath({
  absoluteRoot,
  editIndex,
  path,
}: {
  absoluteRoot: string;
  editIndex: number;
  path: string;
}):
  | { status: "valid"; absolutePath: string }
  | { status: "invalid"; error: PatchValidationError } {
  if (path.trim().length === 0) {
    return {
      error: { editIndex, message: "Patch path is empty.", path },
      status: "invalid",
    };
  }

  const absolutePath = resolve(absoluteRoot, path);
  const relativePath = relative(absoluteRoot, absolutePath);
  const insideRoot =
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath));

  if (!insideRoot) {
    return {
      error: {
        editIndex,
        message: "Patch path is outside the working directory.",
        path,
      },
      status: "invalid",
    };
  }

  return { absolutePath, status: "valid" };
}

async function readOptionalFileState({
  absolutePath,
  editIndex,
  fileStates,
  path,
}: {
  absolutePath: string;
  editIndex: number;
  fileStates: Map<string, MutableFileState>;
  path: string;
}): Promise<
  | { status: "valid"; file: MutableFileState }
  | { status: "invalid"; error: PatchValidationError }
> {
  const existing = fileStates.get(absolutePath);
  if (existing !== undefined) {
    return { file: existing, status: "valid" };
  }

  try {
    const bytes = await readFile(absolutePath);
    const content = decodePatchTarget(bytes);
    if (content === null) {
      return {
        error: {
          editIndex,
          message: "Patch target is not valid UTF-8.",
          path,
        },
        status: "invalid",
      };
    }
    if (content.includes("\0")) {
      return {
        error: {
          editIndex,
          message: "Patch target appears to be binary.",
          path,
        },
        status: "invalid",
      };
    }

    const file = {
      absolutePath,
      content,
      existed: true,
      originalAbsolutePath: absolutePath,
      originalExisted: true,
      originalPath: path,
      path,
      previousContent: content,
    };
    fileStates.set(absolutePath, file);
    return { file, status: "valid" };
  } catch (error) {
    if (!isNotFoundError(error)) {
      return {
        error: {
          editIndex,
          message: `Could not read file: ${error instanceof Error ? error.message : String(error)}`,
          path,
        },
        status: "invalid",
      };
    }

    const file = {
      absolutePath,
      content: "",
      existed: false,
      originalAbsolutePath: absolutePath,
      originalExisted: false,
      originalPath: path,
      path,
      previousContent: "",
    };
    fileStates.set(absolutePath, file);
    return { file, status: "valid" };
  }
}

async function getExistingFileState({
  absolutePath,
  editIndex,
  fileStates,
  missingKind,
  path,
}: {
  absolutePath: string;
  editIndex: number;
  fileStates: Map<string, MutableFileState>;
  missingKind: "delete" | "update";
  path: string;
}): Promise<
  | { status: "valid"; file: MutableFileState }
  | { status: "invalid"; error: PatchValidationError }
> {
  if (missingKind === "delete") {
    const directoryCheck = await rejectDirectoryReadForDelete({
      absolutePath,
      editIndex,
    });
    if (directoryCheck.status === "invalid") {
      return directoryCheck;
    }
  }

  const file = await readOptionalFileState({
    absolutePath,
    editIndex,
    fileStates,
    path,
  });
  if (file.status === "invalid") {
    return file;
  }
  if (!file.file.existed) {
    return {
      error: {
        editIndex,
        message: missingFileMessage({ absolutePath, kind: missingKind }),
        path: "",
      },
      status: "invalid",
    };
  }

  return file;
}

async function rejectDirectoryReadForDelete({
  absolutePath,
  editIndex,
}: {
  absolutePath: string;
  editIndex: number;
}): Promise<
  | { status: "valid" }
  | { status: "invalid"; error: PatchValidationError }
> {
  try {
    const stats = await stat(absolutePath);
    if (!stats.isDirectory()) {
      return { status: "valid" };
    }
  } catch {
    return { status: "valid" };
  }

  return {
    error: {
      editIndex,
      message: deleteReadFailureMessage({
        absolutePath,
        reason: "Is a directory (os error 21)",
      }),
      path: "",
    },
    status: "invalid",
  };
}

function missingFileMessage({
  absolutePath,
  kind,
}: {
  absolutePath: string;
  kind: "delete" | "update";
}): string {
  switch (kind) {
    case "delete":
      return deleteReadFailureMessage({
        absolutePath,
        reason: "No such file or directory (os error 2)",
      });
    case "update":
      return `Failed to read file to update ${absolutePath}: No such file or directory (os error 2)`;
  }
}

function deleteReadFailureMessage({
  absolutePath,
  reason,
}: {
  absolutePath: string;
  reason: string;
}): string {
  return `Failed to read ${absolutePath}: ${reason}`;
}

function deriveUpdatedContent({
  chunks,
  content,
  path,
}: {
  chunks: readonly UpdateChunk[];
  content: string;
  path: string;
}):
  | { content: string; status: "valid" }
  | { error: string; status: "invalid" } {
  const originalLines = splitPatchLines(content);
  const replacements = computeReplacements({ chunks, originalLines, path });
  if (replacements.status === "invalid") {
    return replacements;
  }

  const newLines = applyReplacements(originalLines, replacements.replacements);
  return {
    content: ensureTrailingNewline(newLines.join("\n")),
    status: "valid",
  };
}

function computeReplacements({
  chunks,
  originalLines,
  path,
}: {
  chunks: readonly UpdateChunk[];
  originalLines: readonly string[];
  path: string;
}):
  | { replacements: Replacement[]; status: "valid" }
  | { error: string; status: "invalid" } {
  const replacements: Replacement[] = [];
  let lineIndex = 0;

  for (const chunk of chunks) {
    let missingContext: string | undefined;
    if (chunk.context !== undefined) {
      const contextIndex = seekSequence({
        eof: false,
        lines: originalLines,
        pattern: [chunk.context],
        start: lineIndex,
      });
      if (contextIndex === null) {
        if (chunk.oldLines.length === 0) {
          return {
            error: `Failed to find context '${chunk.context}' in ${path}.`,
            status: "invalid",
          };
        }
        missingContext = chunk.context;
      } else {
        lineIndex = contextIndex + 1;
      }
    }

    if (chunk.oldLines.length === 0) {
      const insertionIndex =
        originalLines[originalLines.length - 1] === ""
          ? originalLines.length - 1
          : originalLines.length;
      replacements.push({
        newLines: chunk.newLines,
        oldLength: 0,
        startIndex: insertionIndex,
      });
      continue;
    }

    let pattern = chunk.oldLines;
    let newLines = chunk.newLines;
    let startIndex = seekUpdatePattern({
      eof: chunk.isEndOfFile,
      missingContext,
      originalLines,
      pattern,
      start: lineIndex,
    });

    if (startIndex === null && pattern[pattern.length - 1] === "") {
      pattern = pattern.slice(0, -1);
      if (newLines[newLines.length - 1] === "") {
        newLines = newLines.slice(0, -1);
      }
      startIndex = seekUpdatePattern({
        eof: chunk.isEndOfFile,
        missingContext,
        originalLines,
        pattern,
        start: lineIndex,
      });
    }

    if (startIndex === "ambiguous") {
      return {
        error: `Failed to find context '${missingContext}' in ${path}; expected lines matched multiple locations.`,
        status: "invalid",
      };
    }

    if (startIndex === null) {
      return {
        error: expectedLinesNotFoundMessage({ lines: chunk.oldLines, path }),
        status: "invalid",
      };
    }

    replacements.push({
      newLines,
      oldLength: pattern.length,
      startIndex,
    });
    lineIndex = startIndex + pattern.length;
  }

  return {
    replacements: replacements.sort(
      (first, second) => first.startIndex - second.startIndex,
    ),
    status: "valid",
  };
}

function expectedLinesNotFoundMessage({
  lines,
  path,
}: {
  lines: readonly string[];
  path: string;
}): string {
  return [
    `Failed to find expected lines in ${path}:`,
    lines.join("\n"),
    "",
    "Each update hunk must match one contiguous region of the current file. Split non-contiguous edits, moves, or reorders into separate @@ hunks.",
  ].join("\n");
}

function seekUpdatePattern({
  eof,
  missingContext,
  originalLines,
  pattern,
  start,
}: {
  eof: boolean;
  missingContext?: string;
  originalLines: readonly string[];
  pattern: readonly string[];
  start: number;
}): number | "ambiguous" | null {
  if (missingContext === undefined) {
    return seekSequence({
      eof,
      lines: originalLines,
      pattern,
      start,
    });
  }

  const match = seekUniqueSequence({
    eof,
    lines: originalLines,
    pattern,
    start,
  });
  if (match === null) {
    return null;
  }

  return match;
}

function applyReplacements(
  lines: readonly string[],
  replacements: readonly Replacement[],
): string[] {
  const nextLines = [...lines];
  for (const replacement of [...replacements].reverse()) {
    nextLines.splice(
      replacement.startIndex,
      replacement.oldLength,
      ...replacement.newLines,
    );
  }
  return nextLines;
}

function seekSequence({
  eof,
  lines,
  pattern,
  start,
}: {
  eof: boolean;
  lines: readonly string[];
  pattern: readonly string[];
  start: number;
}): number | null {
  if (pattern.length === 0) {
    return start;
  }
  if (pattern.length > lines.length) {
    return null;
  }

  const searchStart =
    eof && lines.length >= pattern.length
      ? lines.length - pattern.length
      : start;
  const lastStart = lines.length - pattern.length;
  const matchers = [
    (line: string, expected: string) => line === expected,
    (line: string, expected: string) => line.trimEnd() === expected.trimEnd(),
    (line: string, expected: string) => line.trim() === expected.trim(),
    (line: string, expected: string) =>
      normalizeLine(line) === normalizeLine(expected),
  ];

  for (const matches of matchers) {
    for (let index = searchStart; index <= lastStart; index += 1) {
      if (
        pattern.every((expected, offset) =>
          matches(lines[index + offset]!, expected),
        )
      ) {
        return index;
      }
    }
  }

  return null;
}

function seekUniqueSequence({
  eof,
  lines,
  pattern,
  start,
}: {
  eof: boolean;
  lines: readonly string[];
  pattern: readonly string[];
  start: number;
}): number | "ambiguous" | null {
  if (pattern.length === 0) {
    return start;
  }
  if (pattern.length > lines.length) {
    return null;
  }

  const searchStart =
    eof && lines.length >= pattern.length
      ? lines.length - pattern.length
      : start;
  const lastStart = lines.length - pattern.length;
  const matchers = [
    (line: string, expected: string) => line === expected,
    (line: string, expected: string) => line.trimEnd() === expected.trimEnd(),
    (line: string, expected: string) => line.trim() === expected.trim(),
    (line: string, expected: string) =>
      normalizeLine(line) === normalizeLine(expected),
  ];

  for (const matches of matchers) {
    const indexes: number[] = [];
    for (let index = searchStart; index <= lastStart; index += 1) {
      if (
        pattern.every((expected, offset) =>
          matches(lines[index + offset]!, expected),
        )
      ) {
        indexes.push(index);
      }
    }

    if (indexes.length === 1) {
      return indexes[0]!;
    }
    if (indexes.length > 1) {
      return "ambiguous";
    }
  }

  return null;
}

function createUnifiedDiff(files: readonly ValidatedPatchFile[]): string {
  return files
    .map((file) =>
      createTwoFilesPatch(
        file.oldDiffPath,
        file.nextContent === null ? "/dev/null" : file.newDiffPath,
        file.previousContent,
        file.nextContent ?? "",
        "",
        "",
        { context: 1 },
      ).trimEnd(),
    )
    .join("\n");
}

function codexPatchInputLines(patchText: string): {
  lines: string[];
  preserveBoundaryBlankLines: boolean;
} {
  const normalized = normalizePatchLineEndings(patchText).trim();
  const lines = normalized.split("\n");
  if (
    lines.length >= 4 &&
    (lines[0] === "<<EOF" ||
      lines[0] === "<<'EOF'" ||
      lines[0] === '<<"EOF"') &&
    lines[lines.length - 1]!.endsWith("EOF")
  ) {
    return {
      lines: lines.slice(1, -1),
      preserveBoundaryBlankLines: true,
    };
  }

  return {
    lines: splitCodexPatchInput(patchText),
    preserveBoundaryBlankLines: false,
  };
}

function splitCodexPatchInput(patchText: string): string[] {
  return normalizePatchLineEndings(patchText).split("\n");
}

function normalizePatchLineEndings(patchText: string): string {
  return patchText.replace(/\r\n/g, "\n");
}

function isFileOperationHeader(
  line: string,
  options: { allowPadding: boolean } = { allowPadding: true },
): boolean {
  const normalized = options.allowPadding ? markerLine(line) : line;
  return (
    normalized.startsWith("*** Add File: ") ||
    normalized.startsWith("*** Delete File: ") ||
    normalized.startsWith("*** Update File: ")
  );
}

function markerLine(line: string): string {
  const trimmed = line.trim();
  return trimmed.startsWith("***") ? trimmed : line;
}

function parseEnvironmentIdLine(line: string): string | null {
  const normalized = markerLine(line);
  return normalized.startsWith(ENVIRONMENT_ID_MARKER)
    ? normalized.slice(ENVIRONMENT_ID_MARKER.length).trim()
    : null;
}

function invalidHunkHeaderMessage({
  line,
  lineNumber,
}: {
  line: string;
  lineNumber: number;
}): string {
  return `invalid hunk at line ${lineNumber}, '${markerLine(line)}' is not a valid hunk header. Valid hunk headers: '*** Add File: {path}', '*** Delete File: {path}', '*** Update File: {path}'`;
}

function unexpectedUpdateHunkLineMessage(line: string): string {
  return `Unexpected line found in update hunk: '${line}'. Every line should start with ' ' (context line), '+' (added line), or '-' (removed line)`;
}

function expectedUpdateContextMarkerMessage(line: string): string {
  return `Expected update hunk to start with a @@ context marker, got: '${line}'`;
}

function parseUpdateHunkContextMarker(
  line: string,
): { context?: string; isMarker: boolean } {
  if (line === "@@") {
    return { isMarker: true };
  }

  if (!line.startsWith("@@ ")) {
    return { isMarker: false };
  }

  const context = line.slice("@@ ".length);
  const unifiedRange = context.match(
    /^-\d+(?:,\d+)? \+\d+(?:,\d+)? @@(?: (.*))?$/,
  );
  if (unifiedRange !== null) {
    const trailingContext = unifiedRange[1]?.trim();
    return trailingContext === undefined || trailingContext.length === 0
      ? { isMarker: true }
      : { context: trailingContext, isMarker: true };
  }

  return { context, isMarker: true };
}

function hasChunkLines(chunk: UpdateChunk): boolean {
  return chunk.oldLines.length > 0 || chunk.newLines.length > 0;
}

function splitPatchLines(content: string): string[] {
  const lines = content.split("\n");
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function splitTextForPatch(text: string): string[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  if (lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines.length === 0 ? [""] : lines;
}

function formatUpdateChunksForProgress(chunks: readonly UpdateChunk[]): string {
  const lines: string[] = [];
  for (const chunk of chunks) {
    lines.push(chunk.context === undefined ? "@@" : `@@ ${chunk.context}`);
    for (const line of chunk.oldLines) {
      lines.push(`-${line}`);
    }
    for (const line of chunk.newLines) {
      lines.push(`+${line}`);
    }
    if (chunk.isEndOfFile) {
      lines.push("*** End of File");
    }
  }

  return lines.length === 0 ? "" : `${lines.join("\n")}\n`;
}

function ensureTrailingNewline(content: string): string {
  return content.endsWith("\n") ? content : `${content}\n`;
}

function normalizeLine(value: string): string {
  return value
    .trim()
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
    .replace(/[\u2018\u2019\u201A\u201B]/g, "'")
    .replace(/[\u201C\u201D\u201E\u201F]/g, '"')
    .replace(
      /[\u00A0\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u202F\u205F\u3000]/g,
      " ",
    );
}

function decodePatchTarget(bytes: Uint8Array): string | null {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
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
