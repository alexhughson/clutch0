import { expect, test } from "bun:test";
import type { AppActions, AppState } from "../../app/appTypes";
import { createInitialComposeScreen } from "../../app/appInitialState";
import {
  LiveLlmResponseContextItem,
  SavedDiffContextItem,
  SavedLlmResponseContextItem,
  createSavedLlmResponseContextItem,
} from "../../lib/context/contextItems";
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

test("saving a running response creates live context and finish updates it", () => {
  const harness = createHarness({
    actions: {} as AppActions,
    activeTask: {
      kind: "response",
      request: {
        contextItems: [],
        focusedContextItemId: null,
        id: 1,
        question: "Explain the app",
        responseText: "partial",
        status: "streaming",
      },
    },
    nextContextItemId: 1,
    nextLlmRequestId: 2,
    workspace: createInitialComposeScreen(),
  });

  harness.response.saveTextToContext({ requestId: 1 });

  expect(harness.state.activeTask).toBeNull();
  expect(harness.state.workspace.contextItems[0]).toBeInstanceOf(
    LiveLlmResponseContextItem,
  );

  harness.response.appendDelta({ delta: " output", requestId: 1 });
  expect(
    (harness.state.workspace.contextItems[0] as LiveLlmResponseContextItem)
      .output,
  ).toBe("partial output");

  harness.response.finish({
    requestId: 1,
    responseKind: "text",
    responseText: "final output",
  });

  const item = harness.state.workspace.contextItems[0];
  expect(item).toBeInstanceOf(SavedLlmResponseContextItem);
  expect(item?.id).toBe("saved:1");
});

test("failing a request can replace the response output with debug text", () => {
  const harness = createHarness({
    actions: {} as AppActions,
    activeTask: {
      kind: "response",
      request: {
        contextItems: [],
        focusedContextItemId: null,
        id: 1,
        question: "Explain the app",
        responseText: "partial",
        status: "streaming",
      },
    },
    nextContextItemId: 1,
    nextLlmRequestId: 2,
    workspace: createInitialComposeScreen(),
  });

  harness.response.fail({
    errorMessage:
      "LLM completion failed. See response output for full details.",
    requestId: 1,
    responseText: "# LLM completion failed\n\npartial\n\nfull provider error",
  });

  expect(harness.state.activeTask?.kind).toBe("response");
  if (harness.state.activeTask?.kind !== "response") {
    return;
  }

  expect(harness.state.activeTask.request.status).toBe("error");
  expect(harness.state.activeTask.request.responseText).toContain(
    "full provider error",
  );
});

test("saving a running edit replaces the live item with a saved diff", () => {
  const harness = createHarness({
    actions: {} as AppActions,
    activeTask: {
      kind: "response",
      request: {
        contextItems: [],
        focusedContextItemId: null,
        id: 1,
        question: "Change text",
        responseText: "",
        status: "loading",
      },
    },
    nextContextItemId: 1,
    nextLlmRequestId: 2,
    workspace: createInitialComposeScreen(),
  });

  harness.response.saveTextToContext({ requestId: 1 });
  harness.response.finish({
    requestId: 1,
    responseKind: "patch",
    responseText: "",
  });
  harness.response.setPatch({
    patch: {
      applyStatus: "pending",
      diffText: "diff --git a/a b/a",
      proposal: { edits: [], summary: "Change text" },
      status: "valid",
    },
    requestId: 1,
  });

  const item = harness.state.workspace.contextItems[0];
  expect(item).toBeInstanceOf(SavedDiffContextItem);
  expect(item?.id).toBe("saved:1");
});
