import { MAX_VISIBLE_FILE_SUGGESTIONS } from "../../constants";
import { filterFiles } from "../../lib/fileFilter";
import { getHighlightedFilePathForVisibleFiles } from "../../lib/fileSelection";
import {
  getFileSelectorMatchAtCursor,
  NoFileSelector,
  type FileSelectorMatchResult,
} from "../../lib/inputLineParser";
import type { ComposeScreenState } from "../../store/appStore";
import type { FilePath, HighlightedFilePath } from "../../types";

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
  selectedFilePaths,
}: {
  cursorPosition: number;
  filePaths: readonly FilePath[];
  highlightedFilePath: HighlightedFilePath;
  message: string;
  selectedFilePaths: readonly FilePath[];
}): FileSuggestionState {
  const fileSelectorMatch = getFileSelectorMatchAtCursor(
    message,
    cursorPosition,
  );
  const visibleFilePaths = getVisibleFilePaths({
    filePaths,
    fileSelectorMatch,
    selectedFilePaths,
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
    selectedFilePaths: screen.selectedFilePaths,
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
