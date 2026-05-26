import type { FileSelectorMatch } from "../types";

export const NoFileSelector = Symbol("NoFileSelector");
export const NoSlashCommandSelector = Symbol("NoSlashCommandSelector");

export type FileSelector = string | typeof NoFileSelector;

export type FileSelectorMatchResult = FileSelectorMatch | typeof NoFileSelector;

export type SlashCommandSelectorMatch = {
  commandSelector: string;
  end: number;
  start: number;
};

export type SlashCommandSelectorMatchResult =
  | SlashCommandSelectorMatch
  | typeof NoSlashCommandSelector;

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

export const slashCommandSelectorExamples = new Map<
  string,
  string | typeof NoSlashCommandSelector
>([
  ["/|", ""],
  ["/fi|", "fi"],
  ["hello /fi|", NoSlashCommandSelector],
  ["hello/foo|", NoSlashCommandSelector],
  ["/find |auth", NoSlashCommandSelector],
  ["|/find", NoSlashCommandSelector],
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

/** Returns the /command query under the cursor, or NoSlashCommandSelector outside one. */
export function getSlashCommandSelectorMatchAtCursor(
  inputLine: string,
  cursorPosition: number,
): SlashCommandSelectorMatchResult {
  if (cursorPosition < 0 || cursorPosition > inputLine.length) {
    return NoSlashCommandSelector;
  }

  const slash = inputLine.lastIndexOf("/", cursorPosition - 1);
  if (slash === -1) {
    return NoSlashCommandSelector;
  }

  if (slash !== 0) {
    return NoSlashCommandSelector;
  }

  const spaceAfterSlash = inputLine.indexOf(" ", slash + 1);
  const end = spaceAfterSlash === -1 ? inputLine.length : spaceAfterSlash;

  if (cursorPosition <= slash || cursorPosition > end) {
    return NoSlashCommandSelector;
  }

  return {
    commandSelector: inputLine.slice(slash + 1, end),
    end,
    start: slash,
  };
}
