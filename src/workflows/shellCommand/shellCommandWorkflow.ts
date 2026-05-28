import { ContextDeck } from "../../app/contextDeck";
import type { AppActions, AppState } from "../../app/appTypes";
import { createShellCommandOutputContextItem } from "../../lib/context/contextItems";
import type { ShellCommandResult } from "../../lib/shell/shellCommand";

type SetAppState = (
  partial:
    | Partial<AppState>
    | AppState
    | ((state: AppState) => Partial<AppState> | AppState),
) => void;

type GetAppState = () => AppState;

export function createShellCommandActions({
  get,
  set,
}: {
  get: GetAppState;
  set: SetAppState;
}): AppActions["shellCommand"] {
  return {
    fail: ({ errorMessage, requestId }) =>
      set((state) => failShellCommand(state, requestId, errorMessage)),
    finish: ({ requestId, result }) =>
      set((state) => finishShellCommand(state, requestId, result)),
    saveOutputToContext: ({ requestId }) =>
      set((state) => saveShellCommandOutputToContext(state, requestId)),
    start: ({ prompt }) => startShellCommand({ get, prompt, set }),
  };
}

function startShellCommand({
  get,
  prompt,
  set,
}: {
  get: GetAppState;
  prompt: string;
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
      kind: "shell-command",
      prompt,
      status: "running",
    },
    nextLlmRequestId: requestId + 1,
  });

  return requestId;
}

function finishShellCommand(
  state: AppState,
  requestId: number,
  result: ShellCommandResult,
): Partial<AppState> | AppState {
  if (
    state.activeTask?.kind !== "shell-command" ||
    state.activeTask.id !== requestId ||
    state.activeTask.status !== "running"
  ) {
    return state;
  }

  return {
    activeTask: {
      ...state.activeTask,
      result,
      status: "done",
    },
  };
}

function failShellCommand(
  state: AppState,
  requestId: number,
  errorMessage: string,
): Partial<AppState> | AppState {
  if (
    state.activeTask?.kind !== "shell-command" ||
    state.activeTask.id !== requestId ||
    state.activeTask.status !== "running"
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

function saveShellCommandOutputToContext(
  state: AppState,
  requestId: number,
): Partial<AppState> | AppState {
  if (
    state.activeTask?.kind !== "shell-command" ||
    state.activeTask.id !== requestId ||
    state.activeTask.status !== "done" ||
    state.activeTask.result === undefined ||
    state.activeTask.savedContextItemId !== undefined
  ) {
    return state;
  }

  const itemId = `saved:${state.nextContextItemId}`;
  const item = createShellCommandOutputContextItem({
    createdAt: Date.now(),
    id: itemId,
    result: state.activeTask.result,
    sourceRequestId: requestId,
  });

  return {
    activeTask: {
      ...state.activeTask,
      savedContextItemId: itemId,
    },
    nextContextItemId: state.nextContextItemId + 1,
    workspace: ContextDeck.fromComposeScreen(state.workspace)
      .add(item)
      .applyTo(state.workspace),
  };
}
