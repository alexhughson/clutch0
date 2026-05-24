import type { PatchReviewState } from "../lib/patch/types";
import type { ContextItem, FilePath } from "../types";

export type AppScreen =
  | ComposeScreenState
  | {
      name: "response";
      request: LlmRequestState;
      returnToCompose: ComposeScreenState;
    };

export type LlmRequestStatus = "loading" | "streaming" | "done" | "error";

type LlmRequestBase = {
  contextItems: ContextItem[];
  focusedContextItemId: string | null;
  id: number;
  patch?: PatchReviewState;
  question: string;
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

export type ComposeScreenState = {
  composer: ComposerState;
  contextItems: ContextItem[];
  focusedContextItemId: string | null;
  name: "compose";
};

export type AppState = {
  actions: AppActions;
  nextContextItemId: number;
  nextLlmRequestId: number;
  screen: AppScreen;
};

export type AppActions = {
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
    startLlmRequest: (options: { question: string }) => number | null;
  };
  navigation: {
    clearResponseAndMessage: () => void;
    rejectResponse: () => void;
    showComposer: () => void;
  };
  response: {
    appendDelta: (options: { delta: string; requestId: number }) => void;
    fail: (options: { errorMessage: string; requestId: number }) => void;
    failPatchApply: (options: {
      errorMessage: string;
      requestId: number;
    }) => void;
    finish: (options: { requestId: number; responseText: string }) => void;
    finishPatchApply: (options: { requestId: number }) => void;
    saveDiffToContext: (options: { requestId: number }) => void;
    saveTextToContext: (options: { requestId: number }) => void;
    setPatch: (options: { patch: PatchReviewState; requestId: number }) => void;
    startPatchApply: (options: { requestId: number }) => void;
  };
};

export type InProgressLlmRequestForState = InProgressLlmRequestState;
