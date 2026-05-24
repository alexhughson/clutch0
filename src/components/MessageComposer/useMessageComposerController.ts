import type { CursorChangeEvent, KeyEvent } from "@opentui/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { NoFileSelector } from "../../lib/inputLineParser";
import type { ComposeScreenState } from "../../store/appStore";
import type { FilePath, HighlightedFilePath } from "../../types";
import {
  handleMessageComposerKeyDown,
  updateCursorPosition,
  updateMessage,
} from "./messageComposerActions";
import {
  getFileSuggestionState,
  type FileSuggestionState,
} from "./messageComposerModel";

export function useMessageComposerController({
  composeScreen,
  filePaths,
}: {
  composeScreen: ComposeScreenState;
  filePaths: readonly FilePath[];
}) {
  const [highlightedFilePath, setHighlightedFilePath] =
    useState<HighlightedFilePath>(null);

  const suggestionState = useMemo(
    () =>
      getFileSuggestionState({
        cursorPosition: composeScreen.composer.cursorPosition,
        filePaths,
        highlightedFilePath,
        message: composeScreen.composer.message,
        contextItems: composeScreen.contextItems,
      }),
    [
      composeScreen.composer.cursorPosition,
      composeScreen.composer.message,
      composeScreen.contextItems,
      filePaths,
      highlightedFilePath,
    ],
  );

  useEffect(() => {
    if (highlightedFilePath !== suggestionState.highlightedFilePath) {
      setHighlightedFilePath(suggestionState.highlightedFilePath);
    }
  }, [highlightedFilePath, suggestionState.highlightedFilePath]);

  const handleInput = useCallback((nextMessage: string) => {
    updateMessage({ nextMessage });
  }, []);

  const handleCursorChange = useCallback((event: CursorChangeEvent) => {
    updateCursorPosition({ cursorPosition: event.visualColumn });
  }, []);

  const handleKeyDown = useCallback(
    (event: KeyEvent) => {
      handleMessageComposerKeyDown({
        event,
        filePaths,
        highlightedFilePath: suggestionState.highlightedFilePath,
        setHighlightedFilePath,
      });
    },
    [filePaths, suggestionState.highlightedFilePath],
  );

  return {
    fileSuggestions: getFileSuggestions(suggestionState),
    inputHandlers: {
      onCursorChange: handleCursorChange,
      onInput: handleInput,
      onKeyDown: handleKeyDown,
    },
    message: composeScreen.composer.message,
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
