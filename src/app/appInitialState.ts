import type { AppState, ComposeScreenState } from "./appTypes";

export function createInitialAppState(): Omit<AppState, "actions"> {
  return {
    nextContextItemId: 1,
    nextLlmRequestId: 1,
    screen: createInitialComposeScreen(),
  };
}

export function createInitialComposeScreen(): ComposeScreenState {
  return {
    composer: {
      cursorPosition: 0,
      message: "",
    },
    contextItems: [],
    focusedContextItemId: null,
    name: "compose",
  };
}
