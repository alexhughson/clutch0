import { expect, test } from "bun:test";
import type { AppActions, AppState } from "../../app/appTypes";
import {
  createInitialAppState,
  createInitialComposeScreen,
} from "../../app/appInitialState";
import { createSavedDiffContextItem } from "../../lib/context/contextItems";
import { createContextItemsActions } from "./contextItemsWorkflow";

function createHarness(
  initialState: AppState = {
    ...createInitialAppState(),
    actions: {} as AppActions,
  },
) {
  let state = initialState;
  const contextItems = createContextItemsActions({
    set: (partial) => {
      const next = typeof partial === "function" ? partial(state) : partial;
      state = { ...state, ...next };
    },
  });

  return {
    contextItems,
    get state() {
      return state;
    },
  };
}

test("opening a saved diff routes to the context item viewer task", () => {
  const diff = createSavedDiffContextItem({
    createdAt: 1,
    diffText: "diff --git a/a b/a",
    id: "saved:1",
    prompt: "Change a",
    proposal: { edits: [], summary: "Change a" },
    sourceRequestId: 1,
    summary: "Change a",
  });
  const harness = createHarness({
    ...createInitialAppState(),
    actions: {} as AppActions,
    nextContextItemId: 2,
    nextLlmRequestId: 1,
    workspace: {
      ...createInitialComposeScreen(),
      contextItems: [diff],
      focusedContextItemId: diff.id,
    },
  });

  harness.contextItems.openContextItem({ itemId: diff.id });

  expect(harness.state.activeTask?.kind).toBe("context-item-viewer");
});

test("finishing saved diff apply closes the task and removes the diff", () => {
  const diff = createSavedDiffContextItem({
    createdAt: 1,
    diffText: "diff --git a/a b/a",
    id: "saved:1",
    prompt: "Change a",
    proposal: { edits: [], summary: "Change a" },
    sourceRequestId: 1,
    summary: "Change a",
  });
  const workspace = {
    ...createInitialComposeScreen(),
    contextItems: [diff],
    focusedContextItemId: diff.id,
  };
  const harness = createHarness({
    actions: {} as AppActions,
    activeTask: {
      applyStatus: "applying",
      item: diff,
      kind: "context-item-viewer",
    },
    nextContextItemId: 2,
    nextLlmRequestId: 1,
    workspace,
  });

  harness.contextItems.finishSavedDiffApply({ itemId: diff.id });

  expect(harness.state.activeTask).toBeNull();
  expect(harness.state.workspace.contextItems).toEqual([]);
  expect(harness.state.workspace.focusedContextItemId).toBeNull();
});
