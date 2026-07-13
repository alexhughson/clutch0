import type { KeyEvent } from "@opentui/core";
import { getContextItemActionForKeyEvent } from "../../lib/context/contextItemActions";
import { getContextItemActions } from "../../lib/context/contextItemRegistry";
import { getVisibleContextItemById } from "../../lib/context/automaticContextItems";
import { moveFileHighlight } from "../../lib/fileSelection";
import {
  NoFileSelector,
  NoSlashCommandSelector,
  type SlashCommandSelectorMatch,
} from "../../lib/inputLineParser";
import { runContextItemAction } from "../../workflows/contextItems/contextItemActionRunner";
import {
  canSubmitMessage,
  runSubmittedMessage,
} from "../../workflows/slashCommands/runSlashCommand";
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
  getCommandSuggestionStateFromComposeScreen,
  getCursorPositionAfterInput,
  getFileSuggestionStateFromComposeScreen,
  moveCommandHighlight,
  type CommandSuggestionState,
  type FileSuggestionState,
} from "./messageComposerModel";
import { getLlmSlashCommand } from "../../workflows/llmTools/toolRegistry";

export function updateMessage({ nextMessage }: { nextMessage: string }) {
  const currentState = useAppStore.getState();
  if (currentState.activeTask !== null) {
    return;
  }

  const nextCursorPosition = getCursorPositionAfterInput({
    nextMessage,
    previousCursorPosition: currentState.workspace.composer.cursorPosition,
    previousMessage: currentState.workspace.composer.message,
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
  if (currentState.activeTask !== null) {
    return;
  }

  currentState.actions.compose.setComposerState({
    cursorPosition,
    message: currentState.workspace.composer.message,
  });
}

/** Handles composer keyboard shortcuts for file selection and message submission. */
export function handleMessageComposerKeyDown({
  event,
  filePaths,
  highlightedCommandName,
  highlightedFilePath,
  setHighlightedCommandName,
  setHighlightedFilePath,
}: {
  event: KeyEvent;
  filePaths: readonly FilePath[];
  highlightedCommandName: string | null;
  highlightedFilePath: HighlightedFilePath;
  setHighlightedCommandName: (highlightedCommandName: string | null) => void;
  setHighlightedFilePath: (highlightedFilePath: HighlightedFilePath) => void;
}) {
  const action = getMessageComposerKeyAction(event);

  const currentState = useAppStore.getState();
  if (currentState.activeTask !== null) {
    return;
  }

  const fileSuggestionState = getFileSuggestionStateFromComposeScreen({
    filePaths,
    highlightedFilePath,
    screen: currentState.workspace,
  });

  if (fileSuggestionState.fileSelectorMatch !== NoFileSelector) {
    handleFileSuggestionAction({
      action,
      event,
      highlightedFilePath: fileSuggestionState.highlightedFilePath,
      setHighlightedFilePath,
      suggestionState: {
        ...fileSuggestionState,
        fileSelectorMatch: fileSuggestionState.fileSelectorMatch,
      },
    });
    return;
  }

  const commandSuggestionState = getCommandSuggestionStateFromComposeScreen({
    highlightedCommandName,
    screen: currentState.workspace,
  });

  if (commandSuggestionState.commandSelectorMatch !== NoSlashCommandSelector) {
    handleCommandSuggestionAction({
      action,
      event,
      highlightedCommandName: commandSuggestionState.highlightedCommandName,
      setHighlightedCommandName,
      suggestionState: {
        ...commandSuggestionState,
        commandSelectorMatch: commandSuggestionState.commandSelectorMatch,
      },
    });
    return;
  }

  handleContextOrSubmitAction({ action, event });
}

function handleFileSuggestionAction({
  action,
  event,
  highlightedFilePath,
  setHighlightedFilePath,
  suggestionState,
}: {
  action: ReturnType<typeof getMessageComposerKeyAction>;
  event: KeyEvent;
  highlightedFilePath: HighlightedFilePath;
  setHighlightedFilePath: (highlightedFilePath: HighlightedFilePath) => void;
  suggestionState: FileSuggestionState & {
    fileSelectorMatch: FileSelectorMatch;
  };
}) {
  if (action === "confirm" || action === "accept-suggestion") {
    acceptFileSelection({
      event,
      fileSelectorMatch: suggestionState.fileSelectorMatch,
      highlightedFilePath,
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

function handleCommandSuggestionAction({
  action,
  event,
  highlightedCommandName,
  setHighlightedCommandName,
  suggestionState,
}: {
  action: ReturnType<typeof getMessageComposerKeyAction>;
  event: KeyEvent;
  highlightedCommandName: string | null;
  setHighlightedCommandName: (highlightedCommandName: string | null) => void;
  suggestionState: CommandSuggestionState & {
    commandSelectorMatch: SlashCommandSelectorMatch;
  };
}) {
  if (action === "confirm" || action === "accept-suggestion") {
    acceptCommandSelection({
      commandSelectorMatch: suggestionState.commandSelectorMatch,
      event,
      highlightedCommandName,
      setHighlightedCommandName,
    });
    return;
  }

  if (action !== "select-next-file" && action !== "select-previous-file") {
    return;
  }

  if (suggestionState.visibleCommands.length === 0) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  setHighlightedCommandName(
    moveCommandHighlight({
      direction: action === "select-next-file" ? "next" : "previous",
      highlightedCommandName: suggestionState.highlightedCommandName,
      visibleCommands: suggestionState.visibleCommands,
    }),
  );
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
  if (currentState.activeTask !== null) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  setHighlightedFilePath(null);
  currentState.actions.compose.acceptFileSelection({
    cursorPosition: fileSelectorMatch.start,
    filePath: highlightedFilePath,
    message: removeStringRange(
      currentState.workspace.composer.message,
      fileSelectorMatch,
    ),
  });
}

function acceptCommandSelection({
  commandSelectorMatch,
  event,
  highlightedCommandName,
  setHighlightedCommandName,
}: {
  commandSelectorMatch: SlashCommandSelectorMatch;
  event: KeyEvent;
  highlightedCommandName: string | null;
  setHighlightedCommandName: (highlightedCommandName: string | null) => void;
}) {
  if (highlightedCommandName === null) {
    return;
  }

  const command = getLlmSlashCommand(highlightedCommandName);
  if (command === null) {
    return;
  }

  const currentState = useAppStore.getState();
  if (currentState.activeTask !== null) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  setHighlightedCommandName(null);

  const nextMessage = replaceStringRange(
    currentState.workspace.composer.message,
    commandSelectorMatch,
    `/${command.name} `,
  );
  currentState.actions.compose.setComposerState({
    cursorPosition: commandSelectorMatch.start + command.name.length + 2,
    message: nextMessage,
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

function replaceStringRange(
  value: string,
  range: { end: number; start: number },
  replacement: string,
): string {
  return `${value.slice(0, range.start)}${replacement}${value.slice(range.end)}`;
}

function handleContextOrSubmitAction({
  action,
  event,
}: {
  action: ReturnType<typeof getMessageComposerKeyAction>;
  event: KeyEvent;
}) {
  const currentState = useAppStore.getState();
  if (currentState.activeTask !== null) {
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

  runFocusedContextItemActionForKey(event);
}

function submitQuestion(event: KeyEvent) {
  const currentState = useAppStore.getState();
  if (currentState.activeTask !== null) {
    return;
  }

  const message = currentState.workspace.composer.message;
  if (!canSubmitMessage(message)) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  const submittedComposer = currentState.workspace.composer;
  currentState.actions.compose.setComposerState({
    cursorPosition: 0,
    message: "",
  });
  void runSubmittedMessage(message, submittedComposer);
}

function runFocusedContextItemActionForKey(event: KeyEvent) {
  const currentState = useAppStore.getState();
  if (currentState.activeTask !== null) {
    return;
  }

  const focusedItem = getVisibleContextItemById(
    currentState.workspace.contextItems,
    currentState.workspace.focusedContextItemId,
    currentState.workspace.automaticContextItems,
  );
  if (focusedItem === null) {
    return;
  }

  const action = getContextItemActionForKeyEvent({
    actions: getContextItemActions(focusedItem),
    event,
  });
  if (action === null) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();
  runContextItemAction({ action, closeAfterRemove: false });
}
