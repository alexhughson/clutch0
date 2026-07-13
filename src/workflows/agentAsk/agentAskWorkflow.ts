import { applyAgentOutputUpdate } from "../../lib/agentOutput/agentOutputReducer";
import { ContextDeck } from "../../app/contextDeck";
import type { AppActions, AppState } from "../../app/appTypes";
import {
  createPiAgentContextItem,
  createSavedAgentSandboxDiffContextItem,
  getContextItemById,
} from "../../lib/context/contextItemFactories";
import type { PiAgentContextItem } from "../../lib/context/contextItemTypes";

type SetAppState = (
  partial:
    | Partial<AppState>
    | AppState
    | ((state: AppState) => Partial<AppState> | AppState),
) => void;

type GetAppState = () => AppState;

export function createAgentAskActions({
  get,
  set,
}: {
  get: GetAppState;
  set: SetAppState;
}): AppActions["agentAsk"] {
  return {
    attachSandbox: ({ itemId, sandbox }) =>
      set((state) =>
        replacePiAgentItem(state, itemId, (item) => ({
          ...item,
          sandbox,
        })),
      ),
    fail: ({ errorMessage, itemId }) =>
      set((state) =>
        replacePiAgentItem(state, itemId, (item) => ({
          ...item,
          errorMessage,
          status: "error" as const,
        })),
      ),
    finish: ({ itemId }) =>
      set((state) =>
        replacePiAgentItem(state, itemId, (item) => ({
          ...item,
          errorMessage: undefined,
          status: "idle" as const,
        })),
      ),
    recordOutput: ({ itemId, update }) =>
      set((state) =>
        replacePiAgentItem(state, itemId, (item) => ({
          ...item,
          blocks: applyAgentOutputUpdate(item.blocks, update),
        })),
      ),
    saveSandboxDiffToContext: ({ agentItemId, diffText, summary }) =>
      set((state) =>
        saveSandboxDiffToContext(state, {
          agentItemId,
          diffText,
          summary,
        }),
      ),
    start: ({ mode, prompt, rejectComposer }) =>
      startAgentAsk({ get, mode, prompt, rejectComposer, set }),
    startMessage: ({ itemId }) =>
      set((state) =>
        replacePiAgentItem(state, itemId, (item) => ({
          ...item,
          errorMessage: undefined,
          status: "running" as const,
        })),
      ),
    updateSandboxDiff: ({ itemId, sandbox }) =>
      set((state) =>
        replacePiAgentItem(state, itemId, (item) => ({
          ...item,
          sandbox,
        })),
      ),
  };
}

function startAgentAsk({
  get,
  mode,
  prompt,
  rejectComposer,
  set,
}: {
  get: GetAppState;
  mode: "ask" | "edit";
  prompt: string;
  rejectComposer?: AppState["workspace"]["composer"];
  set: SetAppState;
}): string | null {
  const state = get();
  if (state.activeTask !== null) {
    return null;
  }

  const itemId = `agent:${state.nextContextItemId}`;
  const item = createPiAgentContextItem({
    createdAt: Date.now(),
    id: itemId,
    mode,
    prompt,
  });

  set({
    activeTask: {
      applyStatus: "idle",
      itemId,
      kind: "context-item-viewer",
      ...(rejectComposer === undefined ? {} : { rejectComposer }),
    },
    nextContextItemId: state.nextContextItemId + 1,
    workspace: ContextDeck.fromComposeScreen(state.workspace)
      .add(item)
      .applyTo(state.workspace),
  });

  return itemId;
}

function saveSandboxDiffToContext(
  state: AppState,
  {
    agentItemId,
    diffText,
    summary,
  }: { agentItemId: string; diffText: string; summary: string },
): Partial<AppState> | AppState {
  const agentItem = getContextItemById(
    state.workspace.contextItems,
    agentItemId,
  );
  if (agentItem?.type !== "pi-agent") {
    return state;
  }

  const diffItem = createSavedAgentSandboxDiffContextItem({
    createdAt: Date.now(),
    diffText,
    id: `agent-diff:${state.nextContextItemId}`,
    prompt: agentItem.prompt,
    sourceAgentItemId: agentItemId,
    summary,
  });

  return {
    nextContextItemId: state.nextContextItemId + 1,
    workspace: ContextDeck.fromComposeScreen(state.workspace)
      .add(diffItem)
      .applyTo(state.workspace),
  };
}

function replacePiAgentItem(
  state: AppState,
  itemId: string,
  update: (item: PiAgentContextItem) => PiAgentContextItem,
): Partial<AppState> | AppState {
  const item = getContextItemById(state.workspace.contextItems, itemId);
  if (item?.type !== "pi-agent") {
    return state;
  }

  return {
    workspace: ContextDeck.fromComposeScreen(state.workspace)
      .replace(update(item))
      .applyTo(state.workspace),
  };
}
