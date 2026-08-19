import type { AgentOutputBlock } from "./lib/agentOutput/agentOutputTypes";

export type FilePath = string;

export type AgentSandboxContext = {
  baselineTree: string;
  diffStatus: "clean" | "dirty" | "error" | "unknown";
  errorMessage?: string;
  path: string;
  root: string;
  summary?: string;
};

export type SessionEvent = {
  at: number;
  details?: Record<string, unknown>;
  itemId?: string;
  kind: string;
  schemaVersion: 1;
};

export type ContextItemState = {
  id: string;
  schemaVersion: number;
  summaryState: ContextItemSummaryState;
  type: string;
};

export type ContextItemPersistence<
  State extends ContextItemState = ContextItemState,
> =
  | { kind: "ephemeral"; reason: string }
  | { kind: "persistent"; snapshot: State };

export interface ContextItem<
  State extends ContextItemState = ContextItemState,
> {
  readonly id: string;
  readonly state: State;
  readonly type: State["type"];

  formatForLlm(
    options: FormatContextItemForLlmOptions,
  ): Promise<FormattedContextItem>;
  getActions(): readonly ContextItemAction[];
  getDetailView(
    options: GetContextItemDetailViewOptions,
  ): Promise<ContextItemDetailView | null>;
  getLiveDetailView?(): ContextItemDetailView | null;
  getHistoryEvents(previous: ContextItem | null): readonly SessionEvent[];
  getListGroup(): ContextItemListGroup | null;
  getListLabel(): string;
  getPersistence(): ContextItemPersistence<State>;
  getSummarizationInput(
    options: GetContextItemSummaryInputOptions,
  ): Promise<ContextItemSummarizationInput | null>;
  getSummaryState(): ContextItemSummaryState;
  getSummaryView(): ContextItemSummaryView;
  isPinned(): boolean;
  withPinned(pinned: boolean): ContextItem;
  withCreatedAt?(createdAt: number): ContextItem;
  getAutoRegenerate?(): boolean;
  withAutoRegenerate?(enabled: boolean): ContextItem;
  getRegenStatus?(): RegenStatus;
  withRegenStatus?(status: RegenStatus): ContextItem;
  withSummaryState(summaryState: ContextItemSummaryState): ContextItem;
}

export type RegenStatus =
  | { status: "idle" }
  | { status: "running" }
  | { status: "error"; errorMessage: string };

export type GeneratedContextItemSummary = {
  details: string;
  generatedAt: number;
  oneLine: string;
  sourceHash: string;
};

export type ContextItemSummaryState =
  | { status: "missing" }
  | {
      sourceHash: string;
      status: "ready";
      summary: GeneratedContextItemSummary;
    }
  | {
      errorMessage: string;
      sourceHash: string;
      status: "error";
      workerId: string;
    }
  | { sourceHash: string; status: "pending"; workerId: string };

export type ContextItemSummaryView = {
  detail?: string;
  label: string;
  status: ContextItemSummaryState["status"];
  title: string;
};

export type ContextItemListGroupId =
  | "agent"
  | "ask"
  | "commands"
  | "edit"
  | "say"
  | "workspace";

export type ContextItemListGroup = {
  id: ContextItemListGroupId;
  itemLabel: string;
};

export type ContextItemSummarizationInput = {
  content: string;
  itemId: string;
  label: string;
  sourceHash: string;
  type: string;
};

export type GetContextItemSummaryInputOptions = {
  root: string;
};

export type ContextItemDetailView =
  | {
      content: string;
      filePath?: string;
      kind: "code";
      title: string;
    }
  | {
      content: string;
      kind: "markdown";
      title: string;
    }
  | {
      errorMessage?: string;
      kind: "llm-text-response";
      question: string;
      responseText: string;
      savedContextItemId?: string;
      status: "done" | "error" | "loading" | "streaming";
      title: string;
    }
  | {
      content: string;
      kind: "text";
      title: string;
    }
  | {
      content: string;
      itemId: string;
      kind: "editable-text";
      title: string;
    }
  | {
      blocks: readonly AgentOutputBlock[];
      errorMessage?: string;
      itemId: string;
      kind: "agent-output";
      prompt: string;
      sandbox?: AgentSandboxContext;
      sessionAvailability: "detached" | "live";
      status: "error" | "idle" | "running";
      title: string;
    }
  | {
      command: string;
      durationMs: number;
      exitCode: number | null;
      itemId: string;
      kind: "shell-output";
      requestId: number;
      signal?: string;
      status: "finished" | "running";
      stderr: string;
      stdout: string;
      timedOut: boolean;
      title: string;
      truncated: boolean;
    }
  | {
      diffText: string;
      kind: "diff";
      summary: string;
      title: string;
    };

export type GetContextItemDetailViewOptions = {
  root: string;
};

export type ContextItemActionShortcut = {
  ctrl?: boolean;
  display: string;
  hyper?: boolean;
  meta?: boolean;
  name: string;
  option?: boolean;
  shift?: boolean;
  super?: boolean;
};

export type ContextItemAction = {
  id: string;
  label: string;
  paneShortcut?: {
    display: string;
    name: string;
  };
  shortcut?: ContextItemActionShortcut;
  run: (context: ContextItemActionContext) => Promise<void> | void;
};

export type ContextItemActionContext = {
  applyDiff: (itemId: string) => void;
  openContextItem: (itemId: string) => void;
  removeContextItem: (itemId: string) => void;
  rerunPrompt: (options: {
    expectedResult: "diff" | "text";
    prompt: string;
    replaceContextItemId: string;
  }) => void;
  rerunShellCommand: (options: {
    command: string;
    replaceContextItemId: string;
  }) => void;
  saveAgentSandboxDiff: (itemId: string) => void;
  setAutoRegenerate: (itemId: string, enabled: boolean) => void;
  setPinned: (itemId: string, pinned: boolean) => void;
};

export type FormatContextItemForLlmOptions = {
  focused: boolean;
  remainingFileCharacters: number;
  root: string;
};

export type FormattedContextItem = {
  consumedFileCharacters: number;
  file?: LlmFileContext;
  text: string;
};

export type LlmFileContext = {
  content: string;
  errorMessage?: string;
  filePath: FilePath;
  status: "included" | "skipped";
  truncated: boolean;
};

export type HighlightedFilePath = FilePath | null;

export type FileSelectionDirection = "previous" | "next";

export type FileSelectorMatch = {
  fileSelector: string;
  start: number;
  end: number;
};
