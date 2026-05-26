import { expect, test } from "bun:test";
import {
  fileSelectorExamples,
  getFileSelectorAtCursor,
  getFileSelectorMatchAtCursor,
  getSlashCommandSelectorMatchAtCursor,
  NoFileSelector,
  NoSlashCommandSelector,
  slashCommandSelectorExamples,
} from "./inputLineParser";

test("gets the active file selector at the cursor", () => {
  for (const [markedInputLine, expected] of fileSelectorExamples) {
    const cursorPosition = markedInputLine.indexOf("|");
    const inputLine = markedInputLine.replace("|", "");

    expect(getFileSelectorAtCursor(inputLine, cursorPosition)).toBe(expected);
  }
});

test("gets the active file selector range at the cursor", () => {
  const markedInputLine = "hey @fi|le there";
  const cursorPosition = markedInputLine.indexOf("|");
  const inputLine = markedInputLine.replace("|", "");

  expect(getFileSelectorMatchAtCursor(inputLine, cursorPosition)).toEqual({
    fileSelector: "file",
    start: 4,
    end: 9,
  });
});

test("gets an empty file selector range", () => {
  const markedInputLine = "hey @| there";
  const cursorPosition = markedInputLine.indexOf("|");
  const inputLine = markedInputLine.replace("|", "");

  expect(getFileSelectorMatchAtCursor(inputLine, cursorPosition)).toEqual({
    fileSelector: "",
    start: 4,
    end: 5,
  });
});

test("does not get a file selector range outside a selector", () => {
  expect(getFileSelectorMatchAtCursor("hey @file", 4)).toBe(NoFileSelector);
});

test("gets the active slash command selector at the cursor", () => {
  for (const [markedInputLine, expected] of slashCommandSelectorExamples) {
    const cursorPosition = markedInputLine.indexOf("|");
    const inputLine = markedInputLine.replace("|", "");
    const match = getSlashCommandSelectorMatchAtCursor(
      inputLine,
      cursorPosition,
    );

    expect(
      match === NoSlashCommandSelector
        ? NoSlashCommandSelector
        : match.commandSelector,
    ).toBe(expected);
  }
});

test("gets a slash command selector range", () => {
  const markedInputLine = "/fi|nd there";
  const cursorPosition = markedInputLine.indexOf("|");
  const inputLine = markedInputLine.replace("|", "");

  expect(
    getSlashCommandSelectorMatchAtCursor(inputLine, cursorPosition),
  ).toEqual({
    commandSelector: "find",
    start: 0,
    end: 5,
  });
});
