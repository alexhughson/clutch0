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
    clearResponseAndMessage: () => set(clearResponseAndMessage),
    rejectResponse: () => set(clearResponseAndMessage),
    showComposer: () => set({ activeTask: null }),
  };
}

function clearResponseAndMessage(
  state: AppState,
): Partial<AppState> | AppState {
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
