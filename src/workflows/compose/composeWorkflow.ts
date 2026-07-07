import { ContextDeck, getNextContextItemFocusId } from "../../app/contextDeck";
import type {
  AppActions,
  AppState,
  ComposerState,
  ContextItemReplacementTarget,
} from "../../app/appTypes";
import {
  createFileContextItem,
  getFileContextItemId,
  hasContextItem,
} from "../../lib/context/contextItems";
import { getVisibleContextItems } from "../../lib/context/automaticContextItems";
import { assembleLlmContextInput } from "../../lib/llm/context";
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
    focusNextContextItem: () => set((state) => focusContextItem(state, "next")),
    focusPreviousContextItem: () =>
      set((state) => focusContextItem(state, "previous")),
    removeContextItem: ({ itemId }) =>
      set((state) => ({
        workspace: ContextDeck.fromComposeScreen(state.workspace)
          .remove(itemId)
          .applyTo(state.workspace),
      })),
    removeFocusedContextItem: () =>
      set((state) =>
        state.workspace.focusedContextItemId !== null
          ? {
              workspace: ContextDeck.fromComposeScreen(state.workspace)
                .remove(state.workspace.focusedContextItemId)
                .applyTo(state.workspace),
            }
          : state,
      ),
    setComposerState: (composer) =>
      set((state) => ({
        workspace: {
          ...state.workspace,
          composer,
        },
      })),
    startLlmRequest: ({ question, rejectComposer, replacement }) =>
      startLlmRequest({ get, question, rejectComposer, replacement, set }),
  };
}

function focusContextItem(
  state: AppState,
  direction: "next" | "previous",
): Partial<AppState> | AppState {
  const focusedContextItemId = getNextContextItemFocusId({
    contextItems: getVisibleContextItems(
      state.workspace.contextItems,
      state.workspace.automaticContextItems,
    ),
    direction,
    focusedContextItemId: state.workspace.focusedContextItemId,
  });

  return {
    activeTask:
      focusedContextItemId !== null &&
      state.activeTask?.kind === "context-item-viewer"
        ? { ...state.activeTask, itemId: focusedContextItemId }
        : state.activeTask,
    workspace: {
      ...state.workspace,
      focusedContextItemId,
    },
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
  const itemId = getFileContextItemId(filePath);
  const contextItems = hasContextItem(state.workspace.contextItems, itemId)
    ? state.workspace.contextItems
    : [...state.workspace.contextItems, createFileContextItem(filePath)];

  return {
    workspace: {
      ...state.workspace,
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
  rejectComposer,
  replacement,
  set,
}: {
  get: GetAppState;
  question: string;
  rejectComposer?: ComposerState;
  replacement?: ContextItemReplacementTarget;
  set: SetAppState;
}): number | null {
  // Compose reruns intentionally overwrite activeTask even when a response pane
  // is already open. Other workflows keep the activeTask mutex and no-op instead.
  const state = get();
  const requestId = state.nextLlmRequestId;
  const { contextItems, focusedContextItemId } = assembleLlmContextInput({
    automaticContextItems: state.workspace.automaticContextItems,
    contextItems: state.workspace.contextItems,
    excludedContextItemId: replacement?.contextItemId,
    focusedContextItemId: state.workspace.focusedContextItemId,
  });

  set({
    activeTask: {
      kind: "response",
      ...(rejectComposer === undefined ? {} : { rejectComposer }),
      request: {
        contextItems,
        focusedContextItemId,
        id: requestId,
        question,
        replacement,
        responseText: "",
        status: "loading",
      },
    },
    nextLlmRequestId: requestId + 1,
  });

  return requestId;
}

export function withComposerState(
  state: AppState,
  composer: ComposerState,
): Partial<AppState> | AppState {
  return {
    workspace: {
      ...state.workspace,
      composer,
    },
  };
}
