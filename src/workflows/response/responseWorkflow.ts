import { ContextDeck } from "../../app/contextDeck";
import type {
  AppActions,
  AppState,
  InProgressLlmRequestForState,
  LlmRequestState,
} from "../../app/appTypes";
import {
  createSavedDiffContextItem,
  createSavedLlmResponseContextItem,
  hasContextItem,
} from "../../lib/context/contextItems";
import type { PatchReviewState } from "../../lib/patch/types";

type SetAppState = (
  partial:
    | Partial<AppState>
    | AppState
    | ((state: AppState) => Partial<AppState> | AppState),
) => void;

export function createResponseActions({
  set,
}: {
  set: SetAppState;
}): AppActions["response"] {
  return {
    appendDelta: ({ delta, requestId }) =>
      set((state) =>
        isActiveInProgressLlmRequest(state, requestId)
          ? setActiveLlmRequest(state, {
              ...state.activeTask.request,
              responseText: state.activeTask.request.responseText + delta,
              status: "streaming",
            })
          : state,
      ),
    fail: ({ errorMessage, requestId }) =>
      set((state) =>
        isActiveInProgressLlmRequest(state, requestId)
          ? setActiveLlmRequest(state, {
              ...state.activeTask.request,
              errorMessage,
              status: "error",
            })
          : state,
      ),
    failPatchApply: ({ errorMessage, requestId }) =>
      set((state) =>
        updatePatchApplyState(state, requestId, {
          applyErrorMessage: errorMessage,
          applyStatus: "apply-error",
        }),
      ),
    finish: ({ requestId, responseKind, responseText }) =>
      set((state) =>
        finishResponse(state, requestId, responseText, responseKind),
      ),
    finishPatchApply: ({ requestId }) =>
      set((state) => clearAppliedPatchWorkflow(state, requestId)),
    saveDiffToContext: ({ requestId }) =>
      set((state) => saveDiffToContext(state, requestId)),
    saveTextToContext: ({ requestId }) =>
      set((state) => saveTextToContext(state, requestId)),
    setPatch: ({ patch, requestId }) =>
      set((state) => {
        const request = getActiveLlmRequest(state, requestId);
        if (request === null) {
          return state;
        }

        return setPatchOnActiveRequest(state, request, patch);
      }),
    startPatchApply: ({ requestId }) =>
      set((state) =>
        updatePatchApplyState(state, requestId, {
          applyErrorMessage: undefined,
          applyStatus: "applying",
        }),
      ),
  };
}

function finishResponse(
  state: AppState,
  requestId: number,
  responseText: string,
  responseKind: "patch" | "text",
): Partial<AppState> | AppState {
  if (!isActiveInProgressLlmRequest(state, requestId)) {
    return state;
  }

  const request: LlmRequestState = {
    ...state.activeTask.request,
    responseText,
    status: "done",
  };

  if (
    responseKind !== "text" ||
    request.replacement?.expectedResult !== "text" ||
    !hasContextItem(
      state.workspace.contextItems,
      request.replacement.contextItemId,
    )
  ) {
    return setActiveLlmRequest(state, request);
  }

  const item = createSavedLlmResponseContextItem({
    createdAt: Date.now(),
    id: request.replacement.contextItemId,
    output: responseText,
    prompt: request.question,
    sourceRequestId: request.id,
  });

  return {
    activeTask: {
      ...state.activeTask,
      request: {
        ...request,
        savedContextItemId: item.id,
      },
    },
    workspace: ContextDeck.fromComposeScreen(state.workspace)
      .replace(item)
      .applyTo(state.workspace),
  };
}

function setPatchOnActiveRequest(
  state: AppState,
  request: LlmRequestState,
  patch: PatchReviewState,
): Partial<AppState> | AppState {
  const requestWithPatch: LlmRequestState = {
    ...request,
    patch,
  };

  if (
    state.activeTask?.kind !== "response" ||
    requestWithPatch.replacement?.expectedResult !== "diff" ||
    patch.status !== "valid" ||
    !hasContextItem(
      state.workspace.contextItems,
      requestWithPatch.replacement.contextItemId,
    )
  ) {
    return setActiveLlmRequest(state, requestWithPatch);
  }

  const item = createSavedDiffContextItem({
    createdAt: Date.now(),
    diffText: patch.diffText,
    id: requestWithPatch.replacement.contextItemId,
    prompt: requestWithPatch.question,
    proposal: patch.proposal,
    sourceRequestId: requestWithPatch.id,
    summary: patch.proposal.summary,
  });

  return {
    activeTask: {
      ...state.activeTask,
      request: {
        ...requestWithPatch,
        savedContextItemId: item.id,
      },
    },
    workspace: ContextDeck.fromComposeScreen(state.workspace)
      .replace(item)
      .applyTo(state.workspace),
  };
}

function updatePatchApplyState(
  state: AppState,
  requestId: number,
  patchState: Pick<PatchReviewState, "applyStatus"> & {
    applyErrorMessage?: string;
  },
): Partial<AppState> | AppState {
  const request = getActiveLlmRequest(state, requestId);
  if (request?.patch === undefined) {
    return state;
  }

  return setActiveLlmRequest(state, {
    ...request,
    patch: {
      ...request.patch,
      ...patchState,
    },
  });
}

function clearAppliedPatchWorkflow(
  state: AppState,
  requestId: number,
): Partial<AppState> | AppState {
  const request = getActiveLlmRequest(state, requestId);
  if (request?.patch === undefined) {
    return state;
  }

  return {
    activeTask: null,
    workspace: {
      ...state.workspace,
      composer: {
        cursorPosition: 0,
        message: "",
      },
    },
  };
}

function saveDiffToContext(
  state: AppState,
  requestId: number,
): Partial<AppState> | AppState {
  const request = getActiveLlmRequest(state, requestId);
  if (
    state.activeTask?.kind !== "response" ||
    request === null ||
    request.status !== "done" ||
    request.patch === undefined ||
    request.patch.status !== "valid" ||
    request.savedContextItemId !== undefined
  ) {
    return state;
  }

  const itemId = `saved:${state.nextContextItemId}`;
  const item = createSavedDiffContextItem({
    createdAt: Date.now(),
    diffText: request.patch.diffText,
    id: itemId,
    prompt: request.question,
    proposal: request.patch.proposal,
    sourceRequestId: request.id,
    summary: request.patch.proposal.summary,
  });

  return {
    activeTask: {
      ...state.activeTask,
      request: {
        ...request,
        savedContextItemId: itemId,
      },
    },
    nextContextItemId: state.nextContextItemId + 1,
    workspace: ContextDeck.fromComposeScreen(state.workspace)
      .add(item)
      .applyTo(state.workspace),
  };
}

function saveTextToContext(
  state: AppState,
  requestId: number,
): Partial<AppState> | AppState {
  const request = getActiveLlmRequest(state, requestId);
  if (
    state.activeTask?.kind !== "response" ||
    request === null ||
    request.status !== "done" ||
    request.patch !== undefined ||
    request.responseText.trim().length === 0 ||
    request.savedContextItemId !== undefined
  ) {
    return state;
  }

  const itemId = `saved:${state.nextContextItemId}`;
  const item = createSavedLlmResponseContextItem({
    createdAt: Date.now(),
    id: itemId,
    output: request.responseText,
    prompt: request.question,
    sourceRequestId: request.id,
  });

  return {
    activeTask: {
      ...state.activeTask,
      request: {
        ...request,
        savedContextItemId: itemId,
      },
    },
    nextContextItemId: state.nextContextItemId + 1,
    workspace: ContextDeck.fromComposeScreen(state.workspace)
      .add(item)
      .applyTo(state.workspace),
  };
}

function isActiveInProgressLlmRequest(
  state: AppState,
  requestId: number,
): state is AppState & {
  activeTask: { kind: "response"; request: InProgressLlmRequestForState };
} {
  return (
    state.activeTask?.kind === "response" &&
    state.activeTask.request.id === requestId &&
    (state.activeTask.request.status === "loading" ||
      state.activeTask.request.status === "streaming")
  );
}

function getActiveLlmRequest(
  state: AppState,
  requestId: number,
): LlmRequestState | null {
  return state.activeTask?.kind === "response" &&
    state.activeTask.request.id === requestId
    ? state.activeTask.request
    : null;
}

function setActiveLlmRequest(
  state: AppState,
  request: LlmRequestState,
): AppState | Pick<AppState, "activeTask"> {
  if (state.activeTask?.kind !== "response") {
    return state;
  }

  return {
    activeTask: {
      ...state.activeTask,
      request,
    },
  };
}
