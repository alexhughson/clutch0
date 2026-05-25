import type { AppState, WorkspaceState } from "./appTypes";

export function createInitialAppState(): Omit<AppState, "actions"> {
  return {
    activeTask: null,
    nextContextItemId: 1,
    nextLlmRequestId: 1,
    workspace: createInitialWorkspace(),
  };
}

export function createInitialWorkspace(): WorkspaceState {
  return {
    composer: {
      cursorPosition: 0,
      message: "",
    },
    contextItems: [],
    focusedContextItemId: null,
  };
}

export const createInitialComposeScreen = createInitialWorkspace;
