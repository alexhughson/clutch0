import { ContextDeck } from "../../app/contextDeck";
import type { AppActions, AppState } from "../../app/appTypes";
import {
  createUserTextContextItem,
  getContextItemById,
  UserTextContextItem,
} from "../../lib/context/contextItems";

const USER_TEXT_CONTEXT_ITEM_ID_PREFIX = "say";

type SetAppState = (
  partial:
    | Partial<AppState>
    | AppState
    | ((state: AppState) => Partial<AppState> | AppState),
) => void;

export function createSayActions({
  set,
}: {
  set: SetAppState;
}): AppActions["say"] {
  return {
    addToContext: ({ text }) =>
      set((state) => addUserTextToContext(state, text)),
    updateText: ({ itemId, text }) =>
      set((state) => updateUserTextContextItem(state, { itemId, text })),
  };
}

function addUserTextToContext(
  state: AppState,
  text: string,
): Partial<AppState> | AppState {
  const item = createUserTextContextItem({
    createdAt: Date.now(),
    id: `${USER_TEXT_CONTEXT_ITEM_ID_PREFIX}:${state.nextContextItemId}`,
    text,
  });

  return {
    activeTask: {
      applyStatus: "idle",
      itemId: item.id,
      kind: "context-item-viewer",
    },
    nextContextItemId: state.nextContextItemId + 1,
    workspace: {
      ...ContextDeck.fromComposeScreen(state.workspace)
        .add(item)
        .applyTo(state.workspace),
      composer: {
        cursorPosition: 0,
        message: "",
      },
    },
  };
}

function updateUserTextContextItem(
  state: AppState,
  {
    itemId,
    text,
  }: {
    itemId: string;
    text: string;
  },
): Partial<AppState> | AppState {
  const item = getContextItemById(state.workspace.contextItems, itemId);
  if (!(item instanceof UserTextContextItem)) {
    throw new Error(`Expected editable user text context item: ${itemId}`);
  }

  return {
    workspace: ContextDeck.fromComposeScreen(state.workspace)
      .replace(item.withText(text))
      .applyTo(state.workspace),
  };
}
