import { expect, test } from "bun:test";
import { createFileContextItem } from "../../lib/context/contextItems";
import {
  NoFileSelector,
  NoSlashCommandSelector,
} from "../../lib/inputLineParser";
import {
  getCommandSuggestionState,
  getCursorPositionAfterInput,
  getFileSuggestionState,
  moveCommandHighlight,
} from "./messageComposerModel";

const filePaths = ["src/index.tsx", "src/lib/fileFilter.ts", "README.md"];

test("derives visible files for the active file selector", () => {
  const suggestionState = getFileSuggestionState({
    cursorPosition: "hey @src".length,
    filePaths,
    highlightedFilePath: null,
    message: "hey @src",
    contextItems: [],
  });

  expect(suggestionState.fileSelectorMatch).toEqual({
    fileSelector: "src",
    start: 4,
    end: 8,
  });
  expect(suggestionState.visibleFilePaths).toEqual([
    "src/index.tsx",
    "src/lib/fileFilter.ts",
  ]);
  expect(suggestionState.highlightedFilePath).toBe("src/index.tsx");
});

test("excludes already selected files from visible files", () => {
  const suggestionState = getFileSuggestionState({
    cursorPosition: "@src".length,
    filePaths,
    highlightedFilePath: "src/index.tsx",
    message: "@src",
    contextItems: [createFileContextItem("src/index.tsx")],
  });

  expect(suggestionState.visibleFilePaths).toEqual(["src/lib/fileFilter.ts"]);
  expect(suggestionState.highlightedFilePath).toBe("src/lib/fileFilter.ts");
});

test("does not derive file suggestions without an active selector", () => {
  const suggestionState = getFileSuggestionState({
    cursorPosition: "hello".length,
    filePaths,
    highlightedFilePath: "src/index.tsx",
    message: "hello",
    contextItems: [],
  });

  expect(suggestionState.fileSelectorMatch).toBe(NoFileSelector);
  expect(suggestionState.visibleFilePaths).toEqual([]);
  expect(suggestionState.highlightedFilePath).toBeNull();
});

test("derives visible commands for the active slash selector", () => {
  const suggestionState = getCommandSuggestionState({
    cursorPosition: "/fi".length,
    highlightedCommandName: null,
    message: "/fi",
  });

  expect(suggestionState.commandSelectorMatch).toEqual({
    commandSelector: "fi",
    start: 0,
    end: 3,
  });
  expect(
    suggestionState.visibleCommands.map((command) => command.name),
  ).toEqual(["find", "config"]);
  expect(suggestionState.highlightedCommandName).toBe("find");
});

test("does not derive command suggestions without an active slash selector", () => {
  const suggestionState = getCommandSuggestionState({
    cursorPosition: "hello".length,
    highlightedCommandName: "find",
    message: "hello",
  });

  expect(suggestionState.commandSelectorMatch).toBe(NoSlashCommandSelector);
  expect(suggestionState.visibleCommands).toEqual([]);
  expect(suggestionState.highlightedCommandName).toBeNull();
});

test("moves command highlight through visible commands", () => {
  const suggestionState = getCommandSuggestionState({
    cursorPosition: "/".length,
    highlightedCommandName: null,
    message: "/",
  });

  expect(
    moveCommandHighlight({
      direction: "next",
      highlightedCommandName: "ask",
      visibleCommands: suggestionState.visibleCommands,
    }),
  ).toBe("agent-ask");
});

test("keeps cursor near a mid-line insertion", () => {
  expect(
    getCursorPositionAfterInput({
      previousMessage: "hello @sr world",
      nextMessage: "hello @src world",
      previousCursorPosition: "hello @sr".length,
    }),
  ).toBe("hello @src".length);
});

test("keeps cursor near a mid-line backspace", () => {
  expect(
    getCursorPositionAfterInput({
      previousMessage: "hello @src world",
      nextMessage: "hello @sr world",
      previousCursorPosition: "hello @src".length,
    }),
  ).toBe("hello @sr".length);
});

test("keeps cursor in place for a delete at the cursor", () => {
  expect(
    getCursorPositionAfterInput({
      previousMessage: "hello @src world",
      nextMessage: "hello @sr world",
      previousCursorPosition: "hello @sr".length,
    }),
  ).toBe("hello @sr".length);
});

test("does not move cursor when text changes after it", () => {
  expect(
    getCursorPositionAfterInput({
      previousMessage: "hello @src world",
      nextMessage: "hello @src worlds",
      previousCursorPosition: "hello @src".length,
    }),
  ).toBe("hello @src".length);
});

test("moves cursor after pasted text at the cursor", () => {
  expect(
    getCursorPositionAfterInput({
      previousMessage: "hello  world",
      nextMessage: "hello @src world",
      previousCursorPosition: "hello ".length,
    }),
  ).toBe("hello @src".length);
});
