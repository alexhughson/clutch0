import type { CursorChangeEvent, KeyEvent } from "@opentui/core";
import { useCallback, useMemo } from "react";
import { NoFileSelector } from "../../lib/inputLineParser";
import { useAppStore } from "../../store/appStore";
import type { FilePath } from "../../types";
import {
  handleFileSelectorKeyDown,
  updateCursorPosition,
  updateMessage,
} from "./messageComposerActions";
import {
  getFileSuggestionState,
  type FileSuggestionState,
} from "./messageComposerModel";

export function useMessageComposerController(filePaths: readonly FilePath[]) {
  const cursorPosition = useAppStore((state) => state.cursorPosition);
  const highlightedFilePath = useAppStore((state) => state.highlightedFilePath);
  const message = useAppStore((state) => state.message);
  const selectedFilePaths = useAppStore((state) => state.selectedFilePaths);

  const suggestionState = useMemo(
    () =>
      getFileSuggestionState({
        cursorPosition,
        filePaths,
        highlightedFilePath,
        message,
        selectedFilePaths,
      }),
    [
      cursorPosition,
      filePaths,
      highlightedFilePath,
      message,
      selectedFilePaths,
    ],
  );

  const handleInput = useCallback(
    (nextMessage: string) => {
      updateMessage({ filePaths, nextMessage });
    },
    [filePaths],
  );

  const handleCursorChange = useCallback(
    (event: CursorChangeEvent) => {
      updateCursorPosition({ cursorPosition: event.visualColumn, filePaths });
    },
    [filePaths],
  );

  const handleKeyDown = useCallback(
    (event: KeyEvent) => {
      handleFileSelectorKeyDown({ event, filePaths });
    },
    [filePaths],
  );

  return {
    fileSuggestions: getFileSuggestions(suggestionState),
    inputHandlers: {
      onCursorChange: handleCursorChange,
      onInput: handleInput,
      onKeyDown: handleKeyDown,
    },
    message,
  };
}

function getFileSuggestions(suggestionState: FileSuggestionState) {
  if (suggestionState.fileSelectorMatch === NoFileSelector) {
    return null;
  }

  return {
    fileSelector: suggestionState.fileSelectorMatch.fileSelector,
    highlightedFilePath: suggestionState.highlightedFilePath,
    visibleFilePaths: suggestionState.visibleFilePaths,
  };
}
