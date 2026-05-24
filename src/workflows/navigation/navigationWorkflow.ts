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
    showComposer: () =>
      set((state) =>
        state.screen.name === "response"
          ? { screen: state.screen.returnToCompose }
          : state,
      ),
  };
}

function clearResponseAndMessage(
  state: AppState,
): Partial<AppState> | AppState {
  return state.screen.name === "response"
    ? {
        screen: {
          ...state.screen.returnToCompose,
          composer: {
            cursorPosition: 0,
            message: "",
          },
        },
      }
    : state;
}
