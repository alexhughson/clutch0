import { expect, test } from "bun:test";
import { NoFileSelector } from "../../lib/inputLineParser";
import {
  getCursorPositionAfterInput,
  getFileSuggestionState,
} from "./messageComposerModel";

const filePaths = ["src/index.tsx", "src/lib/fileFilter.ts", "README.md"];

test("derives visible files for the active file selector", () => {
  const suggestionState = getFileSuggestionState({
    cursorPosition: "hey @src".length,
    filePaths,
    highlightedFilePath: null,
    message: "hey @src",
    selectedFilePaths: [],
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
    selectedFilePaths: ["src/index.tsx"],
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
    selectedFilePaths: [],
  });

  expect(suggestionState.fileSelectorMatch).toBe(NoFileSelector);
  expect(suggestionState.visibleFilePaths).toEqual([]);
  expect(suggestionState.highlightedFilePath).toBeNull();
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
