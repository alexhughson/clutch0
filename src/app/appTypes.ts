import type {
  AgentOutputBlock,
  AgentOutputUpdate,
} from "../lib/agentOutput/agentOutputTypes";
import type { CreateFileValidationResult } from "../lib/createFile/createFile";
import type { PatchProgressState, PatchReviewState } from "../lib/patch/types";
import type {
  ClutchModelSelection,
  SupportedClutchLlmProvider,
} from "../lib/config/clutchConfig";
import type { ShellCommandResult } from "../lib/shell/shellCommand";
import type {
  AgentAskMode,
  AgentSandboxContext,
  ContextItem,
  FilePath,
} from "../types";

export type AppTask =
  | ContextItemViewerTaskState
  | ConfigTaskState
  | CreateFileTaskState
  | FindFilesTaskState
  | ResponseTaskState
  | ShellCommandTaskState
  | ShowContextTaskState;

export type LlmRequestStatus = "loading" | "streaming" | "done" | "error";

export type LlmRequestLatencyStats = {
  totalMs?: number;
  ttftMs?: number;
};

export type ContextItemReplacementTarget = {
  contextItemId: string;
  expectedResult: "diff" | "text";
};

export type ShellCommandReplacementTarget = {
  contextItemId: string;
};

type LlmRequestBase = {
  contextItems: ContextItem[];
  focusedContextItemId: string | null;
  id: number;
  latencyStats?: LlmRequestLatencyStats;
  patch?: PatchReviewState;
  patchProgress?: PatchProgressState;
  question: string;
  replacement?: ContextItemReplacementTarget;
  responseText: string;
  savedContextItemId?: string;
};

type InProgressLlmRequestState = LlmRequestBase & {
  status: "loading" | "streaming";
};

type CompletedLlmRequestState = LlmRequestBase & {
  status: "done";
};

type FailedLlmRequestState = LlmRequestBase & {
  errorMessage: string;
  status: "error";
};

export type LlmRequestState =
  | InProgressLlmRequestState
  | CompletedLlmRequestState
  | FailedLlmRequestState;

export type ComposerState = {
  cursorPosition: number;
  message: string;
};

export type WorkspaceState = {
  automaticContextItems: ContextItem[];
  composer: ComposerState;
  contextItems: ContextItem[];
  focusedContextItemId: string | null;
};

export type ComposeScreenState = WorkspaceState;

export type RelevantFileCandidate = {
  confidence?: "high" | "low" | "medium";
  path: FilePath;
  reason: string;
};

export type ResponseTaskState = {
  kind: "response";
  rejectComposer?: ComposerState;
  request: LlmRequestState;
};

export type ContextItemViewerTaskState = {
  applyErrorMessage?: string;
  applyStatus: "apply-error" | "applying" | "idle";
  itemId: string;
  kind: "context-item-viewer";
  rejectComposer?: ComposerState;
};

export type ConfigTaskState = {
  agent: ClutchModelSelection;
  configuredProviders: SupportedClutchLlmProvider[];
  kind: "config";
  mode: "first-run" | "settings";
  primary: ClutchModelSelection;
  summarization: ClutchModelSelection;
};

export type CreateFileTaskState = {
  applyErrorMessage?: string;
  applyStatus: "apply-error" | "applying" | "pending";
  id: number;
  kind: "create-file";
  prompt: string;
  rejectComposer?: ComposerState;
  validation: CreateFileValidationResult;
};

export type ShowContextTaskState = {
  content?: string;
  errorMessage?: string;
  id: number;
  kind: "show-context";
  question: string;
  rejectComposer?: ComposerState;
  status: "done" | "error" | "loading";
};

export type ShellCommandTaskState = {
  errorMessage?: string;
  id: number;
  kind: "shell-command";
  prompt: string;
  rejectComposer?: ComposerState;
  replacement?: ShellCommandReplacementTarget;
  result?: ShellCommandResult;
  savedContextItemId?: string;
  status: "done" | "error" | "running";
};

export type FindFilesTaskState = {
  agentOutput: AgentOutputBlock[];
  candidates: RelevantFileCandidate[];
  errorMessage?: string;
  goal: string;
  hints: string[];
  kind: "find-files";
  rejectComposer?: ComposerState;
  selectedIndex: number;
  status: "searching" | "results" | "error";
};

export type FindFilesScreenState = FindFilesTaskState;
export type ContextItemViewerScreenState = ContextItemViewerTaskState;
export type AppScreen = AppTask;

export type AppState = {
  actions: AppActions;
  activeTask: AppTask | null;
  nextContextItemId: number;
  nextLlmRequestId: number;
  workspace: WorkspaceState;
};

export type AppActions = {
  addFiles: {
    addToContext: (options: { paths: FilePath[] }) => void;
  };
  compose: {
    acceptFileSelection: (options: {
      cursorPosition: number;
      filePath: FilePath;
      message: string;
    }) => void;
    focusNextContextItem: () => void;
    focusPreviousContextItem: () => void;
    removeContextItem: (options: { itemId: string }) => void;
    removeFocusedContextItem: () => void;
    setComposerState: (composerState: ComposerState) => void;
    startLlmRequest: (options: {
      question: string;
      rejectComposer?: ComposerState;
      replacement?: ContextItemReplacementTarget;
    }) => number | null;
  };
  contextSummaries: {
    ensureWorkspaceSummaries: () => void;
  };
  config: {
    closeAfterSave: () => void;
    openSettings: () => void;
    openSetup: () => void;
  };
  agentAsk: {
    attachSandbox: (options: {
      itemId: string;
      sandbox: AgentSandboxContext;
    }) => void;
    fail: (options: { errorMessage: string; itemId: string }) => void;
    finish: (options: { itemId: string }) => void;
    recordOutput: (options: {
      itemId: string;
      update: AgentOutputUpdate;
    }) => void;
    saveSandboxDiffToContext: (options: {
      agentItemId: string;
      diffText: string;
      summary: string;
    }) => void;
    start: (options: {
      mode: AgentAskMode;
      prompt: string;
      rejectComposer?: ComposerState;
    }) => string | null;
    startMessage: (options: { itemId: string }) => void;
    updateSandboxDiff: (options: {
      itemId: string;
      sandbox: AgentSandboxContext;
    }) => void;
  };
  createFile: {
    failApply: (options: { errorMessage: string; requestId: number }) => void;
    finishApply: (options: { requestId: number }) => void;
    showReview: (options: {
      requestId: number;
      validation: CreateFileValidationResult;
    }) => void;
    startApply: (options: { requestId: number }) => void;
  };
  contextItems: {
    failSavedDiffApply: (options: {
      errorMessage: string;
      itemId: string;
    }) => void;
    finishSavedDiffApply: (options: { itemId: string }) => void;
    openContextItem: (options: { itemId: string }) => void;
    startSavedDiffApply: (options: { itemId: string }) => void;
  };
  showContext: {
    fail: (options: { errorMessage: string; requestId: number }) => void;
    finish: (options: { content: string; requestId: number }) => void;
    start: (options: {
      question: string;
      rejectComposer?: ComposerState;
    }) => number | null;
  };
  shellCommand: {
    fail: (options: { errorMessage: string; requestId: number }) => void;
    finish: (options: {
      requestId: number;
      result: ShellCommandResult;
    }) => void;
    saveOutputToContext: (options: { requestId: number }) => void;
    start: (options: {
      prompt: string;
      rejectComposer?: ComposerState;
      replacement?: ShellCommandReplacementTarget;
    }) => number | null;
  };
  findFiles: {
    addAllCandidates: () => void;
    addSelectedCandidate: () => void;
    recordAgentOutput: (options: { update: AgentOutputUpdate }) => void;
    fail: (options: { errorMessage: string }) => void;
    finish: (options: { candidates: RelevantFileCandidate[] }) => void;
    selectNext: () => void;
    selectPrevious: () => void;
    showSearch: (options: { goal: string; hints: string[] }) => void;
  };
  navigation: {
    acceptAndClose: () => void;
    dismissPane: () => void;
    rejectToEdit: () => void;
  };
  say: {
    addToContext: (options: { text: string }) => void;
    updateText: (options: { itemId: string; text: string }) => void;
  };
  response: {
    appendDelta: (options: { delta: string; requestId: number }) => void;
    fail: (options: {
      errorMessage: string;
      requestId: number;
      responseText?: string;
    }) => void;
    failPatchApply: (options: {
      errorMessage: string;
      requestId: number;
    }) => void;
    finish: (options: {
      requestId: number;
      responseKind: "patch" | "text";
      responseText: string;
    }) => void;
    finishPatchApply: (options: { requestId: number }) => void;
    saveDiffToContext: (options: { requestId: number }) => void;
    saveTextToContext: (options: { requestId: number }) => void;
    setPatch: (options: { patch: PatchReviewState; requestId: number }) => void;
    setLatencyStats: (options: {
      latencyStats: LlmRequestLatencyStats;
      requestId: number;
    }) => void;
    setPatchProgress: (options: {
      progress: PatchProgressState;
      requestId: number;
    }) => void;
    startPatchApply: (options: { requestId: number }) => void;
  };
};

export type InProgressLlmRequestForState = InProgressLlmRequestState;
