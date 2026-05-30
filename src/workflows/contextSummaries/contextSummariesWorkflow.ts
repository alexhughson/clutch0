import { ContextDeck } from "../../app/contextDeck";
import type { AppActions, AppState } from "../../app/appTypes";
import { getContextItemById } from "../../lib/context/contextItems";
import {
  generateContextItemSummary,
  type ContextItemSummaryGenerator,
} from "../../lib/llm/contextItemSummary";
import type {
  ContextItem,
  ContextItemSummarizationInput,
  ContextItemSummaryState,
  GeneratedContextItemSummary,
} from "../../types";

type SetAppState = (
  partial:
    | Partial<AppState>
    | AppState
    | ((state: AppState) => Partial<AppState> | AppState),
) => void;

type GetAppState = () => AppState;

const activeSummaryWorkers = new Map<string, Promise<void>>();

export function createContextSummariesActions({
  generateSummary = generateContextItemSummary,
  get,
  set,
}: {
  generateSummary?: ContextItemSummaryGenerator;
  get: GetAppState;
  set: SetAppState;
}): AppActions["contextSummaries"] {
  return {
    ensureWorkspaceSummaries: () => {
      void ensureWorkspaceSummaries({ generateSummary, get, set });
    },
  };
}

async function ensureWorkspaceSummaries({
  generateSummary,
  get,
  set,
}: {
  generateSummary: ContextItemSummaryGenerator;
  get: GetAppState;
  set: SetAppState;
}) {
  const items = [...get().workspace.contextItems];
  for (const item of items) {
    const input = await item.getSummarizationInput({ root: process.cwd() });
    if (input === null) {
      continue;
    }

    const currentItem = getContextItemById(
      get().workspace.contextItems,
      item.id,
    );
    if (currentItem === null || !shouldStartSummaryWorker(currentItem, input)) {
      continue;
    }

    startSummaryWorker({ generateSummary, input, item: currentItem, set });
  }
}

function shouldStartSummaryWorker(
  item: ContextItem,
  input: ContextItemSummarizationInput,
): boolean {
  const summaryState = item.getSummaryState();
  const workerId = getSummaryWorkerId(input);

  if (summaryState.status === "missing") {
    return !activeSummaryWorkers.has(workerId);
  }

  if (summaryState.status === "ready") {
    return (
      summaryState.sourceHash !== input.sourceHash &&
      !activeSummaryWorkers.has(workerId)
    );
  }

  if (summaryState.status === "error") {
    return (
      summaryState.sourceHash !== input.sourceHash &&
      !activeSummaryWorkers.has(workerId)
    );
  }

  return (
    (summaryState.sourceHash !== input.sourceHash ||
      summaryState.workerId !== workerId) &&
    !activeSummaryWorkers.has(workerId)
  );
}

function startSummaryWorker({
  generateSummary,
  input,
  item,
  set,
}: {
  generateSummary: ContextItemSummaryGenerator;
  input: ContextItemSummarizationInput;
  item: ContextItem;
  set: SetAppState;
}) {
  const workerId = getSummaryWorkerId(input);
  if (activeSummaryWorkers.has(workerId)) {
    return;
  }

  replaceContextItemSummaryState(set, item.id, {
    sourceHash: input.sourceHash,
    status: "pending",
    workerId,
  });

  const worker = runSummaryWorker({ generateSummary, input, set, workerId });
  activeSummaryWorkers.set(workerId, worker);
  void worker.finally(() => {
    activeSummaryWorkers.delete(workerId);
  });
}

async function runSummaryWorker({
  generateSummary,
  input,
  set,
  workerId,
}: {
  generateSummary: ContextItemSummaryGenerator;
  input: ContextItemSummarizationInput;
  set: SetAppState;
  workerId: string;
}) {
  try {
    const summary = await generateSummary(input);
    finishSummaryWorker(set, input.itemId, workerId, summary);
  } catch (error) {
    failSummaryWorker(set, input, workerId, summaryFailureMessage(error));
  }
}

function finishSummaryWorker(
  set: SetAppState,
  itemId: string,
  workerId: string,
  summary: GeneratedContextItemSummary,
) {
  set((state) => {
    const item = getContextItemById(state.workspace.contextItems, itemId);
    if (!hasMatchingPendingSummary(item, workerId, summary.sourceHash)) {
      return state;
    }

    return {
      workspace: ContextDeck.fromComposeScreen(state.workspace)
        .replace(
          item.withSummaryState({
            sourceHash: summary.sourceHash,
            status: "ready",
            summary,
          }),
        )
        .applyTo(state.workspace),
    };
  });
}

function failSummaryWorker(
  set: SetAppState,
  input: ContextItemSummarizationInput,
  workerId: string,
  errorMessage: string,
) {
  set((state) => {
    const item = getContextItemById(state.workspace.contextItems, input.itemId);
    if (!hasMatchingPendingSummary(item, workerId, input.sourceHash)) {
      return state;
    }

    return {
      workspace: ContextDeck.fromComposeScreen(state.workspace)
        .replace(
          item.withSummaryState({
            errorMessage,
            sourceHash: input.sourceHash,
            status: "error",
            workerId,
          }),
        )
        .applyTo(state.workspace),
    };
  });
}

function replaceContextItemSummaryState(
  set: SetAppState,
  itemId: string,
  summaryState: ContextItemSummaryState,
) {
  set((state) => {
    const item = getContextItemById(state.workspace.contextItems, itemId);
    if (item === null) {
      return state;
    }

    return {
      workspace: ContextDeck.fromComposeScreen(state.workspace)
        .replace(item.withSummaryState(summaryState))
        .applyTo(state.workspace),
    };
  });
}

function hasMatchingPendingSummary(
  item: ContextItem | null,
  workerId: string,
  sourceHash: string,
): item is ContextItem {
  if (item === null) {
    return false;
  }

  const summaryState = item.getSummaryState();
  return (
    summaryState.status === "pending" &&
    summaryState.workerId === workerId &&
    summaryState.sourceHash === sourceHash
  );
}

function getSummaryWorkerId(input: ContextItemSummarizationInput): string {
  return `summary:${input.itemId}:${input.sourceHash.slice(0, 16)}`;
}

function summaryFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
