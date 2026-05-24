import { readFile, mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { createTwoFilesPatch } from "diff";
import type {
  PatchEdit,
  PatchProposal,
  PatchValidationError,
  PatchValidationResult,
} from "./types";

export type ValidatedPatch = {
  diffText: string;
  files: ValidatedPatchFile[];
  proposal: PatchProposal;
};

type ValidatedPatchFile = {
  absolutePath: string;
  existed: boolean;
  nextContent: string;
  path: string;
  previousContent: string;
};

type MutableFileState = {
  absolutePath: string;
  content: string;
  existed: boolean;
  path: string;
  previousContent: string;
};

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
    await mkdir(dirname(file.absolutePath), { recursive: true });
    await writeFile(file.absolutePath, file.nextContent, "utf8");
  }

  return {
    diffText: validation.patch.diffText,
    proposal,
    status: "valid",
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
  const fileStates = new Map<string, MutableFileState>();

  if (proposal.edits.length === 0) {
    errors.push({
      editIndex: 0,
      message: "Patch proposal did not include any edits.",
      path: "",
    });
  }

  for (const [editIndex, edit] of proposal.edits.entries()) {
    const pathValidation = validateRelativePath({
      absoluteRoot,
      editIndex,
      path: edit.path,
    });

    if (pathValidation.status === "invalid") {
      errors.push(pathValidation.error);
      continue;
    }

    const state = await getMutableFileState({
      absolutePath: pathValidation.absolutePath,
      edit,
      editIndex,
      fileStates,
    });

    if (state.status === "invalid") {
      errors.push(state.error);
      continue;
    }

    const nextContent = applyEditToContent({
      edit,
      editIndex,
      state: state.file,
    });
    if (nextContent.status === "invalid") {
      errors.push(nextContent.error);
      continue;
    }

    state.file.content = nextContent.content;
  }

  if (errors.length > 0) {
    return { errors, proposal, status: "invalid" };
  }

  const files = [...fileStates.values()]
    .filter((file) => file.previousContent !== file.content || !file.existed)
    .map((file) => ({
      absolutePath: file.absolutePath,
      existed: file.existed,
      nextContent: file.content,
      path: file.path,
      previousContent: file.previousContent,
    }));

  return {
    patch: {
      diffText: createUnifiedDiff(files),
      files,
      proposal,
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
      error: { editIndex, message: "Patch edit path is empty.", path },
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
        message: "Patch edit path is outside the working directory.",
        path,
      },
      status: "invalid",
    };
  }

  return { absolutePath, status: "valid" };
}

async function getMutableFileState({
  absolutePath,
  edit,
  editIndex,
  fileStates,
}: {
  absolutePath: string;
  edit: PatchEdit;
  editIndex: number;
  fileStates: Map<string, MutableFileState>;
}): Promise<
  | { status: "valid"; file: MutableFileState }
  | { status: "invalid"; error: PatchValidationError }
> {
  const existing = fileStates.get(absolutePath);
  if (existing !== undefined) {
    return { file: existing, status: "valid" };
  }

  try {
    const content = await readFile(absolutePath, "utf8");
    if (content.includes("\0")) {
      return {
        error: {
          editIndex,
          message: "Patch target appears to be binary.",
          path: edit.path,
        },
        status: "invalid",
      };
    }

    const file = {
      absolutePath,
      content,
      existed: true,
      path: edit.path,
      previousContent: content,
    };
    fileStates.set(absolutePath, file);
    return { file, status: "valid" };
  } catch (error) {
    if (edit.oldText.length !== 0 || !isNotFoundError(error)) {
      return {
        error: {
          editIndex,
          message: `Could not read existing file: ${error instanceof Error ? error.message : String(error)}`,
          path: edit.path,
        },
        status: "invalid",
      };
    }

    const file = {
      absolutePath,
      content: "",
      existed: false,
      path: edit.path,
      previousContent: "",
    };
    fileStates.set(absolutePath, file);
    return { file, status: "valid" };
  }
}

function applyEditToContent({
  edit,
  editIndex,
  state,
}: {
  edit: PatchEdit;
  editIndex: number;
  state: MutableFileState;
}):
  | { status: "valid"; content: string }
  | { status: "invalid"; error: PatchValidationError } {
  if (
    !state.existed &&
    state.content.length === 0 &&
    edit.oldText.length === 0
  ) {
    return { content: edit.newText, status: "valid" };
  }

  if (state.existed && edit.oldText.length === 0) {
    return {
      error: {
        editIndex,
        message: "Empty oldText is only allowed when creating a new file.",
        path: edit.path,
      },
      status: "invalid",
    };
  }

  const matchCount = countOccurrences(state.content, edit.oldText);

  if (matchCount === 0) {
    return {
      error: {
        editIndex,
        message: "oldText did not match the current file content.",
        path: edit.path,
      },
      status: "invalid",
    };
  }

  if (matchCount > 1) {
    return {
      error: {
        editIndex,
        message: `oldText matched ${matchCount} times; it must match exactly once.`,
        path: edit.path,
      },
      status: "invalid",
    };
  }

  return {
    content: state.content.replace(edit.oldText, edit.newText),
    status: "valid",
  };
}

function createUnifiedDiff(files: readonly ValidatedPatchFile[]): string {
  return files
    .map((file) =>
      createTwoFilesPatch(
        file.existed ? file.path : "/dev/null",
        file.path,
        file.previousContent,
        file.nextContent,
        "",
        "",
        { context: 3 },
      ).trimEnd(),
    )
    .join("\n");
}

function isNotFoundError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ENOENT"
  );
}

function countOccurrences(haystack: string, needle: string): number {
  if (needle.length === 0) {
    return 0;
  }

  let count = 0;
  let position = 0;

  while (true) {
    const match = haystack.indexOf(needle, position);
    if (match === -1) {
      return count;
    }

    count += 1;
    position = match + needle.length;
  }
}
