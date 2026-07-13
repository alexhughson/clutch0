import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type {
  ContextItem,
  FilePath,
  LlmFileContext,
  SessionEvent,
} from "../../../types";
import {
  MAX_FILE_CONTEXT_CHARACTERS,
  safeJsonStringify as formatSafeJsonStringify,
} from "../contextItemFormatting";

export { safeJsonStringify } from "../contextItemFormatting";

export function fieldChanged(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
  field: string,
): boolean {
  return (
    formatSafeJsonStringify(previous[field]) !==
    formatSafeJsonStringify(next[field])
  );
}

export function stateUpdatedEvent({
  details,
  item,
  kind,
}: {
  details?: Record<string, unknown>;
  item: ContextItem;
  kind: string;
}): SessionEvent {
  return {
    at: Date.now(),
    ...(details === undefined ? {} : { details }),
    itemId: item.id,
    kind,
    schemaVersion: 1,
  };
}

export async function readFileContext({
  filePath,
  remainingFileCharacters,
  root,
}: {
  filePath: FilePath;
  remainingFileCharacters: number;
  root: string;
}): Promise<LlmFileContext> {
  if (remainingFileCharacters <= 0) {
    return {
      filePath,
      content: "",
      status: "skipped",
      truncated: false,
      errorMessage:
        "Skipped because the selected file context limit was reached.",
    };
  }

  const absoluteRoot = resolve(root);
  const absoluteFilePath = resolve(absoluteRoot, filePath);
  if (!isInsideRoot(absoluteRoot, absoluteFilePath)) {
    return {
      filePath,
      content: "",
      status: "skipped",
      truncated: false,
      errorMessage:
        "Skipped because the path is outside the working directory.",
    };
  }

  try {
    const rawContent = await readFile(absoluteFilePath, "utf8");
    if (rawContent.includes("\0")) {
      return {
        filePath,
        content: "",
        status: "skipped",
        truncated: false,
        errorMessage: "Skipped because the file appears to be binary.",
      };
    }

    const characterLimit = Math.min(
      MAX_FILE_CONTEXT_CHARACTERS,
      remainingFileCharacters,
    );
    const content = rawContent.slice(0, characterLimit);

    return {
      filePath,
      content,
      status: "included",
      truncated: rawContent.length > content.length,
    };
  } catch (error) {
    return {
      filePath,
      content: "",
      status: "skipped",
      truncated: false,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}

function isInsideRoot(root: string, path: string): boolean {
  const relativePath = relative(root, path);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}
