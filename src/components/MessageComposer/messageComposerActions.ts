import type { KeyEvent } from "@opentui/core";
import { getContextItemById } from "../../lib/context/contextItems";
import { moveFileHighlight } from "../../lib/fileSelection";
import { NoFileSelector } from "../../lib/inputLineParser";
import { streamLlmInteraction } from "../../lib/llm/streamResponse";
import { removeStringRange } from "../../lib/stringRange";
import { useAppStore } from "../../store/appStore";
import type {
  ContextItemAction,
  FilePath,
  FileSelectionDirection,
  FileSelectorMatch,
  HighlightedFilePath,
} from "../../types";
import { getMessageComposerKeyAction } from "./messageComposerKeymap";
import {
  getCursorPositionAfterInput,
  getFileSuggestionStateFromComposeScreen,
} from "./messageComposerModel";

export function updateMessage({ nextMessage }: { nextMessage: string }) {
  const currentState = useAppStore.getState();
  if (currentState.screen.name !== "compose") {
    return;
  }

  const nextCursorPosition = getCursorPositionAfterInput({
    nextMessage,
    previousCursorPosition: currentState.screen.composer.cursorPosition,
    previousMessage: currentState.screen.composer.message,
  });

  currentState.actions.compose.setComposerState({
    cursorPosition: nextCursorPosition,
    message: nextMessage,
  });
}

export function updateCursorPosition({
  cursorPosition,
}: {
  cursorPosition: number;
}) {
  const currentState = useAppStore.getState();
  if (currentState.screen.name !== "compose") {
    return;
  }

  currentState.actions.compose.setComposerState({
    cursorPosition,
    message: currentState.screen.composer.message,
  });
}

/** Handles composer keyboard shortcuts for file selection and message submission. */
export function handleMessageComposerKeyDown({
  event,
  filePaths,
  highlightedFilePath,
  setHighlightedFilePath,
}: {
  event: KeyEvent;
  filePaths: readonly FilePath[];
  highlightedFilePath: HighlightedFilePath;
  setHighlightedFilePath: (highlightedFilePath: HighlightedFilePath) => void;
}) {
  const action = getMessageComposerKeyAction(event);
  if (action === null) {
    return;
  }

  const currentState = useAppStore.getState();
  if (currentState.screen.name !== "compose") {
    return;
  }

  const suggestionState = getFileSuggestionStateFromComposeScreen({
    filePaths,
    highlightedFilePath,
    screen: currentState.screen,
  });

  if (suggestionState.fileSelectorMatch === NoFileSelector) {
    handleContextOrSubmitAction({ action, event });
    return;
  }

  if (action === "confirm") {
    acceptFileSelection({
      event,
      fileSelectorMatch: suggestionState.fileSelectorMatch,
      highlightedFilePath: suggestionState.highlightedFilePath,
      setHighlightedFilePath,
    });
    return;
  }

  if (action !== "select-next-file" && action !== "select-previous-file") {
    return;
  }

  if (suggestionState.visibleFilePaths.length === 0) {
    return;
  }

  moveHighlightedFile({
    direction: action === "select-next-file" ? "next" : "previous",
    event,
    highlightedFilePath: suggestionState.highlightedFilePath,
    setHighlightedFilePath,
    visibleFilePaths: suggestionState.visibleFilePaths,
  });
}

/** Removes the typed @selector after adding the highlighted file. */
function acceptFileSelection({
  event,
  fileSelectorMatch,
  highlightedFilePath,
  setHighlightedFilePath,
}: {
  event: KeyEvent;
  fileSelectorMatch: FileSelectorMatch;
  highlightedFilePath: HighlightedFilePath;
  setHighlightedFilePath: (highlightedFilePath: HighlightedFilePath) => void;
}) {
  if (highlightedFilePath === null) {
    return;
  }

  const currentState = useAppStore.getState();
  if (currentState.screen.name !== "compose") {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  setHighlightedFilePath(null);
  currentState.actions.compose.acceptFileSelection({
    cursorPosition: fileSelectorMatch.start,
    filePath: highlightedFilePath,
    message: removeStringRange(
      currentState.screen.composer.message,
      fileSelectorMatch,
    ),
  });
}

function moveHighlightedFile({
  direction,
  event,
  highlightedFilePath,
  setHighlightedFilePath,
  visibleFilePaths,
}: {
  direction: FileSelectionDirection;
  event: KeyEvent;
  highlightedFilePath: HighlightedFilePath;
  setHighlightedFilePath: (highlightedFilePath: HighlightedFilePath) => void;
  visibleFilePaths: FilePath[];
}) {
  event.preventDefault();
  event.stopPropagation();
  setHighlightedFilePath(
    moveFileHighlight({
      direction,
      highlightedFilePath,
      visibleFilePaths,
    }),
  );
}

function handleContextOrSubmitAction({
  action,
  event,
}: {
  action: ReturnType<typeof getMessageComposerKeyAction>;
  event: KeyEvent;
}) {
  const currentState = useAppStore.getState();
  if (currentState.screen.name !== "compose") {
    return;
  }

  if (action === "confirm") {
    submitQuestion(event);
    return;
  }

  if (action === "select-next-file") {
    event.preventDefault();
    event.stopPropagation();
    currentState.actions.compose.focusNextContextItem();
    return;
  }

  if (action === "select-previous-file") {
    event.preventDefault();
    event.stopPropagation();
    currentState.actions.compose.focusPreviousContextItem();
    return;
  }

  if (action === "remove-focused-context-item") {
    event.preventDefault();
    event.stopPropagation();
    runFocusedContextItemAction("remove");
    return;
  }

  if (action === "run-focused-context-action") {
    event.preventDefault();
    event.stopPropagation();
    runFocusedContextItemPrimaryAction();
  }
}

function submitQuestion(event: KeyEvent) {
  const currentState = useAppStore.getState();
  if (currentState.screen.name !== "compose") {
    return;
  }

  const question = currentState.screen.composer.message.trim();

  if (question.length === 0) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  startPromptRequest(question);
}

function startPromptRequest(question: string) {
  const currentState = useAppStore.getState();
  if (currentState.screen.name !== "compose") {
    return;
  }

  const contextItems = [...currentState.screen.contextItems];
  const focusedContextItemId = currentState.screen.focusedContextItemId;
  const requestId = currentState.actions.compose.startLlmRequest({
    question,
  });
  if (requestId === null) {
    return;
  }

  void streamLlmInteraction({
    question,
    contextItems,
    focusedContextItemId,
    onDelta: (delta) => {
      useAppStore.getState().actions.response.appendDelta({ delta, requestId });
    },
  }).then(
    ({ patch, responseText }) => {
      const actions = useAppStore.getState().actions.response;
      actions.finish({ requestId, responseText });
      if (patch !== null) {
        actions.setPatch({
          patch: { ...patch, applyStatus: "pending" },
          requestId,
        });
      }
    },
    (error: unknown) => {
      useAppStore.getState().actions.response.fail({
        errorMessage: error instanceof Error ? error.message : String(error),
        requestId,
      });
    },
  );
}

function runFocusedContextItemPrimaryAction() {
  const currentState = useAppStore.getState();
  if (currentState.screen.name !== "compose") {
    return;
  }

  const focusedItem = getContextItemById(
    currentState.screen.contextItems,
    currentState.screen.focusedContextItemId,
  );
  const primaryAction = focusedItem
    ?.getActions()
    .find((action) => action.id !== "remove");
  if (primaryAction === undefined) {
    runFocusedContextItemAction("remove");
    return;
  }

  runContextItemAction(primaryAction);
}

function runFocusedContextItemAction(actionId: string) {
  const currentState = useAppStore.getState();
  if (currentState.screen.name !== "compose") {
    return;
  }

  const focusedItem = getContextItemById(
    currentState.screen.contextItems,
    currentState.screen.focusedContextItemId,
  );
  const action = focusedItem
    ?.getActions()
    .find((candidate) => candidate.id === actionId);
  if (action === undefined) {
    return;
  }

  runContextItemAction(action);
}

function runContextItemAction(action: ContextItemAction) {
  void action.run({
    removeContextItem: (itemId) => {
      useAppStore.getState().actions.compose.removeContextItem({ itemId });
    },
    rerunPrompt: startPromptRequest,
  });
}
