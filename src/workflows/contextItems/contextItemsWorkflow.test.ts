import { expect, test } from "bun:test";
import type { AppActions, AppState } from "../../app/appTypes";
import {
  createInitialAppState,
  createInitialComposeScreen,
} from "../../app/appInitialState";
import {
  createPiAgentContextItem,
  createSavedDiffContextItem,
  createSavedLlmResponseContextItem,
} from "../../lib/context/contextItems";
import { createContextItemsActions } from "./contextItemsWorkflow";

function createHarness(
  initialState: AppState = {
    ...createInitialAppState(),
    actions: {} as AppActions,
  },
) {
  let state = initialState;
  const contextItems = createContextItemsActions({
    get: () => state,
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
    proposal: {
      patch:
        "*** Begin Patch\n*** Update File: a\n@@\n-old\n+new\n*** End Patch",
      summary: "Change a",
    },
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
    proposal: {
      patch:
        "*** Begin Patch\n*** Update File: a\n@@\n-old\n+new\n*** End Patch",
      summary: "Change a",
    },
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
      itemId: diff.id,
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

test("finishing agent session diff apply keeps the agent item open", () => {
  const agent = createPiAgentContextItem({
    createdAt: 1,
    id: "agent:1",
    prompt: "edit files",
  }).withSandbox({
    baselineTree: "tree",
    diffStatus: "dirty",
    path: "/tmp/sandbox",
    root: "/tmp/root",
    summary: "1 file changed",
  });
  const harness = createHarness({
    actions: {} as AppActions,
    activeTask: {
      applyStatus: "applying",
      itemId: agent.id,
      kind: "context-item-viewer",
    },
    nextContextItemId: 2,
    nextLlmRequestId: 1,
    workspace: {
      ...createInitialComposeScreen(),
      contextItems: [agent],
      focusedContextItemId: agent.id,
    },
  });

  harness.contextItems.finishAgentSessionDiffApply({ itemId: agent.id });

  expect(harness.state.activeTask).toEqual({
    applyErrorMessage: undefined,
    applyStatus: "idle",
    itemId: agent.id,
    kind: "context-item-viewer",
  });
  expect(harness.state.workspace.contextItems).toEqual([agent]);
});

test("setPinned updates the item in the deck", () => {
  const ask = createSavedLlmResponseContextItem({
    createdAt: 1,
    id: "saved:1",
    output: "answer",
    prompt: "question",
    sourceRequestId: 1,
  });
  const harness = createHarness({
    ...createInitialAppState(),
    actions: {} as AppActions,
    workspace: {
      ...createInitialComposeScreen(),
      contextItems: [ask],
      focusedContextItemId: ask.id,
    },
  });

  harness.contextItems.setPinned({ itemId: ask.id, pinned: true });

  expect(harness.state.workspace.contextItems[0]?.isPinned()).toBe(true);
});

test("setAutoRegenerate updates a rerunnable item", () => {
  const ask = createSavedLlmResponseContextItem({
    createdAt: 1,
    id: "saved:1",
    output: "answer",
    prompt: "question",
    sourceRequestId: 1,
  });
  const harness = createHarness({
    ...createInitialAppState(),
    actions: {} as AppActions,
    workspace: {
      ...createInitialComposeScreen(),
      contextItems: [ask],
      focusedContextItemId: ask.id,
    },
  });

  harness.contextItems.setAutoRegenerate({ enabled: true, itemId: ask.id });

  expect(harness.state.workspace.contextItems[0]?.getAutoRegenerate?.()).toBe(
    true,
  );
});

test("allocateLlmRequestId increments the counter without opening a pane", () => {
  const harness = createHarness();

  expect(harness.contextItems.allocateLlmRequestId()).toBe(1);
  expect(harness.state.nextLlmRequestId).toBe(2);
  expect(harness.state.activeTask).toBeNull();
});
