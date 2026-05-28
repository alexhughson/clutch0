import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type {
  AgentOutputBlock,
  AgentOutputUpdate,
} from "../agentOutput/agentOutputTypes";
import { applyAgentOutputUpdate } from "../agentOutput/agentOutputReducer";
import type { PatchProposal } from "../patch/types";
import type { ShellCommandResult } from "../shell/shellCommand";
import type {
  ContextItem,
  ContextItemAction,
  ContextItemSummaryState,
  FilePath,
  FormattedContextItem,
  FormatContextItemForLlmOptions,
  LlmFileContext,
} from "../../types";

export const MAX_FILE_CONTEXT_CHARACTERS = 60_000;
export const MAX_TOTAL_FILE_CONTEXT_CHARACTERS = 200_000;
export const MAX_SAVED_CONTEXT_CHARACTERS = 60_000;
export const MAX_CONTEXT_ITEM_DETAIL_CHARACTERS = 20_000;
export const MAX_CONTEXT_ITEM_SUMMARY_CHARACTERS = 30_000;

const MISSING_SUMMARY_STATE: ContextItemSummaryState = { status: "missing" };

export class FileContextItem implements ContextItem {
  readonly id: string;
  readonly type = "file";

  constructor(
    readonly filePath: FilePath,
    private readonly summaryState: ContextItemSummaryState = MISSING_SUMMARY_STATE,
  ) {
    this.id = getFileContextItemId(filePath);
  }

  getListLabel(): string {
    return this.getSummaryView().title;
  }

  getSummaryState(): ContextItemSummaryState {
    return this.summaryState;
  }

  getSummaryView() {
    return getGeneratedSummaryView(this.summaryState, {
      detail: "File context",
      title: `@${this.filePath}`,
    });
  }

  withSummaryState(summaryState: ContextItemSummaryState): FileContextItem {
    return new FileContextItem(this.filePath, summaryState);
  }

  getActions(): readonly ContextItemAction[] {
    return [openContextItemAction(this.id), removeContextItemAction(this.id)];
  }

  async getSummarizationInput({ root }: { root: string }) {
    const file = await readFileContext({
      filePath: this.filePath,
      remainingFileCharacters: MAX_CONTEXT_ITEM_SUMMARY_CHARACTERS,
      root,
    });
    const content =
      file.status === "included"
        ? file.content
        : (file.errorMessage ?? "Unable to read file.");
    const sourceText = `File: ${this.filePath}\nStatus: ${file.status}\n\n${content}`;

    return {
      content: sourceText,
      itemId: this.id,
      label: this.filePath,
      sourceHash: hashContent(sourceText),
      type: this.type,
    };
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
      filePath: this.filePath,
      kind: "code" as const,
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
    private readonly summaryState: ContextItemSummaryState = MISSING_SUMMARY_STATE,
  ) {}

  getListLabel(): string {
    return this.getSummaryView().title;
  }

  getSummaryState(): ContextItemSummaryState {
    return this.summaryState;
  }

  getSummaryView() {
    return getGeneratedSummaryView(this.summaryState, {
      detail: summarize(this.output),
      title: `Prompt result: ${summarize(this.prompt)}`,
    });
  }

  withSummaryState(
    summaryState: ContextItemSummaryState,
  ): SavedLlmResponseContextItem {
    return new SavedLlmResponseContextItem(
      this.id,
      this.prompt,
      this.output,
      this.sourceRequestId,
      this.createdAt,
      summaryState,
    );
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

  async getSummarizationInput() {
    const sourceText = `Prompt:\n${truncateContent(this.prompt, MAX_CONTEXT_ITEM_SUMMARY_CHARACTERS)}\n\nOutput:\n${truncateContent(this.output, MAX_CONTEXT_ITEM_SUMMARY_CHARACTERS)}`;

    return {
      content: sourceText,
      itemId: this.id,
      label: `Prompt result: ${summarize(this.prompt)}`,
      sourceHash: hashContent(sourceText),
      type: this.type,
    };
  }

  async getDetailView() {
    return {
      content: this.output,
      kind: "markdown" as const,
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

export class ShellCommandOutputContextItem implements ContextItem {
  readonly type = "shell-command-output";

  constructor(
    readonly id: string,
    readonly result: ShellCommandResult,
    readonly sourceRequestId: number,
    readonly createdAt: number,
    private readonly summaryState: ContextItemSummaryState = MISSING_SUMMARY_STATE,
  ) {}

  getListLabel(): string {
    return this.getSummaryView().title;
  }

  getSummaryState(): ContextItemSummaryState {
    return this.summaryState;
  }

  getSummaryView() {
    return getGeneratedSummaryView(this.summaryState, {
      detail: summarize(formatShellCommandOutput(this.result)),
      title: `Command: ${summarize(this.result.command)}`,
    });
  }

  withSummaryState(
    summaryState: ContextItemSummaryState,
  ): ShellCommandOutputContextItem {
    return new ShellCommandOutputContextItem(
      this.id,
      this.result,
      this.sourceRequestId,
      this.createdAt,
      summaryState,
    );
  }

  getActions(): readonly ContextItemAction[] {
    return [openContextItemAction(this.id), removeContextItemAction(this.id)];
  }

  async getSummarizationInput() {
    const sourceText = `Command:\n${truncateContent(this.result.command, MAX_CONTEXT_ITEM_SUMMARY_CHARACTERS)}\n\nOutput:\n${truncateContent(formatShellCommandOutput(this.result), MAX_CONTEXT_ITEM_SUMMARY_CHARACTERS)}`;

    return {
      content: sourceText,
      itemId: this.id,
      label: `Command: ${summarize(this.result.command)}`,
      sourceHash: hashContent(sourceText),
      type: this.type,
    };
  }

  async getDetailView() {
    return {
      content: formatShellCommandOutput(this.result),
      kind: "text" as const,
      title: `Command: ${summarize(this.result.command)}`,
    };
  }

  async formatForLlm({
    focused,
  }: FormatContextItemForLlmOptions): Promise<FormattedContextItem> {
    return {
      consumedFileCharacters: 0,
      text: `<shell_command_output${formatAttributes({ focused, source_request_id: this.sourceRequestId, created_at: new Date(this.createdAt).toISOString(), command: this.result.command, exit_code: this.result.exitCode ?? "signal", signal: this.result.signal })}>\n${truncateContent(formatShellCommandOutput(this.result), MAX_SAVED_CONTEXT_CHARACTERS)}\n</shell_command_output>`,
    };
  }
}

export class LiveLlmResponseContextItem implements ContextItem {
  readonly type = "llm-response-live";

  constructor(
    readonly id: string,
    readonly prompt: string,
    readonly output: string,
    readonly sourceRequestId: number,
    readonly createdAt: number,
    readonly status: "error" | "running",
    readonly errorMessage: string | undefined = undefined,
    private readonly summaryState: ContextItemSummaryState = MISSING_SUMMARY_STATE,
  ) {}

  getListLabel(): string {
    return this.getSummaryView().title;
  }

  getSummaryState(): ContextItemSummaryState {
    return this.summaryState;
  }

  getSummaryView() {
    return getGeneratedSummaryView(this.summaryState, {
      detail:
        this.status === "error"
          ? `Error: ${this.errorMessage ?? "Request failed."}`
          : summarize(this.output || "Waiting for response…"),
      title: `Running prompt: ${summarize(this.prompt)}`,
    });
  }

  withSummaryState(
    summaryState: ContextItemSummaryState,
  ): LiveLlmResponseContextItem {
    return new LiveLlmResponseContextItem(
      this.id,
      this.prompt,
      this.output,
      this.sourceRequestId,
      this.createdAt,
      this.status,
      this.errorMessage,
      summaryState,
    );
  }

  withOutput(output: string): LiveLlmResponseContextItem {
    return new LiveLlmResponseContextItem(
      this.id,
      this.prompt,
      output,
      this.sourceRequestId,
      this.createdAt,
      this.status,
      this.errorMessage,
      this.summaryState,
    );
  }

  withError(errorMessage: string): LiveLlmResponseContextItem {
    return new LiveLlmResponseContextItem(
      this.id,
      this.prompt,
      this.output,
      this.sourceRequestId,
      this.createdAt,
      "error",
      errorMessage,
      this.summaryState,
    );
  }

  getActions(): readonly ContextItemAction[] {
    return [openContextItemAction(this.id), removeContextItemAction(this.id)];
  }

  async getSummarizationInput() {
    if (this.status === "running") {
      return null;
    }

    const sourceText = `Prompt:\n${truncateContent(this.prompt, MAX_CONTEXT_ITEM_SUMMARY_CHARACTERS)}\n\nStatus: ${this.status}\n\nOutput:\n${truncateContent(this.output, MAX_CONTEXT_ITEM_SUMMARY_CHARACTERS)}\n\nError:\n${this.errorMessage ?? ""}`;

    return {
      content: sourceText,
      itemId: this.id,
      label: `Prompt result: ${summarize(this.prompt)}`,
      sourceHash: hashContent(sourceText),
      type: this.type,
    };
  }

  async getDetailView() {
    const statusLine =
      this.status === "running"
        ? "[Request still running.]"
        : `[Request failed: ${this.errorMessage ?? "unknown error"}]`;

    return {
      content: `${statusLine}\n\n${this.output}`,
      kind: "markdown" as const,
      title: `Running prompt: ${summarize(this.prompt)}`,
    };
  }

  async formatForLlm({
    focused,
  }: FormatContextItemForLlmOptions): Promise<FormattedContextItem> {
    return {
      consumedFileCharacters: 0,
      text: `<live_llm_response${formatAttributes({ focused, source_request_id: this.sourceRequestId, created_at: new Date(this.createdAt).toISOString(), status: this.status })}>\n<prompt>\n${truncateContent(this.prompt, MAX_SAVED_CONTEXT_CHARACTERS)}\n</prompt>\n<output>\n${truncateContent(this.output, MAX_SAVED_CONTEXT_CHARACTERS)}\n</output>\n${this.errorMessage === undefined ? "" : `<error>\n${truncateContent(this.errorMessage, MAX_SAVED_CONTEXT_CHARACTERS)}\n</error>\n`}</live_llm_response>`,
    };
  }
}

export class PiAgentContextItem implements ContextItem {
  readonly type = "pi-agent";

  constructor(
    readonly id: string,
    readonly prompt: string,
    readonly blocks: readonly AgentOutputBlock[],
    readonly status: "error" | "idle" | "running",
    readonly createdAt: number,
    readonly errorMessage: string | undefined = undefined,
    private readonly summaryState: ContextItemSummaryState = MISSING_SUMMARY_STATE,
  ) {}

  getListLabel(): string {
    return this.getSummaryView().title;
  }

  getSummaryState(): ContextItemSummaryState {
    return this.summaryState;
  }

  getSummaryView() {
    return getGeneratedSummaryView(this.summaryState, {
      detail:
        this.status === "running"
          ? "Agent is running…"
          : summarize(formatAgentOutputBlocks(this.blocks)),
      title: `Agent: ${summarize(this.prompt)}`,
    });
  }

  withSummaryState(summaryState: ContextItemSummaryState): PiAgentContextItem {
    return new PiAgentContextItem(
      this.id,
      this.prompt,
      this.blocks,
      this.status,
      this.createdAt,
      this.errorMessage,
      summaryState,
    );
  }

  withAgentOutputUpdate(update: AgentOutputUpdate): PiAgentContextItem {
    return new PiAgentContextItem(
      this.id,
      this.prompt,
      applyAgentOutputUpdate(this.blocks, update),
      this.status,
      this.createdAt,
      this.errorMessage,
      this.summaryState,
    );
  }

  withStatus(
    status: "error" | "idle" | "running",
    errorMessage?: string,
  ): PiAgentContextItem {
    return new PiAgentContextItem(
      this.id,
      this.prompt,
      this.blocks,
      status,
      this.createdAt,
      errorMessage,
      this.summaryState,
    );
  }

  getActions(): readonly ContextItemAction[] {
    return [openContextItemAction(this.id), removeContextItemAction(this.id)];
  }

  async getSummarizationInput() {
    if (this.status === "running") {
      return null;
    }

    const output = formatAgentOutputBlocks(this.blocks);
    if (output.trim().length === 0 && this.errorMessage === undefined) {
      return null;
    }

    const sourceText = `Prompt:\n${truncateContent(this.prompt, MAX_CONTEXT_ITEM_SUMMARY_CHARACTERS)}\n\nStatus: ${this.status}\n\nOutput:\n${truncateContent(output, MAX_CONTEXT_ITEM_SUMMARY_CHARACTERS)}\n\nError:\n${this.errorMessage ?? ""}`;

    return {
      content: sourceText,
      itemId: this.id,
      label: `Agent: ${summarize(this.prompt)}`,
      sourceHash: hashContent(sourceText),
      type: this.type,
    };
  }

  async getDetailView() {
    return {
      blocks: this.blocks,
      errorMessage: this.errorMessage,
      itemId: this.id,
      kind: "agent-output" as const,
      prompt: this.prompt,
      status: this.status,
      title: `Agent: ${summarize(this.prompt)}`,
    };
  }

  async formatForLlm({
    focused,
  }: FormatContextItemForLlmOptions): Promise<FormattedContextItem> {
    const latestMessage = getLatestAgentAssistantMessage(this.blocks);

    return {
      consumedFileCharacters: 0,
      text: `<pi_agent_session${formatAttributes({ focused, created_at: new Date(this.createdAt).toISOString(), status: this.status })}>\n<prompt>\n${truncateContent(this.prompt, MAX_SAVED_CONTEXT_CHARACTERS)}\n</prompt>\n<latest_agent_message>\n${truncateContent(latestMessage ?? "No agent message yet.", MAX_SAVED_CONTEXT_CHARACTERS)}\n</latest_agent_message>\n</pi_agent_session>`,
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
    private readonly summaryState: ContextItemSummaryState = MISSING_SUMMARY_STATE,
  ) {}

  getListLabel(): string {
    return this.getSummaryView().title;
  }

  getSummaryState(): ContextItemSummaryState {
    return this.summaryState;
  }

  getSummaryView() {
    return getGeneratedSummaryView(this.summaryState, {
      detail: summarize(this.prompt),
      title: `Diff: ${this.summary.length > 0 ? this.summary : summarize(this.prompt)}`,
    });
  }

  withSummaryState(
    summaryState: ContextItemSummaryState,
  ): SavedDiffContextItem {
    return new SavedDiffContextItem(
      this.id,
      this.prompt,
      this.summary,
      this.diffText,
      this.proposal,
      this.sourceRequestId,
      this.createdAt,
      summaryState,
    );
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

  async getSummarizationInput() {
    const sourceText = `Prompt:\n${truncateContent(this.prompt, MAX_CONTEXT_ITEM_SUMMARY_CHARACTERS)}\n\nSummary:\n${truncateContent(this.summary, MAX_CONTEXT_ITEM_SUMMARY_CHARACTERS)}\n\nDiff:\n${truncateContent(this.diffText, MAX_CONTEXT_ITEM_SUMMARY_CHARACTERS)}`;

    return {
      content: sourceText,
      itemId: this.id,
      label: `Diff: ${this.summary.length > 0 ? this.summary : summarize(this.prompt)}`,
      sourceHash: hashContent(sourceText),
      type: this.type,
    };
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

export function createLiveLlmResponseContextItem({
  createdAt,
  id,
  output = "",
  prompt,
  sourceRequestId,
}: {
  createdAt: number;
  id: string;
  output?: string;
  prompt: string;
  sourceRequestId: number;
}): LiveLlmResponseContextItem {
  return new LiveLlmResponseContextItem(
    id,
    prompt,
    output,
    sourceRequestId,
    createdAt,
    "running",
  );
}

export function createPiAgentContextItem({
  createdAt,
  id,
  prompt,
}: {
  createdAt: number;
  id: string;
  prompt: string;
}): PiAgentContextItem {
  return new PiAgentContextItem(id, prompt, [], "running", createdAt);
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

export function createShellCommandOutputContextItem({
  createdAt,
  id,
  result,
  sourceRequestId,
}: {
  createdAt: number;
  id: string;
  result: ShellCommandResult;
  sourceRequestId: number;
}): ShellCommandOutputContextItem {
  return new ShellCommandOutputContextItem(
    id,
    result,
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

function getLatestAgentAssistantMessage(
  blocks: readonly AgentOutputBlock[],
): string | null {
  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    const block = blocks[index];
    if (block?.kind === "stream" && block.streamKind === "assistant") {
      return block.text;
    }
  }

  return null;
}

function formatAgentOutputBlocks(blocks: readonly AgentOutputBlock[]): string {
  return blocks
    .map((block) => {
      if (block.kind === "status") {
        return block.message;
      }

      if (block.kind === "tool") {
        const suffix = block.summary.length === 0 ? "" : `: ${block.summary}`;
        return `tool ${block.toolName} ${block.phase}${suffix}`;
      }

      return `${block.streamKind}: ${block.text}`;
    })
    .join("\n");
}

function formatShellCommandOutput(result: ShellCommandResult): string {
  const metadata = [
    `$ ${result.command}`,
    `exit code: ${result.exitCode ?? "signal"}`,
    result.signal === undefined ? null : `signal: ${result.signal}`,
    `duration: ${result.durationMs}ms`,
    result.timedOut ? "timed out" : null,
    result.truncated ? "output truncated" : null,
  ].filter((line): line is string => line !== null);

  return `${metadata.join("\n")}\n\nstdout:\n${result.stdout}\n\nstderr:\n${result.stderr}`;
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

function getGeneratedSummaryView(
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

function summarize(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= 60) {
    return normalized.length > 0 ? normalized : "Untitled";
  }

  return `${normalized.slice(0, 57)}…`;
}
