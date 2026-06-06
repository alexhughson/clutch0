import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadFileList } from "../fileListLoader";
import { isNotGitRepositoryError, readGitDiff } from "../git/gitDiff";
import type {
  ContextItem,
  ContextItemAction,
  ContextItemDetailView,
  ContextItemSummaryState,
  FormattedContextItem,
} from "../../types";

const MISSING_SUMMARY_STATE: ContextItemSummaryState = { status: "missing" };

export const AGENTS_CONTEXT_ITEM_ID = "builtin:agents";
export const FILE_LIST_CONTEXT_ITEM_ID = "builtin:file-list";
export const UNSTAGED_CHANGES_CONTEXT_ITEM_ID = "builtin:unstaged-changes";

const MAX_UNSTAGED_CHANGES_DETAIL_CHARACTERS = 120_000;

let automaticContextItems: readonly ContextItem[] | null = null;

export function createAutomaticContextItems(): ContextItem[] {
  return [
    new AgentsContextItem(),
    new UnstagedChangesContextItem(),
    new FileListContextItem(),
  ];
}

export function getAutomaticContextItems(): readonly ContextItem[] {
  automaticContextItems ??= createAutomaticContextItems();
  return automaticContextItems;
}

export function getVisibleContextItems(
  contextItems: readonly ContextItem[],
  automaticContextItems: readonly ContextItem[] = getAutomaticContextItems(),
): readonly ContextItem[] {
  return [...automaticContextItems, ...contextItems];
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

class AgentsContextItem implements ContextItem {
  readonly id = AGENTS_CONTEXT_ITEM_ID;
  readonly type = "automatic-agents";

  constructor(
    private readonly summaryState: ContextItemSummaryState = MISSING_SUMMARY_STATE,
  ) {}

  getActions(): readonly ContextItemAction[] {
    return [openContextItemAction(this.id)];
  }

  async getDetailView({
    root,
  }: {
    root: string;
  }): Promise<ContextItemDetailView> {
    try {
      return {
        content: await readFile(resolve(root, "AGENTS.md"), "utf8"),
        kind: "markdown",
        title: "AGENTS.md",
      };
    } catch (error) {
      if (isFileNotFoundError(error)) {
        return {
          content: "No AGENTS.md file exists in this workspace.",
          kind: "text",
          title: "AGENTS.md",
        };
      }

      throw error;
    }
  }

  getListLabel(): string {
    return "AGENTS.md";
  }

  async getSummarizationInput({ root }: { root: string }) {
    try {
      const content = await readFile(resolve(root, "AGENTS.md"), "utf8");
      if (content.trim().length === 0) {
        return null;
      }

      const sourceText = `AGENTS.md\n\n${content}`;
      return {
        content: sourceText,
        itemId: this.id,
        label: "AGENTS.md",
        sourceHash: hashContent(sourceText),
        type: this.type,
      };
    } catch (error) {
      if (isFileNotFoundError(error)) {
        return null;
      }

      throw error;
    }
  }

  getSummaryState(): ContextItemSummaryState {
    return this.summaryState;
  }

  getSummaryView() {
    return getAutomaticSummaryView(this.summaryState, {
      detail: "Automatically included instructions for LLM requests.",
      title: "AGENTS.md",
    });
  }

  async formatForLlm(): Promise<FormattedContextItem> {
    return {
      consumedFileCharacters: 0,
      text: "",
    };
  }

  withSummaryState(summaryState: ContextItemSummaryState): ContextItem {
    return new AgentsContextItem(summaryState);
  }
}

class UnstagedChangesContextItem implements ContextItem {
  readonly id = UNSTAGED_CHANGES_CONTEXT_ITEM_ID;
  readonly type = "automatic-unstaged-changes";

  constructor(
    private readonly summaryState: ContextItemSummaryState = MISSING_SUMMARY_STATE,
  ) {}

  getActions(): readonly ContextItemAction[] {
    return [openContextItemAction(this.id)];
  }

  async getDetailView({
    root,
  }: {
    root: string;
  }): Promise<ContextItemDetailView> {
    let diffText: string;
    try {
      diffText = await readUnstagedChanges({ root });
    } catch (error) {
      if (isNotGitRepositoryError(error)) {
        diffText = "";
      } else {
        return gitDiffErrorDetail(error);
      }
    }

    if (diffText.trim().length === 0) {
      return {
        content: "No unstaged changes.",
        kind: "text",
        title: "Unstaged changes",
      };
    }

    return {
      diffText,
      kind: "diff",
      summary: "Unstaged working tree diff.",
      title: "Unstaged changes",
    };
  }

  getListLabel(): string {
    return "Unstaged changes";
  }

  async getSummarizationInput({ root }: { root: string }) {
    let diffText: string;
    try {
      diffText = await readUnstagedChanges({ root });
    } catch (error) {
      if (isNotGitRepositoryError(error)) {
        return null;
      }

      throw error;
    }

    if (diffText.trim().length === 0) {
      return null;
    }

    const sourceText = `Unstaged changes\n\n${diffText}`;
    return {
      content: sourceText,
      itemId: this.id,
      label: "Unstaged changes",
      sourceHash: hashContent(sourceText),
      type: this.type,
    };
  }

  getSummaryState(): ContextItemSummaryState {
    return this.summaryState;
  }

  getSummaryView() {
    return getAutomaticSummaryView(this.summaryState, {
      detail: "Git unstaged changes automatically included in LLM requests.",
      title: "Unstaged changes",
    });
  }

  async formatForLlm(): Promise<FormattedContextItem> {
    return {
      consumedFileCharacters: 0,
      text: "",
    };
  }

  withSummaryState(summaryState: ContextItemSummaryState): ContextItem {
    return new UnstagedChangesContextItem(summaryState);
  }
}

class FileListContextItem implements ContextItem {
  readonly id = FILE_LIST_CONTEXT_ITEM_ID;
  readonly type = "automatic-file-list";

  constructor(
    private readonly summaryState: ContextItemSummaryState = MISSING_SUMMARY_STATE,
  ) {}

  getActions(): readonly ContextItemAction[] {
    return [openContextItemAction(this.id)];
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
    return getAutomaticSummaryView(this.summaryState, {
      detail: "Git-aware file list automatically included in LLM requests.",
      title: "File list",
    });
  }

  async formatForLlm(): Promise<FormattedContextItem> {
    return {
      consumedFileCharacters: 0,
      text: "",
    };
  }

  withSummaryState(summaryState: ContextItemSummaryState): ContextItem {
    return new FileListContextItem(summaryState);
  }
}

function getAutomaticSummaryView(
  summaryState: ContextItemSummaryState,
  fallback: { detail: string; title: string },
) {
  if (summaryState.status === "ready") {
    return {
      detail: summaryState.summary.details,
      label: fallback.title,
      status: summaryState.status,
      title: summaryState.summary.oneLine,
    };
  }

  if (summaryState.status === "pending") {
    return {
      detail: "Summarizing…",
      label: fallback.title,
      status: summaryState.status,
      title: fallback.title,
    };
  }

  if (summaryState.status === "error") {
    return {
      detail: `Summary unavailable: ${summaryState.errorMessage}`,
      label: fallback.title,
      status: summaryState.status,
      title: fallback.title,
    };
  }

  return {
    ...fallback,
    label: fallback.title,
    status: summaryState.status,
  };
}

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function readUnstagedChanges({
  root,
}: {
  root: string;
}): Promise<string> {
  return readGitDiff({
    includeStaged: false,
    maxBuffer: MAX_UNSTAGED_CHANGES_DETAIL_CHARACTERS * 2,
    root,
  });
}

function gitDiffErrorDetail(error: unknown): ContextItemDetailView {
  return {
    content: `Unable to read unstaged changes.\n\n${formatUnknownError(error)}`,
    kind: "text",
    title: "Unstaged changes",
  };
}

function formatUnknownError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function openContextItemAction(itemId: string): ContextItemAction {
  return {
    id: "open",
    label: "open",
    shortcut: { ctrl: true, display: "Ctrl+o", name: "o" },
    run: (context) => context.openContextItem(itemId),
  };
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}
