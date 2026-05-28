import { ContextDeck } from "../../app/contextDeck";
import type { AppActions, AppState } from "../../app/appTypes";
import {
  createPiAgentContextItem,
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
    start: ({ prompt }) => startAgentAsk({ get, prompt, set }),
    startMessage: ({ itemId }) =>
      set((state) =>
        replacePiAgentItem(state, itemId, (item) => item.withStatus("running")),
      ),
  };
}

function startAgentAsk({
  get,
  prompt,
  set,
}: {
  get: GetAppState;
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
