import type { AppActions, AppState } from "../../app/appTypes";

type SetAppState = (
  partial:
    | Partial<AppState>
    | AppState
    | ((state: AppState) => Partial<AppState> | AppState),
) => void;

type GetAppState = () => AppState;

export function createShowContextActions({
  get,
  set,
}: {
  get: GetAppState;
  set: SetAppState;
}): AppActions["showContext"] {
  return {
    fail: ({ errorMessage, requestId }) =>
      set((state) => failShowContext(state, requestId, errorMessage)),
    finish: ({ content, requestId }) =>
      set((state) => finishShowContext(state, requestId, content)),
    start: ({ question }) => startShowContext({ get, question, set }),
  };
}

function startShowContext({
  get,
  question,
  set,
}: {
  get: GetAppState;
  question: string;
  set: SetAppState;
}): number | null {
  const state = get();
  if (state.activeTask !== null) {
    return null;
  }

  const requestId = state.nextLlmRequestId;
  set({
    activeTask: {
      id: requestId,
      kind: "show-context",
      question,
      status: "loading",
    },
    nextLlmRequestId: requestId + 1,
  });

  return requestId;
}

function finishShowContext(
  state: AppState,
  requestId: number,
  content: string,
): Partial<AppState> | AppState {
  if (
    state.activeTask?.kind !== "show-context" ||
    state.activeTask.id !== requestId ||
    state.activeTask.status !== "loading"
  ) {
    return state;
  }

  return {
    activeTask: {
      ...state.activeTask,
      content,
      status: "done",
    },
  };
}

function failShowContext(
  state: AppState,
  requestId: number,
  errorMessage: string,
): Partial<AppState> | AppState {
  if (
    state.activeTask?.kind !== "show-context" ||
    state.activeTask.id !== requestId ||
    state.activeTask.status !== "loading"
  ) {
    return state;
  }

  return {
    activeTask: {
      ...state.activeTask,
      errorMessage,
      status: "error",
    },
  };
}
