import { expect, test } from "bun:test";
import type { AppActions, AppState } from "../../app/appTypes";
import { createInitialComposeScreen } from "../../app/appInitialState";
import { createSavedLlmResponseContextItem } from "../../lib/context/contextItems";
import { createResponseActions } from "./responseWorkflow";

function createHarness(initialState: AppState) {
  let state = initialState;
  const response = createResponseActions({
    set: (partial) => {
      const next = typeof partial === "function" ? partial(state) : partial;
      state = { ...state, ...next };
    },
  });

  return {
    get state() {
      return state;
    },
    response,
  };
}

test("finishing a text rerun replaces the saved response context item", () => {
  const saved = createSavedLlmResponseContextItem({
    createdAt: 1,
    id: "saved:1",
    output: "old output",
    prompt: "Explain the app",
    sourceRequestId: 1,
  });
  const workspace = {
    ...createInitialComposeScreen(),
    contextItems: [saved],
    focusedContextItemId: saved.id,
  };
  const harness = createHarness({
    actions: {} as AppActions,
    activeTask: {
      kind: "response",
      request: {
        contextItems: [],
        focusedContextItemId: null,
        id: 2,
        question: saved.prompt,
        replacement: {
          contextItemId: saved.id,
          expectedResult: "text",
        },
        responseText: "",
        status: "loading",
      },
    },
    nextContextItemId: 2,
    nextLlmRequestId: 3,
    workspace,
  });

  harness.response.finish({
    requestId: 2,
    responseKind: "text",
    responseText: "new output",
  });

  expect(harness.state.activeTask?.kind).toBe("response");
  if (harness.state.activeTask?.kind !== "response") {
    return;
  }

  expect(harness.state.activeTask.request.savedContextItemId).toBe(saved.id);
  const [replacement] = harness.state.workspace.contextItems;
  expect(replacement?.id).toBe(saved.id);
  expect(replacement?.getDetailView).toBeDefined();
  expect(replacement?.getListLabel()).toContain("Explain the app");
});
