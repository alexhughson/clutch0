import { expect, test } from "bun:test";
import type { AppActions, AppState } from "../../app/appTypes";
import { createInitialAppState } from "../../app/appInitialState";
import {
  createFileContextItem,
  getFileContextItemId,
  createSavedLlmResponseContextItem,
} from "../../lib/context/contextItems";
import { createComposeActions } from "./composeWorkflow";

function createHarness(initialState: Omit<AppState, "actions">) {
  let state: AppState = { ...initialState, actions: {} as AppActions };
  const compose = createComposeActions({
    get: () => state,
    set: (partial) => {
      const next = typeof partial === "function" ? partial(state) : partial;
      state = { ...state, ...next };
    },
  });

  return {
    compose,
    get state() {
      return state;
    },
  };
}

test("rerunning a prompt keeps the original prompt and snapshots latest context without the replaced item", () => {
  const oldResponse = createSavedLlmResponseContextItem({
    createdAt: 1,
    id: "saved:1",
    output: "old answer",
    prompt: "Explain auth flow",
    sourceRequestId: 1,
  });
  const latestFile = createFileContextItem("src/auth.ts");
  const harness = createHarness({
    ...createInitialAppState(),
    nextLlmRequestId: 2,
    workspace: {
      ...createInitialAppState().workspace,
      contextItems: [oldResponse, latestFile],
      focusedContextItemId: latestFile.id,
    },
  });

  const requestId = harness.compose.startLlmRequest({
    question: oldResponse.prompt,
    replacement: {
      contextItemId: oldResponse.id,
      expectedResult: "text",
    },
  });

  expect(requestId).toBe(2);
  expect(harness.state.activeTask).toMatchObject({ kind: "response" });
  if (harness.state.activeTask?.kind !== "response") {
    return;
  }

  expect(harness.state.activeTask.request.question).toBe("Explain auth flow");
  expect(
    harness.state.activeTask.request.contextItems.map((item) => item.id),
  ).toEqual([getFileContextItemId("AGENTS.md"), latestFile.id]);
  expect(harness.state.activeTask.request.focusedContextItemId).toBe(
    latestFile.id,
  );
});

test("cycling focus updates the open context item viewer", () => {
  const firstFile = createFileContextItem("src/first.ts");
  const secondFile = createFileContextItem("src/second.ts");
  const harness = createHarness({
    ...createInitialAppState(),
    activeTask: {
      applyStatus: "idle",
      itemId: firstFile.id,
      kind: "context-item-viewer",
    },
    workspace: {
      ...createInitialAppState().workspace,
      contextItems: [firstFile, secondFile],
      focusedContextItemId: firstFile.id,
    },
  });

  harness.compose.focusNextContextItem();

  expect(harness.state.workspace.focusedContextItemId).toBe(secondFile.id);
  expect(harness.state.activeTask).toMatchObject({
    itemId: secondFile.id,
    kind: "context-item-viewer",
  });

  harness.compose.focusPreviousContextItem();

  expect(harness.state.workspace.focusedContextItemId).toBe(firstFile.id);
  expect(harness.state.activeTask).toMatchObject({
    itemId: firstFile.id,
    kind: "context-item-viewer",
  });
});
