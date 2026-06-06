import { expect, test } from "bun:test";
import type { AppActions, AppState } from "../../app/appTypes";
import { createInitialAppState } from "../../app/appInitialState";
import {
  AGENTS_CONTEXT_ITEM_ID,
  createAutomaticContextItems,
} from "../../lib/context/automaticContextItems";
import { createSavedLlmResponseContextItem } from "../../lib/context/contextItems";
import type {
  ContextItemSummarizationInput,
  GeneratedContextItemSummary,
} from "../../types";
import { createContextSummariesActions } from "./contextSummariesWorkflow";

function createHarness({
  generateSummary,
  initialState,
}: {
  generateSummary: (
    input: ContextItemSummarizationInput,
  ) => Promise<GeneratedContextItemSummary>;
  initialState?: Partial<AppState>;
}) {
  let state: AppState = {
    ...createInitialAppState(),
    actions: {} as AppActions,
    ...initialState,
  };

  const contextSummaries = createContextSummariesActions({
    generateSummary,
    get: () => state,
    set: (partial) => {
      const next = typeof partial === "function" ? partial(state) : partial;
      state = { ...state, ...next };
    },
  });

  return {
    contextSummaries,
    get state() {
      return state;
    },
    setState(partial: Partial<AppState>) {
      state = { ...state, ...partial };
    },
  };
}

test("context summaries use one worker handle per item and update the item", async () => {
  const calls: ContextItemSummarizationInput[] = [];
  const deferred = createDeferred<GeneratedContextItemSummary>();
  const item = createSavedLlmResponseContextItem({
    createdAt: 1,
    id: "saved:summary-worker",
    output: "The app renders a TUI and delegates work to tasks.",
    prompt: "Explain the app",
    sourceRequestId: 1,
  });
  const harness = createHarness({
    generateSummary: (input) => {
      calls.push(input);
      return deferred.promise;
    },
    initialState: {
      workspace: {
        ...createInitialAppState().workspace,
        automaticContextItems: [],
        contextItems: [item],
        focusedContextItemId: item.id,
      },
    },
  });

  harness.contextSummaries.ensureWorkspaceSummaries();
  harness.contextSummaries.ensureWorkspaceSummaries();
  await flushPromises();

  expect(calls).toHaveLength(1);
  const pendingState =
    harness.state.workspace.contextItems[0]?.getSummaryState();
  expect(pendingState?.status).toBe("pending");
  if (pendingState?.status !== "pending") {
    return;
  }
  expect(pendingState.workerId).toContain(calls[0]!.sourceHash.slice(0, 16));

  deferred.resolve({
    details: "Explains the TUI task architecture and context handling.",
    generatedAt: 2,
    oneLine: "TUI task architecture overview",
    sourceHash: calls[0]!.sourceHash,
  });
  await flushPromises();

  const summarizedItem = harness.state.workspace.contextItems[0];
  expect(summarizedItem?.getSummaryState().status).toBe("ready");
  expect(summarizedItem?.getSummaryView()).toMatchObject({
    detail: "Explains the TUI task architecture and context handling.",
    title: "TUI task architecture overview",
  });
});

test("stale summary workers do not overwrite removed items", async () => {
  const calls: ContextItemSummarizationInput[] = [];
  const deferred = createDeferred<GeneratedContextItemSummary>();
  const item = createSavedLlmResponseContextItem({
    createdAt: 1,
    id: "saved:removed-before-summary",
    output: "Old output",
    prompt: "Old prompt",
    sourceRequestId: 1,
  });
  const harness = createHarness({
    generateSummary: (input) => {
      calls.push(input);
      return deferred.promise;
    },
    initialState: {
      workspace: {
        ...createInitialAppState().workspace,
        automaticContextItems: [],
        contextItems: [item],
        focusedContextItemId: item.id,
      },
    },
  });

  harness.contextSummaries.ensureWorkspaceSummaries();
  await flushPromises();
  harness.setState({
    workspace: {
      ...harness.state.workspace,
      contextItems: [],
      focusedContextItemId: null,
    },
  });

  deferred.resolve({
    details: "Should not be written.",
    generatedAt: 2,
    oneLine: "Stale summary",
    sourceHash: calls[0]!.sourceHash,
  });
  await flushPromises();

  expect(harness.state.workspace.contextItems).toEqual([]);
});

test("context summaries update automatic context items", async () => {
  const calls: ContextItemSummarizationInput[] = [];
  const harness = createHarness({
    generateSummary: async (input) => {
      calls.push(input);
      return {
        details: `Automatic summary for ${input.label}.`,
        generatedAt: 2,
        oneLine: `Summary: ${input.label}`,
        sourceHash: input.sourceHash,
      };
    },
    initialState: {
      workspace: {
        ...createInitialAppState().workspace,
        automaticContextItems: createAutomaticContextItems(),
      },
    },
  });

  harness.contextSummaries.ensureWorkspaceSummaries();
  await flushPromises();
  await flushPromises();

  expect(calls.map((input) => input.itemId)).toContain(AGENTS_CONTEXT_ITEM_ID);
  const agentsItem = harness.state.workspace.automaticContextItems.find(
    (item) => item.id === AGENTS_CONTEXT_ITEM_ID,
  );
  expect(agentsItem?.getSummaryState().status).toBe("ready");
  expect(agentsItem?.getSummaryView()).toMatchObject({
    detail: "Automatic summary for AGENTS.md.",
    title: "Summary: AGENTS.md",
  });
});

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}

async function flushPromises() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}
