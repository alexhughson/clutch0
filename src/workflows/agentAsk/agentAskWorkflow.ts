import { ContextDeck } from "../../app/contextDeck";
import type { AppActions, AppState } from "../../app/appTypes";
import {
  createPiAgentContextItem,
  createSavedAgentSandboxDiffContextItem,
  getContextItemById,
  PiAgentContextItem,
} from "../../lib/context/contextItems";

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
        replacePiAgentItem(state, itemId, (item) => item.withSandbox(sandbox)),
      ),
    fail: ({ errorMessage, itemId }) =>
      set((state) =>
        replacePiAgentItem(state, itemId, (item) =>
          item.withStatus("error", errorMessage),
        ),
      ),
    finish: ({ itemId }) =>
      set((state) =>
        replacePiAgentItem(state, itemId, (item) => item.withStatus("idle")),
      ),
    recordOutput: ({ itemId, update }) =>
      set((state) =>
        replacePiAgentItem(state, itemId, (item) =>
          item.withAgentOutputUpdate(update),
        ),
      ),
    saveSandboxDiffToContext: ({ agentItemId, diffText, summary }) =>
      set((state) =>
        saveSandboxDiffToContext(state, {
          agentItemId,
          diffText,
          summary,
        }),
      ),
    start: ({ mode, prompt }) => startAgentAsk({ get, mode, prompt, set }),
    startMessage: ({ itemId }) =>
      set((state) =>
        replacePiAgentItem(state, itemId, (item) => item.withStatus("running")),
      ),
    updateSandboxDiff: ({ itemId, sandbox }) =>
      set((state) =>
        replacePiAgentItem(state, itemId, (item) => item.withSandbox(sandbox)),
      ),
  };
}

function startAgentAsk({
  get,
  mode,
  prompt,
  set,
}: {
  get: GetAppState;
  mode: "ask" | "edit";
  prompt: string;
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
  if (!(agentItem instanceof PiAgentContextItem)) {
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
  if (!(item instanceof PiAgentContextItem)) {
    return state;
  }

  return {
    workspace: ContextDeck.fromComposeScreen(state.workspace)
      .replace(update(item))
      .applyTo(state.workspace),
  };
}
