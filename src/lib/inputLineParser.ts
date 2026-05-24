import type { FileSelectorMatch } from "../types";

export const NoFileSelector = Symbol("NoFileSelector");

export type FileSelector = string | typeof NoFileSelector;

export type FileSelectorMatchResult = FileSelectorMatch | typeof NoFileSelector;

export const fileSelectorExamples = new Map<string, FileSelector>([
  ["hello @fo|o world", "foo"],
  ["hello @|foo world", "foo"],
  ["hello @foo| world", "foo"],
  ["hello |@foo world", NoFileSelector],
  ["hello @foo |world", NoFileSelector],
  ["hello @| world", ""],
  ["hello @one @tw|o done", "two"],
  ["hello @sr|c", "src"],
]);

/** Returns the @file query under the cursor, or NoFileSelector outside one. */
export function getFileSelectorAtCursor(
  inputLine: string,
  cursorPosition: number,
): FileSelector {
  const fileSelectorMatch = getFileSelectorMatchAtCursor(
    inputLine,
    cursorPosition,
  );

  return fileSelectorMatch === NoFileSelector
    ? NoFileSelector
    : fileSelectorMatch.fileSelector;
}

/** Returns the @file query and removable text range under the cursor. */
export function getFileSelectorMatchAtCursor(
  inputLine: string,
  cursorPosition: number,
): FileSelectorMatchResult {
  if (cursorPosition < 0 || cursorPosition > inputLine.length) {
    return NoFileSelector;
  }

  const at = inputLine.lastIndexOf("@", cursorPosition - 1);
  if (at === -1) {
    return NoFileSelector;
  }

  const spaceAfterAt = inputLine.indexOf(" ", at + 1);
  const end = spaceAfterAt === -1 ? inputLine.length : spaceAfterAt;

  if (cursorPosition <= at || cursorPosition > end) {
    return NoFileSelector;
  }

  return {
    fileSelector: inputLine.slice(at + 1, end),
    start: at,
    end,
  };
}
