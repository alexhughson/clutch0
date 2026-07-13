import { expect, test } from "bun:test";
import type { AppActions, AppState } from "../../app/appTypes";
import { createInitialComposeScreen } from "../../app/appInitialState";
import { createSavedLlmResponseContextItem } from "../../lib/context/contextItemFactories";
import { getContextItemSummaryView } from "../../lib/context/contextItemRegistry";
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
  expect(replacement?.type).toBe("llm-response");
  expect(getContextItemSummaryView(replacement!).title).toContain(
    "Explain the app",
  );
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
  expect(harness.state.workspace.contextItems[0]).toMatchObject({
    type: "llm-response-live",
  });

  harness.response.appendDelta({ delta: " output", requestId: 1 });
  expect(harness.state.workspace.contextItems[0]).toMatchObject({
    output: "partial output",
    type: "llm-response-live",
  });

  harness.response.finish({
    requestId: 1,
    responseKind: "text",
    responseText: "final output",
  });

  const item = harness.state.workspace.contextItems[0];
  expect(item).toMatchObject({ id: "saved:1", type: "llm-response" });
});

test("records latency stats on the active response request", () => {
  const harness = createHarness({
    actions: {} as AppActions,
    activeTask: {
      kind: "response",
      request: {
        contextItems: [],
        focusedContextItemId: null,
        id: 1,
        question: "Explain the app",
        responseText: "",
        status: "loading",
      },
    },
    nextContextItemId: 1,
    nextLlmRequestId: 2,
    workspace: createInitialComposeScreen(),
  });

  harness.response.setLatencyStats({
    latencyStats: { ttftMs: 120 },
    requestId: 1,
  });
  harness.response.setLatencyStats({
    latencyStats: { totalMs: 840 },
    requestId: 1,
  });

  expect(
    harness.state.activeTask?.kind === "response"
      ? harness.state.activeTask.request.latencyStats
      : undefined,
  ).toEqual({ totalMs: 840, ttftMs: 120 });
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

test("streaming patch progress updates the active request and clears on patch", () => {
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

  harness.response.setPatchProgress({
    progress: {
      files: [{ operation: "update", path: "README.md" }],
      patchCharacterCount: 80,
    },
    requestId: 1,
  });

  expect(harness.state.activeTask?.kind).toBe("response");
  if (harness.state.activeTask?.kind !== "response") {
    return;
  }
  expect(harness.state.activeTask.request.status).toBe("streaming");
  expect(harness.state.activeTask.request.patchProgress).toEqual({
    files: [{ operation: "update", path: "README.md" }],
    patchCharacterCount: 80,
  });

  harness.response.setPatch({
    patch: {
      applyStatus: "pending",
      diffText: "diff --git a/README.md b/README.md",
      proposal: {
        patch:
          "*** Begin Patch\n*** Update File: README.md\n@@\n-old\n+new\n*** End Patch",
        summary: "Change text",
      },
      status: "valid",
    },
    requestId: 1,
  });

  expect(harness.state.activeTask?.kind).toBe("response");
  if (harness.state.activeTask?.kind !== "response") {
    return;
  }
  expect(harness.state.activeTask.request.patchProgress).toBeUndefined();
  expect(harness.state.activeTask.request.patch?.status).toBe("valid");
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
      proposal: {
        patch:
          "*** Begin Patch\n*** Update File: a\n@@\n-old\n+new\n*** End Patch",
        summary: "Change text",
      },
      status: "valid",
    },
    requestId: 1,
  });

  const item = harness.state.workspace.contextItems[0];
  expect(item).toMatchObject({ type: "diff" });
  expect(item?.id).toBe("saved:1");
});

test("saving an applied patch keeps the normalized diff as context", () => {
  const harness = createHarness({
    actions: {} as AppActions,
    activeTask: {
      kind: "response",
      request: {
        contextItems: [],
        focusedContextItemId: null,
        id: 1,
        patch: {
          applyStatus: "applied",
          diffText: "diff --git a/README.md b/README.md\n-old\n+new",
          proposal: {
            patch:
              "*** Begin Patch\n*** Update File: README.md\n@@\n-old\n+new\n*** End Patch",
            summary: "Change text",
          },
          status: "valid",
        },
        question: "Change text",
        responseText: "Applied.",
        status: "done",
      },
    },
    nextContextItemId: 1,
    nextLlmRequestId: 2,
    workspace: createInitialComposeScreen(),
  });

  harness.response.saveDiffToContext({ requestId: 1 });

  expect(harness.state.activeTask?.kind).toBe("response");
  if (harness.state.activeTask?.kind !== "response") {
    return;
  }
  expect(harness.state.activeTask.request.savedContextItemId).toBe("saved:1");
  const item = harness.state.workspace.contextItems[0];
  expect(item).toMatchObject({ type: "diff" });
  expect(item?.id).toBe("saved:1");
});
