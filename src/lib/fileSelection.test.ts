import { expect, test } from "bun:test";
import {
  getHighlightedFilePathForVisibleFiles,
  moveFileHighlight,
} from "./fileSelection";

const visibleFilePaths = [
  "src/index.tsx",
  "src/lib/fileFilter.ts",
  "README.md",
];

test("highlighted file path is null when there are no visible files", () => {
  expect(
    getHighlightedFilePathForVisibleFiles({
      highlightedFilePath: "src/index.tsx",
      visibleFilePaths: [],
    }),
  ).toBeNull();
});

test("highlighted file path keeps the stored path when it is visible", () => {
  expect(
    getHighlightedFilePathForVisibleFiles({
      highlightedFilePath: "src/lib/fileFilter.ts",
      visibleFilePaths,
    }),
  ).toBe("src/lib/fileFilter.ts");
});

test("highlighted file path falls back to the first visible file when the stored path is stale", () => {
  expect(
    getHighlightedFilePathForVisibleFiles({
      highlightedFilePath: "package.json",
      visibleFilePaths,
    }),
  ).toBe("src/index.tsx");
});

test("highlighted file path falls back to the first visible file when nothing is stored", () => {
  expect(
    getHighlightedFilePathForVisibleFiles({
      highlightedFilePath: null,
      visibleFilePaths,
    }),
  ).toBe("src/index.tsx");
});

test("moves file highlight to the next visible file", () => {
  expect(
    moveFileHighlight({
      direction: "next",
      highlightedFilePath: "src/index.tsx",
      visibleFilePaths,
    }),
  ).toBe("src/lib/fileFilter.ts");
});

test("moves file highlight to the previous visible file", () => {
  expect(
    moveFileHighlight({
      direction: "previous",
      highlightedFilePath: "src/lib/fileFilter.ts",
      visibleFilePaths,
    }),
  ).toBe("src/index.tsx");
});

test("moving next wraps from the last visible file to the first", () => {
  expect(
    moveFileHighlight({
      direction: "next",
      highlightedFilePath: "README.md",
      visibleFilePaths,
    }),
  ).toBe("src/index.tsx");
});

test("moving previous wraps from the first visible file to the last", () => {
  expect(
    moveFileHighlight({
      direction: "previous",
      highlightedFilePath: "src/index.tsx",
      visibleFilePaths,
    }),
  ).toBe("README.md");
});

test("movement starts from the fallback selection when the stored path is stale", () => {
  expect(
    moveFileHighlight({
      direction: "next",
      highlightedFilePath: "package.json",
      visibleFilePaths,
    }),
  ).toBe("src/lib/fileFilter.ts");
});

test("moving file highlight is null when there are no visible files", () => {
  expect(
    moveFileHighlight({
      direction: "next",
      highlightedFilePath: "src/index.tsx",
      visibleFilePaths: [],
    }),
  ).toBeNull();
});
