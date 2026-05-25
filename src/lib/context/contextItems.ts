import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { PatchProposal } from "../patch/types";
import type {
  ContextItem,
  ContextItemAction,
  FilePath,
  FormattedContextItem,
  FormatContextItemForLlmOptions,
  LlmFileContext,
} from "../../types";

export const MAX_FILE_CONTEXT_CHARACTERS = 60_000;
export const MAX_TOTAL_FILE_CONTEXT_CHARACTERS = 200_000;
export const MAX_SAVED_CONTEXT_CHARACTERS = 60_000;
export const MAX_CONTEXT_ITEM_DETAIL_CHARACTERS = 20_000;

export class FileContextItem implements ContextItem {
  readonly id: string;
  readonly type = "file";

  constructor(readonly filePath: FilePath) {
    this.id = getFileContextItemId(filePath);
  }

  getListLabel(): string {
    return this.getSummaryView().title;
  }

  getSummaryView() {
    return {
      detail: "file",
      title: `@${this.filePath}`,
    };
  }

  getActions(): readonly ContextItemAction[] {
    return [openContextItemAction(this.id), removeContextItemAction(this.id)];
  }

  async getDetailView({ root }: { root: string }) {
    const file = await readFileContext({
      filePath: this.filePath,
      remainingFileCharacters: MAX_CONTEXT_ITEM_DETAIL_CHARACTERS,
      root,
    });

    return {
      content:
        file.status === "included"
          ? `${file.content}${file.truncated ? "\n[File truncated.]" : ""}`
          : (file.errorMessage ?? "Unable to read file."),
      kind: "text" as const,
      title: this.filePath,
    };
  }

  async formatForLlm({
    focused,
    remainingFileCharacters,
    root,
  }: FormatContextItemForLlmOptions): Promise<FormattedContextItem> {
    const file = await readFileContext({
      filePath: this.filePath,
      remainingFileCharacters,
      root,
    });

    return {
      consumedFileCharacters:
        file.status === "included" ? file.content.length : 0,
      file,
      text: formatFile(file, { focused }),
    };
  }
}

export class SavedLlmResponseContextItem implements ContextItem {
  readonly type = "llm-response";

  constructor(
    readonly id: string,
    readonly prompt: string,
    readonly output: string,
    readonly sourceRequestId: number,
    readonly createdAt: number,
  ) {}

  getListLabel(): string {
    return this.getSummaryView().title;
  }

  getSummaryView() {
    return {
      detail: summarize(this.output),
      title: `Prompt result: ${summarize(this.prompt)}`,
    };
  }

  getActions(): readonly ContextItemAction[] {
    return [
      openContextItemAction(this.id),
      rerunPromptAction({
        expectedResult: "text",
        prompt: this.prompt,
        replaceContextItemId: this.id,
      }),
      removeContextItemAction(this.id),
    ];
  }

  async getDetailView() {
    return {
      content: this.output,
      kind: "text" as const,
      title: `Output for: ${summarize(this.prompt)}`,
    };
  }

  async formatForLlm({
    focused,
  }: FormatContextItemForLlmOptions): Promise<FormattedContextItem> {
    return {
      consumedFileCharacters: 0,
      text: `<llm_response${formatAttributes({ focused, source_request_id: this.sourceRequestId, created_at: new Date(this.createdAt).toISOString() })}>\n<prompt>\n${truncateContent(this.prompt, MAX_SAVED_CONTEXT_CHARACTERS)}\n</prompt>\n<output>\n${truncateContent(this.output, MAX_SAVED_CONTEXT_CHARACTERS)}\n</output>\n</llm_response>`,
    };
  }
}

export class SavedDiffContextItem implements ContextItem {
  readonly type = "diff";

  constructor(
    readonly id: string,
    readonly prompt: string,
    readonly summary: string,
    readonly diffText: string,
    readonly proposal: PatchProposal,
    readonly sourceRequestId: number,
    readonly createdAt: number,
  ) {}

  getListLabel(): string {
    return this.getSummaryView().title;
  }

  getSummaryView() {
    return {
      detail: summarize(this.prompt),
      title: `Diff: ${this.summary.length > 0 ? this.summary : summarize(this.prompt)}`,
    };
  }

  getActions(): readonly ContextItemAction[] {
    return [
      openContextItemAction(this.id),
      applySavedDiffAction(this.id),
      rerunPromptAction({
        expectedResult: "diff",
        prompt: this.prompt,
        replaceContextItemId: this.id,
      }),
      removeContextItemAction(this.id),
    ];
  }

  async getDetailView() {
    return {
      diffText: this.diffText,
      kind: "diff" as const,
      summary: this.summary,
      title: `Diff: ${this.summary.length > 0 ? this.summary : summarize(this.prompt)}`,
    };
  }

  async formatForLlm({
    focused,
  }: FormatContextItemForLlmOptions): Promise<FormattedContextItem> {
    return {
      consumedFileCharacters: 0,
      text: `<saved_diff${formatAttributes({ focused, source_request_id: this.sourceRequestId, created_at: new Date(this.createdAt).toISOString() })}>\n<prompt>\n${truncateContent(this.prompt, MAX_SAVED_CONTEXT_CHARACTERS)}\n</prompt>\n<summary>\n${this.summary}\n</summary>\n<diff>\n${truncateContent(this.diffText, MAX_SAVED_CONTEXT_CHARACTERS)}\n</diff>\n</saved_diff>`,
    };
  }
}

export function createFileContextItem(filePath: FilePath): FileContextItem {
  return new FileContextItem(filePath);
}

export function createSavedLlmResponseContextItem({
  createdAt,
  id,
  output,
  prompt,
  sourceRequestId,
}: {
  createdAt: number;
  id: string;
  output: string;
  prompt: string;
  sourceRequestId: number;
}): SavedLlmResponseContextItem {
  return new SavedLlmResponseContextItem(
    id,
    prompt,
    output,
    sourceRequestId,
    createdAt,
  );
}

export function createSavedDiffContextItem({
  createdAt,
  diffText,
  id,
  prompt,
  proposal,
  sourceRequestId,
  summary,
}: {
  createdAt: number;
  diffText: string;
  id: string;
  prompt: string;
  proposal: PatchProposal;
  sourceRequestId: number;
  summary: string;
}): SavedDiffContextItem {
  return new SavedDiffContextItem(
    id,
    prompt,
    summary,
    diffText,
    proposal,
    sourceRequestId,
    createdAt,
  );
}

export function getFileContextItemId(filePath: FilePath): string {
  return `file:${filePath}`;
}

export function getSelectedFilePaths(
  contextItems: readonly ContextItem[],
): FilePath[] {
  return contextItems
    .filter((item): item is FileContextItem => item instanceof FileContextItem)
    .map((item) => item.filePath);
}

export function hasContextItem(
  contextItems: readonly ContextItem[],
  itemId: string,
): boolean {
  return contextItems.some((item) => item.id === itemId);
}

export function getContextItemById(
  contextItems: readonly ContextItem[],
  itemId: string | null,
): ContextItem | null {
  return contextItems.find((item) => item.id === itemId) ?? null;
}

function openContextItemAction(itemId: string): ContextItemAction {
  return {
    id: "open",
    key: "Ctrl+o",
    label: "open",
    run: (context) => context.openContextItem(itemId),
  };
}

function applySavedDiffAction(itemId: string): ContextItemAction {
  return {
    id: "apply",
    key: "Ctrl+y",
    label: "apply",
    run: (context) => context.applySavedDiff(itemId),
  };
}

function removeContextItemAction(itemId: string): ContextItemAction {
  return {
    id: "remove",
    key: "Ctrl+x",
    label: "remove",
    run: (context) => context.removeContextItem(itemId),
  };
}

function rerunPromptAction({
  expectedResult,
  prompt,
  replaceContextItemId,
}: {
  expectedResult: "diff" | "text";
  prompt: string;
  replaceContextItemId: string;
}): ContextItemAction {
  return {
    id: "rerun",
    key: "Ctrl+r",
    label: "rerun",
    run: (context) =>
      context.rerunPrompt({ expectedResult, prompt, replaceContextItemId }),
  };
}

async function readFileContext({
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

function formatFile(
  file: LlmFileContext,
  { focused }: { focused: boolean },
): string {
  const attributes = formatAttributes({
    path: file.filePath,
    focused,
    status: file.status === "skipped" ? "skipped" : undefined,
  });

  if (file.status === "skipped") {
    return `<file${attributes}>\n${file.errorMessage ?? "Skipped."}\n</file>`;
  }

  const truncatedNote = file.truncated
    ? "\n[File truncated because the selected file context limit was reached.]"
    : "";

  return `<file${attributes}>\n${file.content}${truncatedNote}\n</file>`;
}

function formatAttributes(
  attributes: Record<string, boolean | number | string | undefined>,
): string {
  const formatted = Object.entries(attributes)
    .filter(([, value]) => value !== undefined && value !== false)
    .map(([key, value]) =>
      value === true ? `${key}="true"` : `${key}=${JSON.stringify(value)}`,
    );

  return formatted.length === 0 ? "" : ` ${formatted.join(" ")}`;
}

function truncateContent(content: string, maxCharacters: number): string {
  if (content.length <= maxCharacters) {
    return content;
  }

  return `${content.slice(0, maxCharacters)}\n[Context truncated.]`;
}

function isInsideRoot(root: string, path: string): boolean {
  const relativePath = relative(root, path);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

function summarize(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= 60) {
    return normalized.length > 0 ? normalized : "Untitled";
  }

  return `${normalized.slice(0, 57)}…`;
}
