import { ContextDeck } from "../../app/contextDeck";
import type { AppActions, AppState } from "../../app/appTypes";
import { getContextItemById } from "../../lib/context/contextItems";

type SetAppState = (
  partial:
    | Partial<AppState>
    | AppState
    | ((state: AppState) => Partial<AppState> | AppState),
) => void;

export function createContextItemsActions({
  set,
}: {
  set: SetAppState;
}): AppActions["contextItems"] {
  return {
    failSavedDiffApply: ({ errorMessage, itemId }) =>
      set((state) =>
        state.activeTask?.kind === "context-item-viewer" &&
        state.activeTask.item.id === itemId
          ? {
              activeTask: {
                ...state.activeTask,
                applyErrorMessage: errorMessage,
                applyStatus: "apply-error",
              },
            }
          : state,
      ),
    finishSavedDiffApply: ({ itemId }) =>
      set((state) => finishSavedDiffApply(state, itemId)),
    openContextItem: ({ itemId }) =>
      set((state) => openContextItem(state, itemId)),
    startSavedDiffApply: ({ itemId }) =>
      set((state) => startSavedDiffApply(state, itemId)),
  };
}

function openContextItem(
  state: AppState,
  itemId: string,
): Partial<AppState> | AppState {
  const item = getContextItemById(state.workspace.contextItems, itemId);
  if (item === null) {
    return state;
  }

  return {
    activeTask: {
      applyStatus: "idle",
      item,
      kind: "context-item-viewer",
    },
  };
}

function startSavedDiffApply(
  state: AppState,
  itemId: string,
): Partial<AppState> | AppState {
  const item = getContextItemById(state.workspace.contextItems, itemId);
  if (item === null) {
    return state;
  }

  return {
    activeTask: {
      applyErrorMessage: undefined,
      applyStatus: "applying",
      item,
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
