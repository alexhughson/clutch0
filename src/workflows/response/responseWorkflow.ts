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
              ...state.screen.request,
              responseText: state.screen.request.responseText + delta,
              status: "streaming",
            })
          : state,
      ),
    fail: ({ errorMessage, requestId }) =>
      set((state) =>
        isActiveInProgressLlmRequest(state, requestId)
          ? setActiveLlmRequest(state, {
              ...state.screen.request,
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
    finish: ({ requestId, responseText }) =>
      set((state) =>
        isActiveInProgressLlmRequest(state, requestId)
          ? setActiveLlmRequest(state, {
              ...state.screen.request,
              responseText,
              status: "done",
            })
          : state,
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

        return setActiveLlmRequest(state, {
          ...request,
          patch,
        });
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
  if (state.screen.name !== "response" || request?.patch === undefined) {
    return state;
  }

  return {
    screen: {
      ...state.screen.returnToCompose,
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
    state.screen.name !== "response" ||
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
    nextContextItemId: state.nextContextItemId + 1,
    screen: {
      ...state.screen,
      request: {
        ...request,
        savedContextItemId: itemId,
      },
      returnToCompose: ContextDeck.fromComposeScreen(
        state.screen.returnToCompose,
      )
        .add(item)
        .applyTo(state.screen.returnToCompose),
    },
  };
}

function saveTextToContext(
  state: AppState,
  requestId: number,
): Partial<AppState> | AppState {
  const request = getActiveLlmRequest(state, requestId);
  if (
    state.screen.name !== "response" ||
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
    nextContextItemId: state.nextContextItemId + 1,
    screen: {
      ...state.screen,
      request: {
        ...request,
        savedContextItemId: itemId,
      },
      returnToCompose: ContextDeck.fromComposeScreen(
        state.screen.returnToCompose,
      )
        .add(item)
        .applyTo(state.screen.returnToCompose),
    },
  };
}

function isActiveInProgressLlmRequest(
  state: AppState,
  requestId: number,
): state is AppState & {
  screen: { name: "response"; request: InProgressLlmRequestForState };
} {
  return (
    state.screen.name === "response" &&
    state.screen.request.id === requestId &&
    (state.screen.request.status === "loading" ||
      state.screen.request.status === "streaming")
  );
}

function getActiveLlmRequest(
  state: AppState,
  requestId: number,
): LlmRequestState | null {
  return state.screen.name === "response" &&
    state.screen.request.id === requestId
    ? state.screen.request
    : null;
}

function setActiveLlmRequest(
  state: AppState,
  request: LlmRequestState,
): AppState | Pick<AppState, "screen"> {
  if (state.screen.name !== "response") {
    return state;
  }

  return {
    screen: {
      ...state.screen,
      name: "response",
      request,
    },
  };
}
