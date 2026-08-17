import { createHash } from "node:crypto";
import { loadFileList } from "../fileListLoader";
import { isNotGitRepositoryError, readGitDiff } from "../git/gitDiff";
import { getGeneratedSummaryView } from "./contextItemFormatting";
import { openContextItemAction } from "./contextItemActions";
import {
  createFileContextItem,
  FileContextItem,
  getFileContextItemId,
} from "./contextItems";
import type {
  ContextItem,
  ContextItemAction,
  ContextItemDetailView,
  ContextItemPersistence,
  ContextItemState,
  ContextItemSummaryState,
  FormattedContextItem,
  SessionEvent,
} from "../../types";

const MISSING_SUMMARY_STATE: ContextItemSummaryState = { status: "missing" };

export const AGENTS_CONTEXT_ITEM_ID = getFileContextItemId("AGENTS.md");
export const FILE_LIST_CONTEXT_ITEM_ID = "builtin:file-list";
export const UNSTAGED_CHANGES_CONTEXT_ITEM_ID = "builtin:unstaged-changes";

export const MAX_DIFF_CONTEXT_CHARACTERS = 120_000;
export const MAX_DIRECTORY_TREE_ENTRIES = 1_000;

export async function readCurrentDiffForLlm({
  root,
}: {
  root: string;
}): Promise<string | null> {
  try {
    const diffText = await readCurrentDiffForContext({ root });
    if (diffText.trim().length === 0) {
      return null;
    }

    return diffText;
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

export function getAmbientLlmContextItems(
  automaticContextItems: readonly ContextItem[] = createAutomaticContextItems(),
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

export function createAutomaticContextItems(): ContextItem[] {
  return [
    createFileContextItem("AGENTS.md"),
    new UnstagedChangesContextItem(),
    new FileListContextItem(),
  ];
}

export function getAutomaticContextItems(): readonly ContextItem[] {
  return createAutomaticContextItems();
}

export function getVisibleContextItems(
  contextItems: readonly ContextItem[],
  automaticContextItems: readonly ContextItem[] = getAutomaticContextItems(),
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
  automaticContextItems: readonly ContextItem[];
  contextItems: readonly ContextItem[];
}): FileContextItem[] {
  const selectedItemIds = new Set(contextItems.map((item) => item.id));
  return automaticContextItems.filter(
    (item): item is FileContextItem =>
      item instanceof FileContextItem && !selectedItemIds.has(item.id),
  );
}

export function getVisibleContextItemById(
  contextItems: readonly ContextItem[],
  itemId: string | null,
  automaticContextItems: readonly ContextItem[] = getAutomaticContextItems(),
): ContextItem | null {
  return (
    getVisibleContextItems(contextItems, automaticContextItems).find(
      (item) => item.id === itemId,
    ) ?? null
  );
}

class UnstagedChangesContextItem implements ContextItem {
  readonly id = UNSTAGED_CHANGES_CONTEXT_ITEM_ID;
  readonly type = "automatic-unstaged-changes";
  readonly state: ContextItemState & {
    schemaVersion: 1;
    type: "automatic-unstaged-changes";
  };

  constructor(
    private readonly summaryState: ContextItemSummaryState = MISSING_SUMMARY_STATE,
  ) {
    this.state = {
      id: this.id,
      schemaVersion: 1,
      summaryState,
      type: this.type,
    };
  }

  getActions(): readonly ContextItemAction[] {
    return [openContextItemAction(this.id)];
  }

  isPinned(): boolean {
    return false;
  }

  withPinned(): ContextItem {
    throw new Error("Automatic context items cannot be pinned.");
  }

  async getDetailView({
    root,
  }: {
    root: string;
  }): Promise<ContextItemDetailView> {
    let diffText: string;
    try {
      diffText = await readCurrentDiff({
        maxBuffer: Number.MAX_SAFE_INTEGER,
        root,
      });
    } catch (error) {
      if (isNotGitRepositoryError(error)) {
        diffText = "";
      } else {
        throw error;
      }
    }

    if (diffText.trim().length === 0) {
      return {
        content: "No current changes.",
        kind: "text",
        title: "Current changes",
      };
    }

    return {
      diffText,
      kind: "diff",
      summary: "Current working tree diff.",
      title: "Current changes",
    };
  }

  getListLabel(): string {
    return "Current changes";
  }

  async getSummarizationInput({ root }: { root: string }) {
    let diffText: string;
    try {
      diffText = await readCurrentDiffForContext({ root });
    } catch (error) {
      if (isNotGitRepositoryError(error)) {
        return null;
      }

      throw error;
    }

    if (diffText.trim().length === 0) {
      return null;
    }

    const sourceText = `Current changes\n\n${diffText}`;
    return {
      content: sourceText,
      itemId: this.id,
      label: "Current changes",
      sourceHash: hashContent(sourceText),
      type: this.type,
    };
  }

  getSummaryState(): ContextItemSummaryState {
    return this.summaryState;
  }

  getSummaryView() {
    return getGeneratedSummaryView(this.summaryState, {
      detail: "Git current changes automatically included in LLM requests.",
      title: "Current changes",
    });
  }

  async formatForLlm({
    root,
  }: {
    focused: boolean;
    remainingFileCharacters: number;
    root: string;
  }): Promise<FormattedContextItem> {
    const diffText = await readCurrentDiffForLlm({ root });
    return {
      consumedFileCharacters: 0,
      text: diffText ?? "",
    };
  }

  withSummaryState(summaryState: ContextItemSummaryState): ContextItem {
    return new UnstagedChangesContextItem(summaryState);
  }

  getPersistence(): ContextItemPersistence {
    return {
      kind: "ephemeral",
      reason: "Current changes are read from the current workspace.",
    };
  }

  getHistoryEvents(): readonly SessionEvent[] {
    return [];
  }
}

class FileListContextItem implements ContextItem {
  readonly id = FILE_LIST_CONTEXT_ITEM_ID;
  readonly type = "automatic-file-list";
  readonly state: ContextItemState & {
    schemaVersion: 1;
    type: "automatic-file-list";
  };

  constructor(
    private readonly summaryState: ContextItemSummaryState = MISSING_SUMMARY_STATE,
  ) {
    this.state = {
      id: this.id,
      schemaVersion: 1,
      summaryState,
      type: this.type,
    };
  }

  getActions(): readonly ContextItemAction[] {
    return [openContextItemAction(this.id)];
  }

  isPinned(): boolean {
    return false;
  }

  withPinned(): ContextItem {
    throw new Error("Automatic context items cannot be pinned.");
  }

  async getDetailView({
    root,
  }: {
    root: string;
  }): Promise<ContextItemDetailView> {
    const filePaths = await loadFileList({ root });
    return {
      content:
        filePaths.length === 0
          ? "No files found."
          : filePaths.map((path) => `- ${path}`).join("\n"),
      kind: "markdown",
      title: "File list",
    };
  }

  getListLabel(): string {
    return "File list";
  }

  async getSummarizationInput({ root }: { root: string }) {
    const filePaths = await loadFileList({ root });
    if (filePaths.length === 0) {
      return null;
    }

    const sourceText = `File list\n\n${filePaths.join("\n")}`;
    return {
      content: sourceText,
      itemId: this.id,
      label: "File list",
      sourceHash: hashContent(sourceText),
      type: this.type,
    };
  }

  getSummaryState(): ContextItemSummaryState {
    return this.summaryState;
  }

  getSummaryView() {
    return getGeneratedSummaryView(this.summaryState, {
      detail: "Git-aware file list automatically included in LLM requests.",
      title: "File list",
    });
  }

  async formatForLlm({
    root,
  }: {
    focused: boolean;
    remainingFileCharacters: number;
    root: string;
  }): Promise<FormattedContextItem> {
    const fileListText = await readFileListForLlm({ root });
    return {
      consumedFileCharacters: 0,
      text: fileListText ?? "",
    };
  }

  withSummaryState(summaryState: ContextItemSummaryState): ContextItem {
    return new FileListContextItem(summaryState);
  }

  getPersistence(): ContextItemPersistence {
    return {
      kind: "ephemeral",
      reason: "File list is read from the current workspace.",
    };
  }

  getHistoryEvents(): readonly SessionEvent[] {
    return [];
  }
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function readCurrentDiff({
  maxBuffer,
  root,
}: {
  maxBuffer: number;
  root: string;
}): Promise<string> {
  return await readGitDiff({
    includeStaged: true,
    maxBuffer,
    root,
  });
}

async function readCurrentDiffForContext({
  root,
}: {
  root: string;
}): Promise<string> {
  try {
    return truncateContent(
      await readCurrentDiff({
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
  if (content.length <= maxCharacters) {
    return content;
  }

  return markTruncatedContent(content.slice(0, maxCharacters));
}

function markTruncatedContent(content: string): string {
  if (content.endsWith("[Context truncated.]")) {
    return content;
  }

  return `${content}\n[Context truncated.]`;
}
