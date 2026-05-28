import { expect, test } from "bun:test";
import type { AppActions, AppState } from "../../app/appTypes";
import { createInitialAppState } from "../../app/appInitialState";
import { getFileContextItemId } from "../../lib/context/contextItems";
import { createCreateFileActions } from "./createFileWorkflow";

function createHarness(initialState: AppState) {
  let state = initialState;
  const createFile = createCreateFileActions({
    set: (partial) => {
      const next = typeof partial === "function" ? partial(state) : partial;
      state = { ...state, ...next };
    },
  });

  return {
    createFile,
    get state() {
      return state;
    },
  };
}

test("showing a create file review replaces the response task", () => {
  const harness = createHarness({
    ...createInitialAppState(),
    actions: {} as AppActions,
    activeTask: {
      kind: "response",
      request: {
        contextItems: [],
        focusedContextItemId: null,
        id: 1,
        question: "Create a helper",
        responseText: "",
        status: "loading",
      },
    },
  });

  harness.createFile.showReview({
    requestId: 1,
    validation: {
      proposal: {
        content: "export const helper = true;\n",
        path: "src/helper.ts",
        summary: "Create helper",
      },
      status: "valid",
    },
  });

  expect(harness.state.activeTask).toMatchObject({
    applyStatus: "pending",
    id: 1,
    kind: "create-file",
    prompt: "Create a helper",
  });
});

test("finishing create file apply adds the file to context and closes the task", () => {
  const harness = createHarness({
    ...createInitialAppState(),
    actions: {} as AppActions,
    activeTask: {
      applyStatus: "applying",
      id: 1,
      kind: "create-file",
      prompt: "Create a helper",
      validation: {
        proposal: {
          content: "export const helper = true;\n",
          path: "src/helper.ts",
          summary: "Create helper",
        },
        status: "valid",
      },
    },
  });

  harness.createFile.finishApply({ requestId: 1 });

  expect(harness.state.activeTask).toBeNull();
  expect(harness.state.workspace.contextItems[0]?.id).toBe(
    getFileContextItemId("src/helper.ts"),
  );
  expect(harness.state.workspace.focusedContextItemId).toBe(
    getFileContextItemId("src/helper.ts"),
  );
});
