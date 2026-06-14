import type { AppActions, AppState } from "../../app/appTypes";

type SetAppState = (
  partial:
    | Partial<AppState>
    | AppState
    | ((state: AppState) => Partial<AppState> | AppState),
) => void;

export function createNavigationActions({
  set,
}: {
  set: SetAppState;
}): AppActions["navigation"] {
  return {
    acceptAndClose: () => set(acceptAndClose),
    dismissPane: () => set(closePanePreservingComposer),
    rejectToEdit: () => set(rejectToEdit),
  };
}

function acceptAndClose(state: AppState): Partial<AppState> | AppState {
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

function closePanePreservingComposer(): Partial<AppState> {
  return { activeTask: null };
}

function rejectToEdit(state: AppState): Partial<AppState> {
  const rejectComposer =
    state.activeTask !== null && "rejectComposer" in state.activeTask
      ? state.activeTask.rejectComposer
      : undefined;
  if (rejectComposer === undefined) {
    return { activeTask: null };
  }

  return {
    activeTask: null,
    workspace: {
      ...state.workspace,
      composer: rejectComposer,
    },
  };
}
