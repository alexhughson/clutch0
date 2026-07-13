import { loadFileList } from "../fileListLoader";
import { isNotGitRepositoryError, readGitDiff } from "../git/gitDiff";
import {
  createFileContextItem,
  getFileContextItemId,
} from "./contextItemFactories";
import type {
  AutomaticContextItem,
  AutomaticFileListContextItem,
  AutomaticUnstagedChangesContextItem,
  ContextItem,
  FileContextItem,
} from "./contextItemTypes";

export const AGENTS_CONTEXT_ITEM_ID = getFileContextItemId("AGENTS.md");
export const FILE_LIST_CONTEXT_ITEM_ID = "builtin:file-list";
export const UNSTAGED_CHANGES_CONTEXT_ITEM_ID = "builtin:unstaged-changes";
export const MAX_DIFF_CONTEXT_CHARACTERS = 120_000;
export const MAX_DIRECTORY_TREE_ENTRIES = 1_000;

export function getAmbientLlmContextItems(
  automaticContextItems: readonly AutomaticContextItem[] = createAutomaticContextItems(),
): ContextItem[] {
  return automaticContextItems.filter(
    (item) =>
      item.type === "automatic-unstaged-changes" ||
      item.type === "automatic-file-list",
  );
}

export function getAutomaticContextBlockName(type: string): string | null {
  if (type === "automatic-unstaged-changes") {
    return "current_diff";
  }

  if (type === "automatic-file-list") {
    return "directory_tree";
  }

  return null;
}

export function createAutomaticContextItems(): AutomaticContextItem[] {
  return [
    createFileContextItem("AGENTS.md"),
    createAutomaticUnstagedChangesContextItem(),
    createAutomaticFileListContextItem(),
  ];
}

export function createAutomaticUnstagedChangesContextItem(
  summaryState: AutomaticUnstagedChangesContextItem["summaryState"] = {
    status: "missing",
  },
): AutomaticUnstagedChangesContextItem {
  return {
    id: UNSTAGED_CHANGES_CONTEXT_ITEM_ID,
    summaryState,
    type: "automatic-unstaged-changes",
  };
}

export function createAutomaticFileListContextItem(
  summaryState: AutomaticFileListContextItem["summaryState"] = {
    status: "missing",
  },
): AutomaticFileListContextItem {
  return {
    id: FILE_LIST_CONTEXT_ITEM_ID,
    summaryState,
    type: "automatic-file-list",
  };
}

export async function readCurrentDiffForLlm({
  root,
}: {
  root: string;
}): Promise<string | null> {
  try {
    const diffText = await readCurrentDiffForContext({ root });
    return diffText.trim().length === 0 ? null : diffText;
  } catch (error) {
    if (isNotGitRepositoryError(error)) {
      return null;
    }

    throw error;
  }
}

export async function readFileListForLlm({
  root,
}: {
  root: string;
}): Promise<string | null> {
  const filePaths = await loadFileList({ root });
  if (filePaths.length === 0) {
    return null;
  }

  const visibleFilePaths = filePaths.slice(0, MAX_DIRECTORY_TREE_ENTRIES);
  const truncatedNote =
    filePaths.length > visibleFilePaths.length
      ? `\n[Directory tree truncated after ${visibleFilePaths.length} of ${filePaths.length} files.]`
      : "";

  return `${visibleFilePaths.join("\n")}${truncatedNote}`;
}

export function getAutomaticContextItems(): readonly AutomaticContextItem[] {
  return createAutomaticContextItems();
}

export function getVisibleContextItems(
  contextItems: readonly ContextItem[],
  automaticContextItems: readonly AutomaticContextItem[] = getAutomaticContextItems(),
): readonly ContextItem[] {
  const selectedItemIds = new Set(contextItems.map((item) => item.id));
  return [
    ...automaticContextItems.filter((item) => !selectedItemIds.has(item.id)),
    ...contextItems,
  ];
}

export function getAutomaticFileContextItems({
  automaticContextItems,
  contextItems,
}: {
  automaticContextItems: readonly AutomaticContextItem[];
  contextItems: readonly ContextItem[];
}): FileContextItem[] {
  const selectedItemIds = new Set(contextItems.map((item) => item.id));
  return automaticContextItems.filter(
    (item): item is FileContextItem =>
      item.type === "file" && !selectedItemIds.has(item.id),
  );
}

export function getVisibleContextItemById(
  contextItems: readonly ContextItem[],
  itemId: string | null,
  automaticContextItems: readonly AutomaticContextItem[] = getAutomaticContextItems(),
): ContextItem | null {
  return (
    getVisibleContextItems(contextItems, automaticContextItems).find(
      (item) => item.id === itemId,
    ) ?? null
  );
}

export { getFileContextItemId };

async function readCurrentDiffForContext({
  root,
}: {
  root: string;
}): Promise<string> {
  try {
    return truncateContent(
      await readGitDiff({
        includeStaged: true,
        maxBuffer: MAX_DIFF_CONTEXT_CHARACTERS * 2,
        root,
      }),
      MAX_DIFF_CONTEXT_CHARACTERS,
    );
  } catch (error) {
    if (isMaxBufferError(error)) {
      return markTruncatedContent(
        truncateContent(getErrorStdout(error), MAX_DIFF_CONTEXT_CHARACTERS),
      );
    }

    throw error;
  }
}

function isMaxBufferError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code ===
      "ERR_CHILD_PROCESS_STDIO_MAXBUFFER"
  );
}

function getErrorStdout(error: unknown): string {
  if (error === null || typeof error !== "object" || !("stdout" in error)) {
    return "";
  }

  const stdout = (error as { stdout: unknown }).stdout;
  return typeof stdout === "string" ? stdout : "";
}

function truncateContent(content: string, maxCharacters: number): string {
  return content.length <= maxCharacters
    ? content
    : markTruncatedContent(content.slice(0, maxCharacters));
}

function markTruncatedContent(content: string): string {
  return content.endsWith("[Context truncated.]")
    ? content
    : `${content}\n[Context truncated.]`;
}
