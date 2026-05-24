import { ContextDeck } from "../../app/contextDeck";
import type { AppActions, AppState, ComposerState } from "../../app/appTypes";
import {
  createFileContextItem,
  getFileContextItemId,
  hasContextItem,
} from "../../lib/context/contextItems";
import type { FilePath } from "../../types";

type SetAppState = (
  partial:
    | Partial<AppState>
    | AppState
    | ((state: AppState) => Partial<AppState> | AppState),
) => void;

type GetAppState = () => AppState;

export function createComposeActions({
  get,
  set,
}: {
  get: GetAppState;
  set: SetAppState;
}): AppActions["compose"] {
  return {
    acceptFileSelection: ({ cursorPosition, filePath, message }) =>
      set((state) =>
        acceptFileSelection(state, { cursorPosition, filePath, message }),
      ),
    focusNextContextItem: () =>
      set((state) =>
        state.screen.name === "compose"
          ? {
              screen: ContextDeck.fromComposeScreen(state.screen)
                .focus("next")
                .applyTo(state.screen),
            }
          : state,
      ),
    focusPreviousContextItem: () =>
      set((state) =>
        state.screen.name === "compose"
          ? {
              screen: ContextDeck.fromComposeScreen(state.screen)
                .focus("previous")
                .applyTo(state.screen),
            }
          : state,
      ),
    removeContextItem: ({ itemId }) =>
      set((state) =>
        state.screen.name === "compose"
          ? {
              screen: ContextDeck.fromComposeScreen(state.screen)
                .remove(itemId)
                .applyTo(state.screen),
            }
          : state,
      ),
    removeFocusedContextItem: () =>
      set((state) =>
        state.screen.name === "compose" &&
        state.screen.focusedContextItemId !== null
          ? {
              screen: ContextDeck.fromComposeScreen(state.screen)
                .remove(state.screen.focusedContextItemId)
                .applyTo(state.screen),
            }
          : state,
      ),
    setComposerState: (composer) =>
      set((state) =>
        state.screen.name === "compose"
          ? {
              screen: {
                ...state.screen,
                composer,
              },
            }
          : state,
      ),
    startLlmRequest: ({ question }) => startLlmRequest({ get, question, set }),
  };
}

function acceptFileSelection(
  state: AppState,
  {
    cursorPosition,
    filePath,
    message,
  }: {
    cursorPosition: number;
    filePath: FilePath;
    message: string;
  },
): Partial<AppState> | AppState {
  if (state.screen.name !== "compose") {
    return state;
  }

  const itemId = getFileContextItemId(filePath);
  const contextItems = hasContextItem(state.screen.contextItems, itemId)
    ? state.screen.contextItems
    : [...state.screen.contextItems, createFileContextItem(filePath)];

  return {
    screen: {
      ...state.screen,
      composer: {
        cursorPosition,
        message,
      },
      contextItems,
      focusedContextItemId: itemId,
    },
  };
}

function startLlmRequest({
  get,
  question,
  set,
}: {
  get: GetAppState;
  question: string;
  set: SetAppState;
}): number | null {
  const state = get();

  if (state.screen.name !== "compose") {
    return null;
  }

  const requestId = state.nextLlmRequestId;
  const contextItems = [...state.screen.contextItems];
  const focusedContextItemId = state.screen.focusedContextItemId;

  set({
    nextLlmRequestId: requestId + 1,
    screen: {
      name: "response",
      request: {
        contextItems,
        focusedContextItemId,
        id: requestId,
        question,
        responseText: "",
        status: "loading",
      },
      returnToCompose: state.screen,
    },
  });

  return requestId;
}

export function withComposerState(
  state: AppState,
  composer: ComposerState,
): Partial<AppState> | AppState {
  return state.screen.name === "compose"
    ? {
        screen: {
          ...state.screen,
          composer,
        },
      }
    : state;
}
