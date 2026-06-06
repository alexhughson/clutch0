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
    rejectToEdit: () => set(closePanePreservingComposer),
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
