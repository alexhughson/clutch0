import { ContextDeck } from "../../app/contextDeck";
import type { AppActions, AppState } from "../../app/appTypes";
import { createFileContextItem } from "../../lib/context/contextItems";
import type { CreateFileValidationResult } from "../../lib/createFile/createFile";

export type SetAppState = (
  partial:
    | Partial<AppState>
    | AppState
    | ((state: AppState) => Partial<AppState> | AppState),
) => void;

export function createCreateFileActions({
  set,
}: {
  set: SetAppState;
}): AppActions["createFile"] {
  return {
    failApply: ({ errorMessage, requestId }) =>
      set((state) => failCreateFileApply(state, requestId, errorMessage)),
    finishApply: ({ requestId }) =>
      set((state) => finishCreateFileApply(state, requestId)),
    showReview: ({ requestId, validation }) =>
      set((state) => showCreateFileReview(state, requestId, validation)),
    startApply: ({ requestId }) =>
      set((state) => updateCreateFileApplyState(state, requestId, "applying")),
  };
}

function showCreateFileReview(
  state: AppState,
  requestId: number,
  validation: CreateFileValidationResult,
): Partial<AppState> | AppState {
  if (
    state.activeTask?.kind !== "response" ||
    state.activeTask.request.id !== requestId
  ) {
    return state;
  }

  return {
    activeTask: {
      applyStatus: "pending",
      id: requestId,
      kind: "create-file",
      prompt: state.activeTask.request.question,
      validation,
    },
  };
}

function updateCreateFileApplyState(
  state: AppState,
  requestId: number,
  applyStatus: "applying" | "pending",
): Partial<AppState> | AppState {
  if (
    state.activeTask?.kind !== "create-file" ||
    state.activeTask.id !== requestId
  ) {
    return state;
  }

  return {
    activeTask: {
      ...state.activeTask,
      applyErrorMessage: undefined,
      applyStatus,
    },
  };
}

function failCreateFileApply(
  state: AppState,
  requestId: number,
  errorMessage: string,
): Partial<AppState> | AppState {
  if (
    state.activeTask?.kind !== "create-file" ||
    state.activeTask.id !== requestId
  ) {
    return state;
  }

  return {
    activeTask: {
      ...state.activeTask,
      applyErrorMessage: errorMessage,
      applyStatus: "apply-error",
    },
  };
}

function finishCreateFileApply(
  state: AppState,
  requestId: number,
): Partial<AppState> | AppState {
  if (
    state.activeTask?.kind !== "create-file" ||
    state.activeTask.id !== requestId ||
    state.activeTask.validation.status !== "valid"
  ) {
    return state;
  }

  const item = createFileContextItem(state.activeTask.validation.proposal.path);

  return {
    activeTask: null,
    workspace: {
      ...ContextDeck.fromComposeScreen(state.workspace)
        .add(item)
        .applyTo(state.workspace),
      composer: {
        cursorPosition: 0,
        message: "",
      },
    },
  };
}
