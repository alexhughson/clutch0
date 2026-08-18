import { ContextDeck } from "../../app/contextDeck";
import type { AppActions, AppState } from "../../app/appTypes";
import { getVisibleContextItemById } from "../../lib/context/automaticContextItems";
import { getContextItemById } from "../../lib/context/contextItems";

type SetAppState = (
  partial:
    | Partial<AppState>
    | AppState
    | ((state: AppState) => Partial<AppState> | AppState),
) => void;

type GetAppState = () => AppState;

export function createContextItemsActions({
  get,
  set,
}: {
  get: GetAppState;
  set: SetAppState;
}): AppActions["contextItems"] {
  return {
    allocateLlmRequestId: () => {
      const requestId = get().nextLlmRequestId;
      set({ nextLlmRequestId: requestId + 1 });
      return requestId;
    },
    failSavedDiffApply: ({ errorMessage, itemId }) =>
      set((state) =>
        state.activeTask?.kind === "context-item-viewer" &&
        state.activeTask.itemId === itemId
          ? {
              activeTask: {
                ...state.activeTask,
                applyErrorMessage: errorMessage,
                applyStatus: "apply-error",
              },
            }
          : state,
      ),
    finishAgentSessionDiffApply: ({ itemId }) =>
      set((state) => finishAgentSessionDiffApply(state, itemId)),
    finishSavedDiffApply: ({ itemId }) =>
      set((state) => finishSavedDiffApply(state, itemId)),
    openContextItem: ({ itemId }) =>
      set((state) => openContextItem(state, itemId)),
    setAutoRegenerate: ({ enabled, itemId }) =>
      set((state) => setAutoRegenerate(state, itemId, enabled)),
    setPinned: ({ itemId, pinned }) =>
      set((state) => setPinned(state, itemId, pinned)),
    startSavedDiffApply: ({ itemId }) =>
      set((state) => startSavedDiffApply(state, itemId)),
  };
}

function openContextItem(
  state: AppState,
  itemId: string,
): Partial<AppState> | AppState {
  const item = getVisibleContextItemById(
    state.workspace.contextItems,
    itemId,
    state.workspace.automaticContextItems,
  );
  if (item === null) {
    return state;
  }

  return {
    activeTask: {
      applyStatus: "idle",
      itemId: item.id,
      kind: "context-item-viewer",
    },
  };
}

function startSavedDiffApply(
  state: AppState,
  itemId: string,
): Partial<AppState> | AppState {
  const item = getVisibleContextItemById(
    state.workspace.contextItems,
    itemId,
    state.workspace.automaticContextItems,
  );
  if (item === null) {
    return state;
  }

  return {
    activeTask: {
      applyErrorMessage: undefined,
      applyStatus: "applying",
      itemId: item.id,
      kind: "context-item-viewer",
    },
  };
}

function finishSavedDiffApply(
  state: AppState,
  itemId: string,
): Partial<AppState> | AppState {
  return {
    activeTask: null,
    workspace: ContextDeck.fromComposeScreen(state.workspace)
      .remove(itemId)
      .applyTo(state.workspace),
  };
}

function setPinned(
  state: AppState,
  itemId: string,
  pinned: boolean,
): Partial<AppState> | AppState {
  const item = getContextItemById(state.workspace.contextItems, itemId);
  if (item === null) {
    throw new Error(`Cannot pin context item ${itemId}: item is not in the workspace deck.`);
  }

  return {
    workspace: ContextDeck.fromComposeScreen(state.workspace)
      .replace(item.withPinned(pinned))
      .applyTo(state.workspace),
  };
}

function setAutoRegenerate(
  state: AppState,
  itemId: string,
  enabled: boolean,
): Partial<AppState> | AppState {
  const item = getContextItemById(state.workspace.contextItems, itemId);
  if (item === null) {
    throw new Error(
      `Cannot set auto-regenerate on context item ${itemId}: item is not in the workspace deck.`,
    );
  }
  if (item.withAutoRegenerate === undefined) {
    throw new Error(
      `Cannot set auto-regenerate on ${item.type} item ${itemId}.`,
    );
  }

  return {
    workspace: ContextDeck.fromComposeScreen(state.workspace)
      .replace(item.withAutoRegenerate(enabled))
      .applyTo(state.workspace),
  };
}

function finishAgentSessionDiffApply(
  state: AppState,
  itemId: string,
): Partial<AppState> | AppState {
  if (
    state.activeTask?.kind !== "context-item-viewer" ||
    state.activeTask.itemId !== itemId
  ) {
    return state;
  }

  return {
    activeTask: {
      ...state.activeTask,
      applyErrorMessage: undefined,
      applyStatus: "idle",
    },
  };
}
