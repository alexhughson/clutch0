import type { KeyEvent } from "@opentui/core";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  NoFileSelector,
  NoSlashCommandSelector,
} from "../../lib/inputLineParser";
import type { ComposeScreenState } from "../../store/appStore";
import type { FilePath, HighlightedFilePath } from "../../types";
import {
  handleMessageComposerKeyDown,
  updateCursorPosition,
  updateMessage,
} from "./messageComposerActions";
import {
  getCommandSuggestionState,
  getFileSuggestionState,
  type CommandSuggestionState,
  type FileSuggestionState,
} from "./messageComposerModel";

export function useMessageComposerController({
  composeScreen,
  filePaths,
  getEditorCursorOffset,
  getEditorMessage,
}: {
  composeScreen: ComposeScreenState;
  filePaths: readonly FilePath[];
  getEditorCursorOffset: () => number;
  getEditorMessage: () => string;
}) {
  const [highlightedFilePath, setHighlightedFilePath] =
    useState<HighlightedFilePath>(null);
  const [highlightedCommandName, setHighlightedCommandName] = useState<
    string | null
  >(null);

  const fileSuggestionState = useMemo(
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

  const commandSuggestionState = useMemo(
    () =>
      fileSuggestionState.fileSelectorMatch === NoFileSelector
        ? getCommandSuggestionState({
            cursorPosition: composeScreen.composer.cursorPosition,
            highlightedCommandName,
            message: composeScreen.composer.message,
          })
        : ({
            commandSelectorMatch: NoSlashCommandSelector,
            highlightedCommandName: null,
            visibleCommands: [],
          } satisfies CommandSuggestionState),
    [
      composeScreen.composer.cursorPosition,
      composeScreen.composer.message,
      fileSuggestionState.fileSelectorMatch,
      highlightedCommandName,
    ],
  );

  useEffect(() => {
    if (highlightedFilePath !== fileSuggestionState.highlightedFilePath) {
      setHighlightedFilePath(fileSuggestionState.highlightedFilePath);
    }
  }, [highlightedFilePath, fileSuggestionState.highlightedFilePath]);

  useEffect(() => {
    if (
      highlightedCommandName !== commandSuggestionState.highlightedCommandName
    ) {
      setHighlightedCommandName(commandSuggestionState.highlightedCommandName);
    }
  }, [highlightedCommandName, commandSuggestionState.highlightedCommandName]);

  const handleContentChange = useCallback(() => {
    updateMessage({ nextMessage: getEditorMessage() });
  }, [getEditorMessage]);

  const handleCursorChange = useCallback(() => {
    updateCursorPosition({ cursorPosition: getEditorCursorOffset() });
  }, [getEditorCursorOffset]);

  const handleKeyDown = useCallback(
    (event: KeyEvent) => {
      handleMessageComposerKeyDown({
        event,
        filePaths,
        highlightedCommandName: commandSuggestionState.highlightedCommandName,
        highlightedFilePath: fileSuggestionState.highlightedFilePath,
        setHighlightedCommandName,
        setHighlightedFilePath,
      });
    },
    [
      commandSuggestionState.highlightedCommandName,
      filePaths,
      fileSuggestionState.highlightedFilePath,
    ],
  );

  return {
    commandSuggestions: getCommandSuggestions(commandSuggestionState),
    fileSuggestions: getFileSuggestions(fileSuggestionState),
    inputHandlers: {
      onContentChange: handleContentChange,
      onCursorChange: handleCursorChange,
      onKeyDown: handleKeyDown,
    },
    message: composeScreen.composer.message,
  };
}

function getCommandSuggestions(suggestionState: CommandSuggestionState) {
  if (suggestionState.commandSelectorMatch === NoSlashCommandSelector) {
    return null;
  }

  return {
    commandSelector: suggestionState.commandSelectorMatch.commandSelector,
    highlightedCommandName: suggestionState.highlightedCommandName,
    visibleCommands: suggestionState.visibleCommands,
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
