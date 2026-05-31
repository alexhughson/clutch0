import { MAX_VISIBLE_FILE_SUGGESTIONS } from "../../constants";
import { filterFiles } from "../../lib/fileFilter";
import { getHighlightedFilePathForVisibleFiles } from "../../lib/fileSelection";
import {
  getFileSelectorMatchAtCursor,
  getSlashCommandSelectorMatchAtCursor,
  NoFileSelector,
  NoSlashCommandSelector,
  type FileSelectorMatchResult,
  type SlashCommandSelectorMatchResult,
} from "../../lib/inputLineParser";
import type { ComposeScreenState } from "../../store/appStore";
import { getSelectedFilePaths } from "../../lib/context/contextItems";
import type { ContextItem, FilePath, HighlightedFilePath } from "../../types";
import { getLlmSlashCommands } from "../../workflows/llmTools/toolRegistry";
import type { LlmSlashCommand } from "../../workflows/llmTools/types";

export type CommandSuggestionState = {
  commandSelectorMatch: SlashCommandSelectorMatchResult;
  highlightedCommandName: string | null;
  visibleCommands: LlmSlashCommand[];
};

export type FileSuggestionState = {
  fileSelectorMatch: FileSelectorMatchResult;
  highlightedFilePath: HighlightedFilePath;
  visibleFilePaths: FilePath[];
};

/** Estimates cursor position because OpenTUI onInput only reports new text. */
export function getCursorPositionAfterInput({
  nextMessage,
  previousCursorPosition,
  previousMessage,
}: {
  nextMessage: string;
  previousCursorPosition: number;
  previousMessage: string;
}): number {
  const previousCursor = clamp(
    previousCursorPosition,
    0,
    previousMessage.length,
  );
  let commonPrefixLength = 0;
  const maxPrefixLength = Math.min(previousMessage.length, nextMessage.length);

  while (
    commonPrefixLength < maxPrefixLength &&
    previousMessage[commonPrefixLength] === nextMessage[commonPrefixLength]
  ) {
    commonPrefixLength += 1;
  }

  let commonSuffixLength = 0;
  const maxSuffixLength =
    Math.min(previousMessage.length, nextMessage.length) - commonPrefixLength;

  while (
    commonSuffixLength < maxSuffixLength &&
    previousMessage[previousMessage.length - 1 - commonSuffixLength] ===
      nextMessage[nextMessage.length - 1 - commonSuffixLength]
  ) {
    commonSuffixLength += 1;
  }

  const removedEnd = previousMessage.length - commonSuffixLength;

  if (previousCursor < commonPrefixLength) {
    return previousCursor;
  }

  if (previousCursor > removedEnd) {
    return clamp(
      previousCursor + nextMessage.length - previousMessage.length,
      0,
      nextMessage.length,
    );
  }

  const insertedLength =
    nextMessage.length - commonPrefixLength - commonSuffixLength;

  return clamp(commonPrefixLength + insertedLength, 0, nextMessage.length);
}

/** Computes the @file suggestions that should be shown for the cursor. */
export function getFileSuggestionState({
  cursorPosition,
  filePaths,
  highlightedFilePath,
  message,
  contextItems,
}: {
  contextItems: readonly ContextItem[];
  cursorPosition: number;
  filePaths: readonly FilePath[];
  highlightedFilePath: HighlightedFilePath;
  message: string;
}): FileSuggestionState {
  const fileSelectorMatch = getFileSelectorMatchAtCursor(
    message,
    cursorPosition,
  );
  const visibleFilePaths = getVisibleFilePaths({
    filePaths,
    fileSelectorMatch,
    selectedFilePaths: getSelectedFilePaths(contextItems),
  });

  return {
    fileSelectorMatch,
    highlightedFilePath: getHighlightedFilePathForVisibleFiles({
      highlightedFilePath,
      visibleFilePaths,
    }),
    visibleFilePaths,
  };
}

export function getFileSuggestionStateFromComposeScreen({
  filePaths,
  highlightedFilePath,
  screen,
}: {
  filePaths: readonly FilePath[];
  highlightedFilePath: HighlightedFilePath;
  screen: ComposeScreenState;
}): FileSuggestionState {
  return getFileSuggestionState({
    cursorPosition: screen.composer.cursorPosition,
    filePaths,
    highlightedFilePath,
    message: screen.composer.message,
    contextItems: screen.contextItems,
  });
}

export function getCommandSuggestionState({
  cursorPosition,
  highlightedCommandName,
  message,
}: {
  cursorPosition: number;
  highlightedCommandName: string | null;
  message: string;
}): CommandSuggestionState {
  const commandSelectorMatch = getSlashCommandSelectorMatchAtCursor(
    message,
    cursorPosition,
  );
  const visibleCommands = getVisibleCommands({ commandSelectorMatch });

  return {
    commandSelectorMatch,
    highlightedCommandName: getHighlightedCommandName({
      highlightedCommandName,
      visibleCommands,
    }),
    visibleCommands,
  };
}

export function getCommandSuggestionStateFromComposeScreen({
  highlightedCommandName,
  screen,
}: {
  highlightedCommandName: string | null;
  screen: ComposeScreenState;
}): CommandSuggestionState {
  return getCommandSuggestionState({
    cursorPosition: screen.composer.cursorPosition,
    highlightedCommandName,
    message: screen.composer.message,
  });
}

function getVisibleFilePaths({
  filePaths,
  fileSelectorMatch,
  selectedFilePaths,
}: {
  filePaths: readonly FilePath[];
  fileSelectorMatch: FileSelectorMatchResult;
  selectedFilePaths: readonly FilePath[];
}): FilePath[] {
  if (fileSelectorMatch === NoFileSelector) {
    return [];
  }

  const selectedFilePathSet = new Set(selectedFilePaths);
  const availableFilePaths = filePaths.filter(
    (filePath) => !selectedFilePathSet.has(filePath),
  );

  return filterFiles(fileSelectorMatch.fileSelector, availableFilePaths).slice(
    0,
    MAX_VISIBLE_FILE_SUGGESTIONS,
  );
}

function getVisibleCommands({
  commandSelectorMatch,
}: {
  commandSelectorMatch: SlashCommandSelectorMatchResult;
}): LlmSlashCommand[] {
  if (commandSelectorMatch === NoSlashCommandSelector) {
    return [];
  }

  const commandsByName = new Map(
    getLlmSlashCommands().map((command) => [command.name, command]),
  );

  return filterFiles(
    commandSelectorMatch.commandSelector,
    getLlmSlashCommands().map((command) => command.name),
  )
    .sort((left, right) =>
      comparePrefixCommandMatch(
        commandSelectorMatch.commandSelector,
        left,
        right,
      ),
    )
    .slice(0, MAX_VISIBLE_FILE_SUGGESTIONS)
    .flatMap((commandName) => {
      const command = commandsByName.get(commandName);
      return command === undefined ? [] : [command];
    });
}

function comparePrefixCommandMatch(
  selector: string,
  left: string,
  right: string,
): number {
  const normalizedSelector = selector.toLowerCase();
  const leftIsPrefix = left.toLowerCase().startsWith(normalizedSelector);
  const rightIsPrefix = right.toLowerCase().startsWith(normalizedSelector);

  if (leftIsPrefix === rightIsPrefix) {
    return 0;
  }
  return leftIsPrefix ? -1 : 1;
}

function getHighlightedCommandName({
  highlightedCommandName,
  visibleCommands,
}: {
  highlightedCommandName: string | null;
  visibleCommands: readonly LlmSlashCommand[];
}): string | null {
  if (visibleCommands.length === 0) {
    return null;
  }

  if (
    highlightedCommandName !== null &&
    visibleCommands.some((command) => command.name === highlightedCommandName)
  ) {
    return highlightedCommandName;
  }

  return visibleCommands[0]?.name ?? null;
}

export function moveCommandHighlight({
  direction,
  highlightedCommandName,
  visibleCommands,
}: {
  direction: "next" | "previous";
  highlightedCommandName: string | null;
  visibleCommands: readonly LlmSlashCommand[];
}): string | null {
  if (visibleCommands.length === 0) {
    return null;
  }

  const currentIndex = visibleCommands.findIndex(
    (command) => command.name === highlightedCommandName,
  );
  const nextIndex =
    direction === "next"
      ? (Math.max(0, currentIndex) + 1) % visibleCommands.length
      : (currentIndex <= 0 ? visibleCommands.length : currentIndex) - 1;

  return visibleCommands[nextIndex]?.name ?? null;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
