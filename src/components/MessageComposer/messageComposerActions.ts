import type { KeyEvent } from "@opentui/core";
import { moveFileHighlight } from "../../lib/fileSelection";
import { NoFileSelector } from "../../lib/inputLineParser";
import { removeStringRange } from "../../lib/stringRange";
import { useAppStore } from "../../store/appStore";
import type {
  FilePath,
  FileSelectionDirection,
  FileSelectorMatch,
  HighlightedFilePath,
} from "../../types";
import { getMessageComposerKeyAction } from "./messageComposerKeymap";
import {
  getCursorPositionAfterInput,
  getFileSuggestionState,
  getFileSuggestionStateFromAppState,
} from "./messageComposerModel";

export function updateMessage({
  filePaths,
  nextMessage,
}: {
  filePaths: readonly FilePath[];
  nextMessage: string;
}) {
  const currentState = useAppStore.getState();
  const nextCursorPosition = getCursorPositionAfterInput({
    nextMessage,
    previousCursorPosition: currentState.cursorPosition,
    previousMessage: currentState.message,
  });
  const nextSuggestionState = getFileSuggestionState({
    cursorPosition: nextCursorPosition,
    filePaths,
    highlightedFilePath: currentState.highlightedFilePath,
    message: nextMessage,
    selectedFilePaths: currentState.selectedFilePaths,
  });

  currentState.setComposerState({
    cursorPosition: nextCursorPosition,
    highlightedFilePath: nextSuggestionState.highlightedFilePath,
    message: nextMessage,
  });
}

export function updateCursorPosition({
  cursorPosition,
  filePaths,
}: {
  cursorPosition: number;
  filePaths: readonly FilePath[];
}) {
  const currentState = useAppStore.getState();
  const nextSuggestionState = getFileSuggestionState({
    cursorPosition,
    filePaths,
    highlightedFilePath: currentState.highlightedFilePath,
    message: currentState.message,
    selectedFilePaths: currentState.selectedFilePaths,
  });

  currentState.setComposerState({
    cursorPosition,
    highlightedFilePath: nextSuggestionState.highlightedFilePath,
    message: currentState.message,
  });
}

/** Consumes suggestion keys only while the cursor is inside an @file selector. */
export function handleFileSelectorKeyDown({
  event,
  filePaths,
}: {
  event: KeyEvent;
  filePaths: readonly FilePath[];
}) {
  const action = getMessageComposerKeyAction(event);
  if (action === null) {
    return;
  }

  const currentState = useAppStore.getState();
  const suggestionState = getFileSuggestionStateFromAppState({
    filePaths,
    state: currentState,
  });

  if (suggestionState.fileSelectorMatch === NoFileSelector) {
    return;
  }

  if (action === "accept-file-selection") {
    acceptFileSelection({
      event,
      fileSelectorMatch: suggestionState.fileSelectorMatch,
      highlightedFilePath: suggestionState.highlightedFilePath,
    });
    return;
  }

  if (suggestionState.visibleFilePaths.length === 0) {
    return;
  }

  moveHighlightedFile({
    direction: action === "select-next-file" ? "next" : "previous",
    event,
    highlightedFilePath: suggestionState.highlightedFilePath,
    visibleFilePaths: suggestionState.visibleFilePaths,
  });
}

/** Removes the typed @selector after adding the highlighted file. */
function acceptFileSelection({
  event,
  fileSelectorMatch,
  highlightedFilePath,
}: {
  event: KeyEvent;
  fileSelectorMatch: FileSelectorMatch;
  highlightedFilePath: HighlightedFilePath;
}) {
  if (highlightedFilePath === null) {
    return;
  }

  const currentState = useAppStore.getState();

  event.preventDefault();
  event.stopPropagation();
  currentState.acceptFileSelection({
    cursorPosition: fileSelectorMatch.start,
    filePath: highlightedFilePath,
    message: removeStringRange(currentState.message, fileSelectorMatch),
  });
}

function moveHighlightedFile({
  direction,
  event,
  highlightedFilePath,
  visibleFilePaths,
}: {
  direction: FileSelectionDirection;
  event: KeyEvent;
  highlightedFilePath: HighlightedFilePath;
  visibleFilePaths: FilePath[];
}) {
  event.preventDefault();
  event.stopPropagation();
  useAppStore.getState().setHighlightedFilePath(
    moveFileHighlight({
      direction,
      highlightedFilePath,
      visibleFilePaths,
    }),
  );
}
