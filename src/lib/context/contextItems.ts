import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { AgentHarnessPersistence } from "../agent/harnessTypes";
import type {
  AgentOutputBlock,
  AgentOutputUpdate,
} from "../agentOutput/agentOutputTypes";
import { applyAgentOutputUpdate } from "../agentOutput/agentOutputReducer";
import {
  getPatchProposalPaths,
  patchProposalFromLegacyEdits,
} from "../patch/patchEngine";
import type { PatchProposal } from "../patch/types";
import type { ShellCommandResult } from "../shell/shellCommand";
import type {
  AgentSandboxContext,
  ContextItem,
  ContextItemAction,
  ContextItemDetailView,
  ContextItemPersistence,
  ContextItemState,
  ContextItemSummaryState,
  FilePath,
  FormattedContextItem,
  FormatContextItemForLlmOptions,
  LlmFileContext,
  SessionEvent,
} from "../../types";
import {
  applyDiffAction,
  openContextItemAction,
} from "./contextItemActions";
import {
  formatAgentOutputBlocks,
  formatAttributes,
  formatFile,
  formatShellCommandOutput,
  getGeneratedSummaryView,
  getLatestAgentAssistantMessage,
  hashContent,
  MAX_CONTEXT_ITEM_DETAIL_CHARACTERS,
  MAX_CONTEXT_ITEM_SUMMARY_CHARACTERS,
  MAX_FILE_CONTEXT_CHARACTERS,
  MAX_SAVED_CONTEXT_CHARACTERS,
  safeJsonStringify,
  summarize,
  truncateContent,
} from "./contextItemFormatting";

export {
  MAX_CONTEXT_ITEM_DETAIL_CHARACTERS,
  MAX_CONTEXT_ITEM_SUMMARY_CHARACTERS,
  MAX_FILE_CONTEXT_CHARACTERS,
  MAX_SAVED_CONTEXT_CHARACTERS,
  MAX_TOTAL_FILE_CONTEXT_CHARACTERS,
} from "./contextItemFormatting";

const MISSING_SUMMARY_STATE: ContextItemSummaryState = { status: "missing" };

type BaseContextItemState<Type extends string> = ContextItemState & {
  schemaVersion: 1;
  type: Type;
};

export type FileContextItemState = BaseContextItemState<"file"> & {
  filePath: FilePath;
};

export type SavedLlmResponseContextItemState =
  BaseContextItemState<"llm-response"> & {
    createdAt: number;
    output: string;
    prompt: string;
    sourceRequestId: number;
  };

export type ShellCommandOutputContextItemState =
  BaseContextItemState<"shell-command-output"> & {
    createdAt: number;
    result: ShellCommandResult;
    sourceRequestId: number;
  };

export type UserTextContextItemState = BaseContextItemState<"user-text"> & {
  createdAt: number;
  text: string;
};

export type LiveLlmResponseContextItemState =
  BaseContextItemState<"llm-response-live"> & {
    createdAt: number;
    errorMessage?: string;
    output: string;
    prompt: string;
    sourceRequestId: number;
    status: "error" | "running";
  };

export type PiAgentSessionAvailability = "detached" | "live";

export type PiAgentContextItemState = BaseContextItemState<"pi-agent"> & {
  blocks: readonly AgentOutputBlock[];
  createdAt: number;
  errorMessage?: string;
  harness?: AgentHarnessPersistence;
  prompt: string;
  sandbox?: AgentSandboxContext;
  sessionAvailability: PiAgentSessionAvailability;
  status: "error" | "idle" | "running";
};

export type SavedDiffContextItemState = BaseContextItemState<"diff"> & {
  createdAt: number;
  diffText: string;
  prompt: string;
  proposal: PatchProposal;
  sourceRequestId: number;
  summary: string;
};

export type SavedAgentSandboxDiffContextItemState =
  BaseContextItemState<"agent-sandbox-diff"> & {
    createdAt: number;
    diffText: string;
    prompt: string;
    sourceAgentItemId: string;
    summary: string;
  };

export type PersistentContextItemState =
  | FileContextItemState
  | LiveLlmResponseContextItemState
  | PiAgentContextItemState
  | SavedAgentSandboxDiffContextItemState
  | SavedDiffContextItemState
  | SavedLlmResponseContextItemState
  | ShellCommandOutputContextItemState
  | UserTextContextItemState;

function persistentContextItemState<State extends PersistentContextItemState>(
  snapshot: State,
): ContextItemPersistence<State> {
  return { kind: "persistent", snapshot };
}

type ContextItemRestorer = (snapshot: unknown) => ContextItem;

function contextItemCreatedOrReplacedEvents(
  item: ContextItem,
  previous: ContextItem | null,
): readonly SessionEvent[] | null {
  if (previous === null) {
    return [
      {
        at: Date.now(),
        details: { type: item.type },
        itemId: item.id,
        kind: "context-item.created",
        schemaVersion: 1,
      },
    ];
  }

  if (previous.type !== item.type) {
    return [
      {
        at: Date.now(),
        details: { fromType: previous.type, toType: item.type },
        itemId: item.id,
        kind: "context-item.replaced",
        schemaVersion: 1,
      },
    ];
  }

  return null;
}

function fieldChanged(
  previous: Record<string, unknown>,
  next: Record<string, unknown>,
  field: string,
): boolean {
  return safeJsonStringify(previous[field]) !== safeJsonStringify(next[field]);
}

function stateUpdatedEvent({
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

export class FileContextItem implements ContextItem<FileContextItemState> {
  readonly id: string;
  readonly type = "file";

  constructor(readonly state: FileContextItemState) {
    this.id = state.id;
  }

  get filePath(): FilePath {
    return this.state.filePath;
  }

  getListLabel(): string {
    return this.getSummaryView().title;
  }

  getSummaryState(): ContextItemSummaryState {
    return this.state.summaryState;
  }

  getSummaryView() {
    return getGeneratedSummaryView(this.state.summaryState, {
      detail: "File context",
      title: `@${this.filePath}`,
    });
  }

  withSummaryState(summaryState: ContextItemSummaryState): FileContextItem {
    return new FileContextItem({ ...this.state, summaryState });
  }

  getPersistence(): ContextItemPersistence<FileContextItemState> {
    return persistentContextItemState(this.state);
  }

  getHistoryEvents(previous: ContextItem | null): readonly SessionEvent[] {
    const baseEvents = contextItemCreatedOrReplacedEvents(this, previous);
    if (baseEvents !== null) {
      return baseEvents;
    }

    if (!(previous instanceof FileContextItem)) {
      return [];
    }

    return fieldChanged(previous.state, this.state, "summaryState")
      ? [stateUpdatedEvent({ item: this, kind: "file.summary-updated" })]
      : [];
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

  static restore(snapshot: unknown): FileContextItem {
    const record = parseContextItemStateBase(snapshot, "file");
    return new FileContextItem({
      ...record,
      filePath: assertString(record.raw.filePath, "file.filePath"),
      type: "file",
    });
  }
}

export class SavedLlmResponseContextItem implements ContextItem<SavedLlmResponseContextItemState> {
  readonly type = "llm-response";

  constructor(readonly state: SavedLlmResponseContextItemState) {}

  get id(): string {
    return this.state.id;
  }

  get prompt(): string {
    return this.state.prompt;
  }

  get output(): string {
    return this.state.output;
  }

  get sourceRequestId(): number {
    return this.state.sourceRequestId;
  }

  get createdAt(): number {
    return this.state.createdAt;
  }

  getListLabel(): string {
    return this.getSummaryView().title;
  }

  getSummaryState(): ContextItemSummaryState {
    return this.state.summaryState;
  }

  getSummaryView() {
    return getGeneratedSummaryView(this.state.summaryState, {
      detail: summarize(this.output),
      title: `Prompt result: ${summarize(this.prompt)}`,
    });
  }

  withSummaryState(
    summaryState: ContextItemSummaryState,
  ): SavedLlmResponseContextItem {
    return new SavedLlmResponseContextItem({ ...this.state, summaryState });
  }

  getPersistence(): ContextItemPersistence<SavedLlmResponseContextItemState> {
    return persistentContextItemState(this.state);
  }

  getHistoryEvents(previous: ContextItem | null): readonly SessionEvent[] {
    const baseEvents = contextItemCreatedOrReplacedEvents(this, previous);
    if (baseEvents !== null) {
      return baseEvents;
    }

    if (!(previous instanceof SavedLlmResponseContextItem)) {
      return [];
    }

    const events: SessionEvent[] = [];
    if (previous.output !== this.output) {
      events.push(
        stateUpdatedEvent({
          details: {
            outputLength: this.output.length,
            previousOutputLength: previous.output.length,
          },
          item: this,
          kind: "llm-response.output-updated",
        }),
      );
    }
    if (fieldChanged(previous.state, this.state, "summaryState")) {
      events.push(
        stateUpdatedEvent({ item: this, kind: "llm-response.summary-updated" }),
      );
    }

    return events;
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
      text: `<answer${formatAttributes({ focused, source_request_id: this.sourceRequestId, created_at: new Date(this.createdAt).toISOString() })}>\n<question>\n${truncateContent(this.prompt, MAX_SAVED_CONTEXT_CHARACTERS)}\n</question>\n<response>\n${truncateContent(this.output, MAX_SAVED_CONTEXT_CHARACTERS)}\n</response>\n</answer>`,
    };
  }

  static restore(snapshot: unknown): SavedLlmResponseContextItem {
    const record = parseContextItemStateBase(snapshot, "llm-response");
    return new SavedLlmResponseContextItem({
      ...record,
      createdAt: assertNumber(record.raw.createdAt, "llm-response.createdAt"),
      output: assertString(record.raw.output, "llm-response.output"),
      prompt: assertString(record.raw.prompt, "llm-response.prompt"),
      sourceRequestId: assertNumber(
        record.raw.sourceRequestId,
        "llm-response.sourceRequestId",
      ),
      type: "llm-response",
    });
  }
}

export class ShellCommandOutputContextItem implements ContextItem<ShellCommandOutputContextItemState> {
  readonly type = "shell-command-output";

  constructor(readonly state: ShellCommandOutputContextItemState) {}

  get id(): string {
    return this.state.id;
  }

  get result(): ShellCommandResult {
    return this.state.result;
  }

  get sourceRequestId(): number {
    return this.state.sourceRequestId;
  }

  get createdAt(): number {
    return this.state.createdAt;
  }

  getListLabel(): string {
    return this.getSummaryView().title;
  }

  getSummaryState(): ContextItemSummaryState {
    return this.state.summaryState;
  }

  getSummaryView() {
    return getGeneratedSummaryView(this.state.summaryState, {
      detail: summarize(formatShellCommandOutput(this.result)),
      title: `Command: ${summarize(this.result.command)}`,
    });
  }

  withSummaryState(
    summaryState: ContextItemSummaryState,
  ): ShellCommandOutputContextItem {
    return new ShellCommandOutputContextItem({ ...this.state, summaryState });
  }

  getPersistence(): ContextItemPersistence<ShellCommandOutputContextItemState> {
    return persistentContextItemState(this.state);
  }

  getHistoryEvents(previous: ContextItem | null): readonly SessionEvent[] {
    const baseEvents = contextItemCreatedOrReplacedEvents(this, previous);
    if (baseEvents !== null) {
      return baseEvents;
    }

    if (!(previous instanceof ShellCommandOutputContextItem)) {
      return [];
    }

    return previous.result !== this.result
      ? [
          stateUpdatedEvent({
            details: {
              command: this.result.command,
              exitCode: this.result.exitCode,
              stderrLength: this.result.stderr.length,
              stdoutLength: this.result.stdout.length,
            },
            item: this,
            kind: "shell-command-output.result-updated",
          }),
        ]
      : [];
  }

  getActions(): readonly ContextItemAction[] {
    return [
      openContextItemAction(this.id),
      rerunShellCommandAction({
        command: this.result.command,
        replaceContextItemId: this.id,
      }),
      removeContextItemAction(this.id),
    ];
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
      text: `<shell_command${formatAttributes({ focused, source_request_id: this.sourceRequestId, created_at: new Date(this.createdAt).toISOString(), exit_code: this.result.exitCode ?? "signal", signal: this.result.signal })}>\n<command>\n${truncateContent(this.result.command, MAX_SAVED_CONTEXT_CHARACTERS)}\n</command>\n<output>\n${truncateContent(formatShellCommandOutput(this.result), MAX_SAVED_CONTEXT_CHARACTERS)}\n</output>\n</shell_command>`,
    };
  }

  static restore(snapshot: unknown): ShellCommandOutputContextItem {
    const record = parseContextItemStateBase(snapshot, "shell-command-output");
    return new ShellCommandOutputContextItem({
      ...record,
      createdAt: assertNumber(
        record.raw.createdAt,
        "shell-command-output.createdAt",
      ),
      result: parseShellCommandResult(
        record.raw.result,
        "shell-command-output.result",
      ),
      sourceRequestId: assertNumber(
        record.raw.sourceRequestId,
        "shell-command-output.sourceRequestId",
      ),
      type: "shell-command-output",
    });
  }
}

export class UserTextContextItem implements ContextItem<UserTextContextItemState> {
  readonly type = "user-text";

  constructor(readonly state: UserTextContextItemState) {}

  get id(): string {
    return this.state.id;
  }

  get text(): string {
    return this.state.text;
  }

  get createdAt(): number {
    return this.state.createdAt;
  }

  getListLabel(): string {
    return this.getSummaryView().title;
  }

  getSummaryState(): ContextItemSummaryState {
    return this.state.summaryState;
  }

  getSummaryView() {
    return getGeneratedSummaryView(this.state.summaryState, {
      detail: summarize(this.text),
      title: `User text: ${summarize(this.text)}`,
    });
  }

  withSummaryState(summaryState: ContextItemSummaryState): UserTextContextItem {
    return new UserTextContextItem({ ...this.state, summaryState });
  }

  withText(text: string): UserTextContextItem {
    return new UserTextContextItem({
      ...this.state,
      summaryState: MISSING_SUMMARY_STATE,
      text,
    });
  }

  getPersistence(): ContextItemPersistence<UserTextContextItemState> {
    return persistentContextItemState(this.state);
  }

  getHistoryEvents(previous: ContextItem | null): readonly SessionEvent[] {
    const baseEvents = contextItemCreatedOrReplacedEvents(this, previous);
    if (baseEvents !== null) {
      return baseEvents;
    }

    if (!(previous instanceof UserTextContextItem)) {
      return [];
    }

    const events: SessionEvent[] = [];
    if (previous.text !== this.text) {
      events.push(
        stateUpdatedEvent({
          details: {
            previousTextLength: previous.text.length,
            textLength: this.text.length,
          },
          item: this,
          kind: "user-text.edited",
        }),
      );
    }
    if (fieldChanged(previous.state, this.state, "summaryState")) {
      events.push(
        stateUpdatedEvent({ item: this, kind: "user-text.summary-updated" }),
      );
    }

    return events;
  }

  getActions(): readonly ContextItemAction[] {
    return [openContextItemAction(this.id), removeContextItemAction(this.id)];
  }

  async getSummarizationInput() {
    return null;
  }

  getLiveDetailView(): Extract<
    ContextItemDetailView,
    { kind: "editable-text" }
  > {
    return {
      content: this.text,
      itemId: this.id,
      kind: "editable-text" as const,
      title: "User text",
    };
  }

  async getDetailView() {
    return this.getLiveDetailView();
  }

  async formatForLlm({
    focused,
  }: FormatContextItemForLlmOptions): Promise<FormattedContextItem> {
    return {
      consumedFileCharacters: 0,
      text: `<note${formatAttributes({ focused, created_at: new Date(this.createdAt).toISOString() })}>\n${truncateContent(this.text, MAX_SAVED_CONTEXT_CHARACTERS)}\n</note>`,
    };
  }

  static restore(snapshot: unknown): UserTextContextItem {
    const record = parseContextItemStateBase(snapshot, "user-text");
    return new UserTextContextItem({
      ...record,
      createdAt: assertNumber(record.raw.createdAt, "user-text.createdAt"),
      text: assertString(record.raw.text, "user-text.text"),
      type: "user-text",
    });
  }
}

export class LiveLlmResponseContextItem implements ContextItem<LiveLlmResponseContextItemState> {
  readonly type = "llm-response-live";

  constructor(readonly state: LiveLlmResponseContextItemState) {}

  get id(): string {
    return this.state.id;
  }

  get prompt(): string {
    return this.state.prompt;
  }

  get output(): string {
    return this.state.output;
  }

  get sourceRequestId(): number {
    return this.state.sourceRequestId;
  }

  get createdAt(): number {
    return this.state.createdAt;
  }

  get status(): "error" | "running" {
    return this.state.status;
  }

  get errorMessage(): string | undefined {
    return this.state.errorMessage;
  }

  getListLabel(): string {
    return this.getSummaryView().title;
  }

  getSummaryState(): ContextItemSummaryState {
    return this.state.summaryState;
  }

  getSummaryView() {
    return getGeneratedSummaryView(this.state.summaryState, {
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
    return new LiveLlmResponseContextItem({ ...this.state, summaryState });
  }

  withOutput(output: string): LiveLlmResponseContextItem {
    return new LiveLlmResponseContextItem({ ...this.state, output });
  }

  withError(errorMessage: string): LiveLlmResponseContextItem {
    return new LiveLlmResponseContextItem({
      ...this.state,
      errorMessage,
      status: "error",
    });
  }

  getPersistence(): ContextItemPersistence<LiveLlmResponseContextItemState> {
    return persistentContextItemState(this.state);
  }

  getHistoryEvents(previous: ContextItem | null): readonly SessionEvent[] {
    const baseEvents = contextItemCreatedOrReplacedEvents(this, previous);
    if (baseEvents !== null) {
      return baseEvents;
    }

    if (!(previous instanceof LiveLlmResponseContextItem)) {
      return [];
    }

    const events: SessionEvent[] = [];
    if (previous.output !== this.output) {
      events.push(
        stateUpdatedEvent({
          details: {
            outputLength: this.output.length,
            previousOutputLength: previous.output.length,
          },
          item: this,
          kind: "live-llm-response.output-updated",
        }),
      );
    }
    if (
      previous.status !== this.status ||
      previous.errorMessage !== this.errorMessage
    ) {
      events.push(
        stateUpdatedEvent({
          details: {
            errorMessage: this.errorMessage,
            previousStatus: previous.status,
            status: this.status,
          },
          item: this,
          kind: "live-llm-response.status-changed",
        }),
      );
    }

    return events;
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
      text: `<answer${formatAttributes({ focused, source_request_id: this.sourceRequestId, created_at: new Date(this.createdAt).toISOString(), status: this.status })}>\n<question>\n${truncateContent(this.prompt, MAX_SAVED_CONTEXT_CHARACTERS)}\n</question>\n<response>\n${truncateContent(this.output, MAX_SAVED_CONTEXT_CHARACTERS)}\n</response>\n${this.errorMessage === undefined ? "" : `<error>\n${truncateContent(this.errorMessage, MAX_SAVED_CONTEXT_CHARACTERS)}\n</error>\n`}</answer>`,
    };
  }

  static restore(snapshot: unknown): LiveLlmResponseContextItem {
    const record = parseContextItemStateBase(snapshot, "llm-response-live");
    return new LiveLlmResponseContextItem({
      ...record,
      createdAt: assertNumber(
        record.raw.createdAt,
        "llm-response-live.createdAt",
      ),
      ...(record.raw.errorMessage === undefined
        ? {}
        : {
            errorMessage: assertString(
              record.raw.errorMessage,
              "llm-response-live.errorMessage",
            ),
          }),
      output: assertString(record.raw.output, "llm-response-live.output"),
      prompt: assertString(record.raw.prompt, "llm-response-live.prompt"),
      sourceRequestId: assertNumber(
        record.raw.sourceRequestId,
        "llm-response-live.sourceRequestId",
      ),
      status: assertOneOf(
        record.raw.status,
        ["error", "running"],
        "llm-response-live.status",
      ),
      type: "llm-response-live",
    });
  }
}

export class PiAgentContextItem implements ContextItem<PiAgentContextItemState> {
  readonly type = "pi-agent";

  constructor(readonly state: PiAgentContextItemState) {}

  get id(): string {
    return this.state.id;
  }

  get prompt(): string {
    return this.state.prompt;
  }

  get blocks(): readonly AgentOutputBlock[] {
    return this.state.blocks;
  }

  get status(): "error" | "idle" | "running" {
    return this.state.status;
  }

  get createdAt(): number {
    return this.state.createdAt;
  }

  get errorMessage(): string | undefined {
    return this.state.errorMessage;
  }

  get sandbox(): AgentSandboxContext | undefined {
    return this.state.sandbox;
  }

  get sessionAvailability(): PiAgentSessionAvailability {
    return this.state.sessionAvailability;
  }

  get harness(): AgentHarnessPersistence | undefined {
    return this.state.harness;
  }

  getListLabel(): string {
    return this.getSummaryView().title;
  }

  getSummaryState(): ContextItemSummaryState {
    return this.state.summaryState;
  }

  getSummaryView() {
    return getGeneratedSummaryView(this.state.summaryState, {
      detail:
        this.status === "running"
          ? "Agent is running…"
          : summarize(formatAgentOutputBlocks(this.blocks)),
      title: `Agent: ${summarize(this.prompt)}`,
    });
  }

  withSummaryState(summaryState: ContextItemSummaryState): PiAgentContextItem {
    return new PiAgentContextItem({ ...this.state, summaryState });
  }

  withAgentOutputUpdate(update: AgentOutputUpdate): PiAgentContextItem {
    return new PiAgentContextItem({
      ...this.state,
      blocks: applyAgentOutputUpdate(this.blocks, update),
    });
  }

  withStatus(
    status: "error" | "idle" | "running",
    errorMessage?: string,
  ): PiAgentContextItem {
    return new PiAgentContextItem({
      ...this.state,
      errorMessage,
      status,
    });
  }

  withSandbox(sandbox: AgentSandboxContext): PiAgentContextItem {
    return new PiAgentContextItem({ ...this.state, sandbox });
  }

  withSessionAvailability(
    sessionAvailability: PiAgentSessionAvailability,
  ): PiAgentContextItem {
    return new PiAgentContextItem({ ...this.state, sessionAvailability });
  }

  withHarness(harness: AgentHarnessPersistence): PiAgentContextItem {
    return new PiAgentContextItem({ ...this.state, harness });
  }

  getPersistence(): ContextItemPersistence<PiAgentContextItemState> {
    return persistentContextItemState(this.state);
  }

  getHistoryEvents(previous: ContextItem | null): readonly SessionEvent[] {
    const baseEvents = contextItemCreatedOrReplacedEvents(this, previous);
    if (baseEvents !== null) {
      return baseEvents;
    }

    if (!(previous instanceof PiAgentContextItem)) {
      return [];
    }

    const events: SessionEvent[] = [];
    if (fieldChanged(previous.state, this.state, "blocks")) {
      events.push(
        stateUpdatedEvent({
          details: {
            blockCount: this.blocks.length,
            previousBlockCount: previous.blocks.length,
          },
          item: this,
          kind: "pi-agent.output-updated",
        }),
      );
    }
    if (
      previous.status !== this.status ||
      previous.errorMessage !== this.errorMessage ||
      previous.sessionAvailability !== this.sessionAvailability
    ) {
      events.push(
        stateUpdatedEvent({
          details: {
            availability: this.sessionAvailability,
            errorMessage: this.errorMessage,
            previousAvailability: previous.sessionAvailability,
            previousStatus: previous.status,
            status: this.status,
          },
          item: this,
          kind: "pi-agent.status-changed",
        }),
      );
    }
    if (fieldChanged(previous.state, this.state, "sandbox")) {
      events.push(
        stateUpdatedEvent({
          details: {
            diffStatus: this.sandbox?.diffStatus,
            sandboxPath: this.sandbox?.path,
          },
          item: this,
          kind: "pi-agent.sandbox-updated",
        }),
      );
    }

    return events;
  }

  getActions(): readonly ContextItemAction[] {
    return [
      openContextItemAction(this.id),
      ...(this.sandbox !== undefined &&
      this.status !== "running" &&
      this.sessionAvailability === "live"
        ? [saveAgentSandboxDiffAction(this.id)]
        : []),
      removeContextItemAction(this.id),
    ];
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

  getLiveDetailView(): Extract<
    ContextItemDetailView,
    { kind: "agent-output" }
  > {
    return {
      blocks: this.blocks,
      errorMessage: this.errorMessage,
      itemId: this.id,
      kind: "agent-output" as const,
      prompt: this.prompt,
      sandbox: this.sandbox,
      sessionAvailability: this.sessionAvailability,
      status: this.status,
      title: `Agent: ${summarize(this.prompt)}`,
    };
  }

  async getDetailView() {
    return this.getLiveDetailView();
  }

  async formatForLlm({
    focused,
  }: FormatContextItemForLlmOptions): Promise<FormattedContextItem> {
    const latestMessage = getLatestAgentAssistantMessage(this.blocks);

    return {
      consumedFileCharacters: 0,
      text: `<agent_session${formatAttributes({ focused, created_at: new Date(this.createdAt).toISOString(), sandbox_path: this.sandbox?.path, sandbox_diff_status: this.sandbox?.diffStatus, status: this.status })}>\n<question>\n${truncateContent(this.prompt, MAX_SAVED_CONTEXT_CHARACTERS)}\n</question>\n<response>\n${truncateContent(latestMessage ?? "No agent message yet.", MAX_SAVED_CONTEXT_CHARACTERS)}\n</response>\n</agent_session>`,
    };
  }

  static restore(snapshot: unknown): PiAgentContextItem {
    const record = parseContextItemStateBase(snapshot, "pi-agent");
    return new PiAgentContextItem({
      ...record,
      blocks: parseAgentBlocks(record.raw.blocks, "pi-agent"),
      createdAt: assertNumber(record.raw.createdAt, "pi-agent.createdAt"),
      ...(record.raw.errorMessage === undefined
        ? {}
        : {
            errorMessage: assertString(
              record.raw.errorMessage,
              "pi-agent.errorMessage",
            ),
          }),
      prompt: assertString(record.raw.prompt, "pi-agent.prompt"),
      ...(record.raw.harness === undefined
        ? {}
        : {
            harness: parseAgentHarnessPersistence(
              record.raw.harness,
              "pi-agent.harness",
            ),
          }),
      ...(record.raw.sandbox === undefined
        ? {}
        : {
            sandbox: parseAgentSandboxContext(
              record.raw.sandbox,
              "pi-agent.sandbox",
            ),
          }),
      sessionAvailability: assertOneOf(
        record.raw.sessionAvailability,
        ["detached", "live"],
        "pi-agent.sessionAvailability",
      ),
      status: assertOneOf(
        record.raw.status,
        ["error", "idle", "running"],
        "pi-agent.status",
      ),
      type: "pi-agent",
    });
  }
}

export class SavedDiffContextItem implements ContextItem<SavedDiffContextItemState> {
  readonly type = "diff";

  constructor(readonly state: SavedDiffContextItemState) {}

  get id(): string {
    return this.state.id;
  }

  get prompt(): string {
    return this.state.prompt;
  }

  get summary(): string {
    return this.state.summary;
  }

  get diffText(): string {
    return this.state.diffText;
  }

  get proposal(): PatchProposal {
    return this.state.proposal;
  }

  get sourceRequestId(): number {
    return this.state.sourceRequestId;
  }

  get createdAt(): number {
    return this.state.createdAt;
  }

  getListLabel(): string {
    return this.getSummaryView().title;
  }

  getSummaryState(): ContextItemSummaryState {
    return this.state.summaryState;
  }

  getSummaryView() {
    return getGeneratedSummaryView(this.state.summaryState, {
      detail: summarize(this.prompt),
      title: `Diff: ${this.summary.length > 0 ? this.summary : summarize(this.prompt)}`,
    });
  }

  withSummaryState(
    summaryState: ContextItemSummaryState,
  ): SavedDiffContextItem {
    return new SavedDiffContextItem({ ...this.state, summaryState });
  }

  getPersistence(): ContextItemPersistence<SavedDiffContextItemState> {
    return persistentContextItemState(this.state);
  }

  getHistoryEvents(previous: ContextItem | null): readonly SessionEvent[] {
    const baseEvents = contextItemCreatedOrReplacedEvents(this, previous);
    if (baseEvents !== null) {
      return baseEvents;
    }

    if (!(previous instanceof SavedDiffContextItem)) {
      return [];
    }

    return fieldChanged(previous.state, this.state, "diffText") ||
      fieldChanged(previous.state, this.state, "proposal")
      ? [
          stateUpdatedEvent({
            details: {
              editCount: getPatchProposalPaths(this.proposal).length,
              summary: this.summary,
            },
            item: this,
            kind: "saved-diff.updated",
          }),
        ]
      : [];
  }

  getActions(): readonly ContextItemAction[] {
    return [
      openContextItemAction(this.id),
      applyDiffAction(this.id),
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
      text: `<saved_diff${formatAttributes({ focused, source_request_id: this.sourceRequestId, created_at: new Date(this.createdAt).toISOString() })}>\n<question>\n${truncateContent(this.prompt, MAX_SAVED_CONTEXT_CHARACTERS)}\n</question>\n<summary>\n${this.summary}\n</summary>\n<diff>\n${truncateContent(this.diffText, MAX_SAVED_CONTEXT_CHARACTERS)}\n</diff>\n</saved_diff>`,
    };
  }

  static restore(snapshot: unknown): SavedDiffContextItem {
    const record = parseContextItemStateBase(snapshot, "diff");
    return new SavedDiffContextItem({
      ...record,
      createdAt: assertNumber(record.raw.createdAt, "diff.createdAt"),
      diffText: assertString(record.raw.diffText, "diff.diffText"),
      prompt: assertString(record.raw.prompt, "diff.prompt"),
      proposal: parsePatchProposal(record.raw.proposal, "diff.proposal"),
      sourceRequestId: assertNumber(
        record.raw.sourceRequestId,
        "diff.sourceRequestId",
      ),
      summary: assertString(record.raw.summary, "diff.summary"),
      type: "diff",
    });
  }
}

export class SavedAgentSandboxDiffContextItem implements ContextItem<SavedAgentSandboxDiffContextItemState> {
  readonly type = "agent-sandbox-diff";

  constructor(readonly state: SavedAgentSandboxDiffContextItemState) {}

  get id(): string {
    return this.state.id;
  }

  get sourceAgentItemId(): string {
    return this.state.sourceAgentItemId;
  }

  get prompt(): string {
    return this.state.prompt;
  }

  get summary(): string {
    return this.state.summary;
  }

  get diffText(): string {
    return this.state.diffText;
  }

  get createdAt(): number {
    return this.state.createdAt;
  }

  getListLabel(): string {
    return this.getSummaryView().title;
  }

  getSummaryState(): ContextItemSummaryState {
    return this.state.summaryState;
  }

  getSummaryView() {
    return getGeneratedSummaryView(this.state.summaryState, {
      detail: summarize(this.summary.length > 0 ? this.summary : this.prompt),
      title: `Agent diff: ${summarize(this.prompt)}`,
    });
  }

  withSummaryState(
    summaryState: ContextItemSummaryState,
  ): SavedAgentSandboxDiffContextItem {
    return new SavedAgentSandboxDiffContextItem({
      ...this.state,
      summaryState,
    });
  }

  getPersistence(): ContextItemPersistence<SavedAgentSandboxDiffContextItemState> {
    return persistentContextItemState(this.state);
  }

  getHistoryEvents(previous: ContextItem | null): readonly SessionEvent[] {
    const baseEvents = contextItemCreatedOrReplacedEvents(this, previous);
    if (baseEvents !== null) {
      return baseEvents;
    }

    if (!(previous instanceof SavedAgentSandboxDiffContextItem)) {
      return [];
    }

    return previous.diffText !== this.diffText ||
      previous.summary !== this.summary
      ? [
          stateUpdatedEvent({
            details: {
              sourceAgentItemId: this.sourceAgentItemId,
              summary: this.summary,
            },
            item: this,
            kind: "agent-sandbox-diff.updated",
          }),
        ]
      : [];
  }

  getActions(): readonly ContextItemAction[] {
    return [
      openContextItemAction(this.id),
      applyDiffAction(this.id),
      removeContextItemAction(this.id),
    ];
  }

  async getSummarizationInput() {
    const sourceText = `Prompt:\n${truncateContent(this.prompt, MAX_CONTEXT_ITEM_SUMMARY_CHARACTERS)}\n\nSummary:\n${truncateContent(this.summary, MAX_CONTEXT_ITEM_SUMMARY_CHARACTERS)}\n\nDiff:\n${truncateContent(this.diffText, MAX_CONTEXT_ITEM_SUMMARY_CHARACTERS)}`;

    return {
      content: sourceText,
      itemId: this.id,
      label: `Agent diff: ${summarize(this.prompt)}`,
      sourceHash: hashContent(sourceText),
      type: this.type,
    };
  }

  async getDetailView() {
    return {
      diffText: this.diffText,
      kind: "diff" as const,
      summary: this.summary,
      title: `Agent diff: ${summarize(this.prompt)}`,
    };
  }

  async formatForLlm({
    focused,
  }: FormatContextItemForLlmOptions): Promise<FormattedContextItem> {
    return {
      consumedFileCharacters: 0,
      text: `<agent_sandbox_diff${formatAttributes({ focused, source_agent_item_id: this.sourceAgentItemId, created_at: new Date(this.createdAt).toISOString() })}>\n<question>\n${truncateContent(this.prompt, MAX_SAVED_CONTEXT_CHARACTERS)}\n</question>\n<summary>\n${truncateContent(this.summary, MAX_SAVED_CONTEXT_CHARACTERS)}\n</summary>\n<diff>\n${truncateContent(this.diffText, MAX_SAVED_CONTEXT_CHARACTERS)}\n</diff>\n</agent_sandbox_diff>`,
    };
  }

  static restore(snapshot: unknown): SavedAgentSandboxDiffContextItem {
    const record = parseContextItemStateBase(snapshot, "agent-sandbox-diff");
    return new SavedAgentSandboxDiffContextItem({
      ...record,
      createdAt: assertNumber(
        record.raw.createdAt,
        "agent-sandbox-diff.createdAt",
      ),
      diffText: assertString(
        record.raw.diffText,
        "agent-sandbox-diff.diffText",
      ),
      prompt: assertString(record.raw.prompt, "agent-sandbox-diff.prompt"),
      sourceAgentItemId: assertString(
        record.raw.sourceAgentItemId,
        "agent-sandbox-diff.sourceAgentItemId",
      ),
      summary: assertString(record.raw.summary, "agent-sandbox-diff.summary"),
      type: "agent-sandbox-diff",
    });
  }
}

export function createFileContextItem(filePath: FilePath): FileContextItem {
  return new FileContextItem({
    filePath,
    id: getFileContextItemId(filePath),
    schemaVersion: 1,
    summaryState: MISSING_SUMMARY_STATE,
    type: "file",
  });
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
  return new LiveLlmResponseContextItem({
    createdAt,
    id,
    output,
    prompt,
    schemaVersion: 1,
    sourceRequestId,
    status: "running",
    summaryState: MISSING_SUMMARY_STATE,
    type: "llm-response-live",
  });
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
  return new PiAgentContextItem({
    blocks: [],
    createdAt,
    id,
    prompt,
    schemaVersion: 1,
    sessionAvailability: "live",
    status: "running",
    summaryState: MISSING_SUMMARY_STATE,
    type: "pi-agent",
  });
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
  return new SavedLlmResponseContextItem({
    createdAt,
    id,
    output,
    prompt,
    schemaVersion: 1,
    sourceRequestId,
    summaryState: MISSING_SUMMARY_STATE,
    type: "llm-response",
  });
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
  return new ShellCommandOutputContextItem({
    createdAt,
    id,
    result,
    schemaVersion: 1,
    sourceRequestId,
    summaryState: MISSING_SUMMARY_STATE,
    type: "shell-command-output",
  });
}

export function createUserTextContextItem({
  createdAt,
  id,
  text,
}: {
  createdAt: number;
  id: string;
  text: string;
}): UserTextContextItem {
  return new UserTextContextItem({
    createdAt,
    id,
    schemaVersion: 1,
    summaryState: MISSING_SUMMARY_STATE,
    text,
    type: "user-text",
  });
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
  return new SavedDiffContextItem({
    createdAt,
    diffText,
    id,
    prompt,
    proposal,
    schemaVersion: 1,
    sourceRequestId,
    summary,
    summaryState: MISSING_SUMMARY_STATE,
    type: "diff",
  });
}

export function createSavedAgentSandboxDiffContextItem({
  createdAt,
  diffText,
  id,
  prompt,
  sourceAgentItemId,
  summary,
}: {
  createdAt: number;
  diffText: string;
  id: string;
  prompt: string;
  sourceAgentItemId: string;
  summary: string;
}): SavedAgentSandboxDiffContextItem {
  return new SavedAgentSandboxDiffContextItem({
    createdAt,
    diffText,
    id,
    prompt,
    schemaVersion: 1,
    sourceAgentItemId,
    summary,
    summaryState: MISSING_SUMMARY_STATE,
    type: "agent-sandbox-diff",
  });
}

const contextItemRestorers = {
  "agent-sandbox-diff": SavedAgentSandboxDiffContextItem.restore,
  diff: SavedDiffContextItem.restore,
  file: FileContextItem.restore,
  "llm-response": SavedLlmResponseContextItem.restore,
  "llm-response-live": LiveLlmResponseContextItem.restore,
  "pi-agent": PiAgentContextItem.restore,
  "shell-command-output": ShellCommandOutputContextItem.restore,
  "user-text": UserTextContextItem.restore,
} satisfies Record<PersistentContextItemState["type"], ContextItemRestorer>;

export function restoreContextItem(
  snapshot: unknown,
): ContextItem<PersistentContextItemState> {
  const record = assertRecord(snapshot, "context item snapshot");
  const type = assertString(record.type, "context item snapshot type");
  if (!(type in contextItemRestorers)) {
    throw new Error(`Unknown context item type: ${type}`);
  }

  const restorer =
    contextItemRestorers[type as keyof typeof contextItemRestorers];
  return restorer(snapshot) as ContextItem<PersistentContextItemState>;
}

export function serializeContextItem(
  item: ContextItem,
): PersistentContextItemState | null {
  const persistence = item.getPersistence();
  return persistence.kind === "persistent"
    ? (persistence.snapshot as PersistentContextItemState)
    : null;
}

function parseContextItemStateBase<
  Type extends PersistentContextItemState["type"],
>(
  snapshot: unknown,
  expectedType: Type,
): {
  id: string;
  raw: Record<string, unknown>;
  schemaVersion: 1;
  summaryState: ContextItemSummaryState;
} {
  const record = assertRecord(snapshot, "context item snapshot");
  const type = assertString(record.type, "context item snapshot type");
  if (type !== expectedType) {
    throw new Error(
      `Expected context item type "${expectedType}", got "${type}".`,
    );
  }
  const schemaVersion = assertNumber(
    record.schemaVersion,
    `${type} schemaVersion`,
  );
  if (schemaVersion !== 1) {
    throw new Error(
      `Unsupported context item schema version for "${type}": ${schemaVersion}`,
    );
  }

  const parsed = {
    id: assertString(record.id, `${type}.id`),
    schemaVersion: 1 as const,
    summaryState: parseSummaryState(record.summaryState, type),
  };
  Object.defineProperty(parsed, "raw", {
    enumerable: false,
    value: record,
  });

  return parsed as typeof parsed & { raw: Record<string, unknown> };
}

function parseAgentBlocks(
  value: unknown,
  type: string,
): readonly AgentOutputBlock[] {
  if (!Array.isArray(value)) {
    throw new Error(`${type}.blocks must be an array.`);
  }

  return value.map((block, index) =>
    parseAgentOutputBlock(block, `${type}.blocks[${index}]`),
  );
}

export function parseAgentOutputBlock(
  value: unknown,
  label: string,
): AgentOutputBlock {
  const record = assertRecord(value, label);
  const kind = assertOneOf(
    record.kind,
    ["status", "stream", "tool"],
    `${label}.kind`,
  );

  if (kind === "status") {
    return {
      id: assertString(record.id, `${label}.id`),
      kind,
      message: assertString(record.message, `${label}.message`),
      timestamp: assertNumber(record.timestamp, `${label}.timestamp`),
    };
  }

  if (kind === "stream") {
    return {
      id: assertString(record.id, `${label}.id`),
      kind,
      streamKind: assertOneOf(
        record.streamKind,
        ["assistant", "thinking"],
        `${label}.streamKind`,
      ),
      text: assertString(record.text, `${label}.text`),
      timestamp: assertNumber(record.timestamp, `${label}.timestamp`),
      ...(record.truncated === undefined
        ? {}
        : { truncated: assertBoolean(record.truncated, `${label}.truncated`) }),
    };
  }

  return {
    id: assertString(record.id, `${label}.id`),
    ...(record.isError === undefined
      ? {}
      : { isError: assertBoolean(record.isError, `${label}.isError`) }),
    kind,
    phase: assertOneOf(
      record.phase,
      ["end", "start", "update"],
      `${label}.phase`,
    ),
    summary: assertString(record.summary, `${label}.summary`),
    timestamp: assertNumber(record.timestamp, `${label}.timestamp`),
    toolName: assertString(record.toolName, `${label}.toolName`),
  };
}

function parseSummaryState(
  value: unknown,
  type: string,
): ContextItemSummaryState {
  const record = assertRecord(value, `${type}.summaryState`);
  const status = assertString(record.status, `${type}.summaryState.status`);
  if (status === "pending") {
    return MISSING_SUMMARY_STATE;
  }

  if (status === "missing") {
    return MISSING_SUMMARY_STATE;
  }

  if (status === "ready") {
    const summary = assertRecord(
      record.summary,
      `${type}.summaryState.summary`,
    );
    return {
      sourceHash: assertString(
        record.sourceHash,
        `${type}.summaryState.sourceHash`,
      ),
      status,
      summary: {
        details: assertString(
          summary.details,
          `${type}.summaryState.summary.details`,
        ),
        generatedAt: assertNumber(
          summary.generatedAt,
          `${type}.summaryState.summary.generatedAt`,
        ),
        oneLine: assertString(
          summary.oneLine,
          `${type}.summaryState.summary.oneLine`,
        ),
        sourceHash: assertString(
          summary.sourceHash,
          `${type}.summaryState.summary.sourceHash`,
        ),
      },
    };
  }

  if (status === "error") {
    return {
      errorMessage: assertString(
        record.errorMessage,
        `${type}.summaryState.errorMessage`,
      ),
      sourceHash: assertString(
        record.sourceHash,
        `${type}.summaryState.sourceHash`,
      ),
      status,
      workerId: assertString(record.workerId, `${type}.summaryState.workerId`),
    };
  }

  throw new Error(`${type}.summaryState.status is unsupported: ${status}`);
}

function parseShellCommandResult(
  value: unknown,
  label: string,
): ShellCommandResult {
  const record = assertRecord(value, label);
  return {
    command: assertString(record.command, `${label}.command`),
    durationMs: assertNumber(record.durationMs, `${label}.durationMs`),
    exitCode:
      record.exitCode === null
        ? null
        : assertNumber(record.exitCode, `${label}.exitCode`),
    ...(record.signal === undefined
      ? {}
      : { signal: assertString(record.signal, `${label}.signal`) }),
    stderr: assertString(record.stderr, `${label}.stderr`),
    stdout: assertString(record.stdout, `${label}.stdout`),
    timedOut: assertBoolean(record.timedOut, `${label}.timedOut`),
    truncated: assertBoolean(record.truncated, `${label}.truncated`),
  };
}

function parsePatchProposal(value: unknown, label: string): PatchProposal {
  const record = assertRecord(value, label);
  if (record.patch !== undefined) {
    return {
      patch: assertString(record.patch, `${label}.patch`),
      summary: assertString(record.summary, `${label}.summary`),
      ...(record.toolCallId === undefined
        ? {}
        : {
            toolCallId: assertString(record.toolCallId, `${label}.toolCallId`),
          }),
    };
  }

  return patchProposalFromLegacyEdits({
    edits: assertArray(record.edits, `${label}.edits`).map((edit, index) => {
      const editRecord = assertRecord(edit, `${label}.edits[${index}]`);
      return {
        newText: assertString(
          editRecord.newText,
          `${label}.edits[${index}].newText`,
        ),
        oldText: assertString(
          editRecord.oldText,
          `${label}.edits[${index}].oldText`,
        ),
        path: assertString(editRecord.path, `${label}.edits[${index}].path`),
      };
    }),
    summary: assertString(record.summary, `${label}.summary`),
  });
}

function parseAgentSandboxContext(
  value: unknown,
  label: string,
): AgentSandboxContext {
  const record = assertRecord(value, label);
  return {
    baselineTree: assertString(record.baselineTree, `${label}.baselineTree`),
    diffStatus: assertOneOf(
      record.diffStatus,
      ["clean", "dirty", "error", "unknown"],
      `${label}.diffStatus`,
    ),
    ...(record.errorMessage === undefined
      ? {}
      : {
          errorMessage: assertString(
            record.errorMessage,
            `${label}.errorMessage`,
          ),
        }),
    path: assertString(record.path, `${label}.path`),
    root: assertString(record.root, `${label}.root`),
    ...(record.summary === undefined
      ? {}
      : { summary: assertString(record.summary, `${label}.summary`) }),
  };
}

function parseAgentHarnessPersistence(
  value: unknown,
  label: string,
): AgentHarnessPersistence {
  const record = assertRecord(value, label);
  return {
    kind: assertString(record.kind, `${label}.kind`),
    session: record.session,
  };
}

function sanitizeJsonValue(value: unknown): unknown {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function assertRecord(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }

  return value as Record<string, unknown>;
}

function assertArray(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array.`);
  }

  return value;
}

function assertString(value: unknown, label: string): string {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a string.`);
  }

  return value;
}

function assertNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }

  return value;
}

function assertBoolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${label} must be a boolean.`);
  }

  return value;
}

function assertOneOf<const Value extends string>(
  value: unknown,
  values: readonly Value[],
  label: string,
): Value {
  if (typeof value !== "string" || !values.includes(value as Value)) {
    throw new Error(`${label} must be one of: ${values.join(", ")}.`);
  }

  return value as Value;
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

function saveAgentSandboxDiffAction(itemId: string): ContextItemAction {
  return {
    id: "save-agent-diff",
    label: "add diff to context",
    shortcut: { ctrl: true, display: "Ctrl+d", name: "d" },
    run: (context) => context.saveAgentSandboxDiff(itemId),
  };
}

function removeContextItemAction(itemId: string): ContextItemAction {
  return {
    id: "remove",
    label: "remove",
    paneShortcut: { display: "x", name: "x" },
    shortcut: { ctrl: true, display: "Ctrl+x", name: "x" },
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
    label: "rerun",
    paneShortcut: { display: "r", name: "r" },
    shortcut: { ctrl: true, display: "Ctrl+r", name: "r" },
    run: (context) =>
      context.rerunPrompt({ expectedResult, prompt, replaceContextItemId }),
  };
}

function rerunShellCommandAction({
  command,
  replaceContextItemId,
}: {
  command: string;
  replaceContextItemId: string;
}): ContextItemAction {
  return {
    id: "rerun",
    label: "rerun",
    paneShortcut: { display: "r", name: "r" },
    shortcut: { ctrl: true, display: "Ctrl+r", name: "r" },
    run: (context) =>
      context.rerunShellCommand({ command, replaceContextItemId }),
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

function isInsideRoot(root: string, path: string): boolean {
  const relativePath = relative(root, path);
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}
