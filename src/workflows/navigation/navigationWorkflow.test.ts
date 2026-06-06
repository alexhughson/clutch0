import { expect, test } from "bun:test";
import type { AppActions, AppState } from "../../app/appTypes";
import { createInitialAppState } from "../../app/appInitialState";
import { createNavigationActions } from "./navigationWorkflow";

function createHarness(initialState: AppState) {
  let state = initialState;
  const navigation = createNavigationActions({
    set: (partial) => {
      const next = typeof partial === "function" ? partial(state) : partial;
      state = { ...state, ...next };
    },
  });

  return {
    get state() {
      return state;
    },
    navigation,
  };
}

test("rejecting to edit closes the task while preserving composer text", () => {
  const harness = createHarness({
    ...createInitialAppState(),
    actions: {} as AppActions,
    activeTask: {
      kind: "response",
      request: {
        contextItems: [],
        focusedContextItemId: null,
        id: 1,
        question: "Update the code",
        responseText: "",
        status: "done",
      },
    },
    workspace: {
      ...createInitialAppState().workspace,
      composer: {
        cursorPosition: 15,
        message: "Update the code",
      },
    },
  });

  harness.navigation.rejectToEdit();

  expect(harness.state.activeTask).toBeNull();
  expect(harness.state.workspace.composer).toEqual({
    cursorPosition: 15,
    message: "Update the code",
  });
});

test("accepting closes the task and clears composer text", () => {
  const harness = createHarness({
    ...createInitialAppState(),
    actions: {} as AppActions,
    activeTask: {
      kind: "response",
      request: {
        contextItems: [],
        focusedContextItemId: null,
        id: 1,
        question: "Update the code",
        responseText: "",
        status: "done",
      },
    },
    workspace: {
      ...createInitialAppState().workspace,
      composer: {
        cursorPosition: 15,
        message: "Update the code",
      },
    },
  });

  harness.navigation.acceptAndClose();

  expect(harness.state.activeTask).toBeNull();
  expect(harness.state.workspace.composer).toEqual({
    cursorPosition: 0,
    message: "",
  });
});
