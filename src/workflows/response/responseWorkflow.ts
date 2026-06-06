import { ContextDeck } from "../../app/contextDeck";
import type {
  AppActions,
  AppState,
  InProgressLlmRequestForState,
  LlmRequestState,
} from "../../app/appTypes";
import {
  createLiveLlmResponseContextItem,
  createSavedDiffContextItem,
  createSavedLlmResponseContextItem,
  getContextItemById,
  hasContextItem,
  LiveLlmResponseContextItem,
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
      set((state) => appendResponseDelta(state, requestId, delta)),
    fail: ({ errorMessage, requestId, responseText }) =>
      set((state) =>
        failResponse(state, requestId, errorMessage, responseText),
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
      set((state) =>
        setPatchOnActiveRequest(
          state,
          getActiveLlmRequest(state, requestId),
          patch,
          requestId,
        ),
      ),
    startPatchApply: ({ requestId }) =>
      set((state) =>
        updatePatchApplyState(state, requestId, {
          applyErrorMessage: undefined,
          applyStatus: "applying",
        }),
      ),
  };
}

function appendResponseDelta(
  state: AppState,
  requestId: number,
  delta: string,
): Partial<AppState> | AppState {
  const activeUpdate = isActiveInProgressLlmRequest(state, requestId)
    ? setActiveLlmRequest(state, {
        ...state.activeTask.request,
        responseText: state.activeTask.request.responseText + delta,
        status: "streaming",
      })
    : {};
  const nextState = { ...state, ...activeUpdate };

  return updateLiveLlmResponseItem(nextState, requestId, (item) =>
    item.withOutput(item.output + delta),
  );
}

function failResponse(
  state: AppState,
  requestId: number,
  errorMessage: string,
  responseText?: string,
): Partial<AppState> | AppState {
  const activeUpdate = isActiveInProgressLlmRequest(state, requestId)
    ? setActiveLlmRequest(state, {
        ...state.activeTask.request,
        errorMessage,
        responseText: responseText ?? state.activeTask.request.responseText,
        status: "error",
      })
    : {};
  const nextState = { ...state, ...activeUpdate };

  return updateLiveLlmResponseItem(nextState, requestId, (item) =>
    (responseText === undefined
      ? item
      : item.withOutput(responseText)
    ).withError(errorMessage),
  );
}

function finishResponse(
  state: AppState,
  requestId: number,
  responseText: string,
  responseKind: "patch" | "text",
): Partial<AppState> | AppState {
  const liveItem = getLiveLlmResponseItemByRequestId(state, requestId);
  if (!isActiveInProgressLlmRequest(state, requestId)) {
    if (liveItem === null || responseKind !== "text") {
      return state;
    }

    const item = createSavedTextResponseItem({
      createdAt: liveItem.createdAt,
      id: liveItem.id,
      output: responseText,
      prompt: liveItem.prompt,
      sourceRequestId: requestId,
    });

    return {
      workspace: ContextDeck.fromComposeScreen(state.workspace)
        .replace(item)
        .applyTo(state.workspace),
    };
  }

  const request: LlmRequestState = {
    ...state.activeTask.request,
    responseText,
    status: "done",
  };

  if (liveItem !== null && responseKind === "text") {
    const item = createSavedTextResponseItem({
      createdAt: liveItem.createdAt,
      id: liveItem.id,
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

  const item = createSavedTextResponseItem({
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
  request: LlmRequestState | null,
  patch: PatchReviewState,
  requestId: number,
): Partial<AppState> | AppState {
  const liveItem = getLiveLlmResponseItemByRequestId(state, requestId);
  if (request === null) {
    if (liveItem === null) {
      return state;
    }

    if (patch.status !== "valid") {
      return updateLiveLlmResponseItem(state, requestId, (item) =>
        item.withError(formatPatchValidationErrors(patch)),
      );
    }

    const item = createSavedDiffItem({
      createdAt: liveItem.createdAt,
      id: liveItem.id,
      prompt: liveItem.prompt,
      patch,
      sourceRequestId: requestId,
    });

    return {
      workspace: ContextDeck.fromComposeScreen(state.workspace)
        .replace(item)
        .applyTo(state.workspace),
    };
  }

  const requestWithPatch: LlmRequestState = {
    ...request,
    patch,
  };

  if (liveItem !== null && patch.status === "valid") {
    const item = createSavedDiffItem({
      createdAt: liveItem.createdAt,
      id: liveItem.id,
      prompt: requestWithPatch.question,
      patch,
      sourceRequestId: requestWithPatch.id,
    });

    return {
      activeTask:
        state.activeTask?.kind === "response"
          ? {
              ...state.activeTask,
              request: {
                ...requestWithPatch,
                savedContextItemId: item.id,
              },
            }
          : state.activeTask,
      workspace: ContextDeck.fromComposeScreen(state.workspace)
        .replace(item)
        .applyTo(state.workspace),
    };
  }

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

  const item = createSavedDiffItem({
    createdAt: Date.now(),
    id: requestWithPatch.replacement.contextItemId,
    prompt: requestWithPatch.question,
    patch,
    sourceRequestId: requestWithPatch.id,
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
  const item = createSavedDiffItem({
    createdAt: Date.now(),
    id: itemId,
    prompt: request.question,
    patch: request.patch,
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

function saveTextToContext(
  state: AppState,
  requestId: number,
): Partial<AppState> | AppState {
  const request = getActiveLlmRequest(state, requestId);
  if (
    state.activeTask?.kind !== "response" ||
    request === null ||
    request.patch !== undefined ||
    request.savedContextItemId !== undefined
  ) {
    return state;
  }

  if (request.status === "loading" || request.status === "streaming") {
    const itemId = `saved:${state.nextContextItemId}`;
    const item = createLiveLlmResponseContextItem({
      createdAt: Date.now(),
      id: itemId,
      output: request.responseText,
      prompt: request.question,
      sourceRequestId: request.id,
    });

    return {
      activeTask: null,
      nextContextItemId: state.nextContextItemId + 1,
      workspace: ContextDeck.fromComposeScreen(state.workspace)
        .add(item)
        .applyTo(state.workspace),
    };
  }

  if (request.status !== "done" || request.responseText.trim().length === 0) {
    return state;
  }

  const itemId = `saved:${state.nextContextItemId}`;
  const item = createSavedTextResponseItem({
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

function createSavedTextResponseItem({
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
}) {
  return createSavedLlmResponseContextItem({
    createdAt,
    id,
    output,
    prompt,
    sourceRequestId,
  });
}

function createSavedDiffItem({
  createdAt,
  id,
  patch,
  prompt,
  sourceRequestId,
}: {
  createdAt: number;
  id: string;
  patch: Extract<PatchReviewState, { status: "valid" }>;
  prompt: string;
  sourceRequestId: number;
}) {
  return createSavedDiffContextItem({
    createdAt,
    diffText: patch.diffText,
    id,
    prompt,
    proposal: patch.proposal,
    sourceRequestId,
    summary: patch.proposal.summary,
  });
}

function formatPatchValidationErrors(patch: PatchReviewState): string {
  if (patch.status !== "invalid") {
    return "Patch could not be applied cleanly.";
  }

  return patch.errors
    .map((error) => `${error.path || "<unknown>"}: ${error.message}`)
    .join("\n");
}

function updateLiveLlmResponseItem(
  state: AppState,
  requestId: number,
  update: (item: LiveLlmResponseContextItem) => LiveLlmResponseContextItem,
): Partial<AppState> | AppState {
  const item = getLiveLlmResponseItemByRequestId(state, requestId);
  if (item === null) {
    return state;
  }

  return {
    ...state,
    workspace: ContextDeck.fromComposeScreen(state.workspace)
      .replace(update(item))
      .applyTo(state.workspace),
  };
}

function getLiveLlmResponseItemByRequestId(
  state: AppState,
  requestId: number,
): LiveLlmResponseContextItem | null {
  const item = state.workspace.contextItems.find(
    (contextItem) =>
      contextItem instanceof LiveLlmResponseContextItem &&
      contextItem.sourceRequestId === requestId,
  );

  return item instanceof LiveLlmResponseContextItem ? item : null;
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
