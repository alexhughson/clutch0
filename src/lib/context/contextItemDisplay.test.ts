import { expect, test } from "bun:test";
import {
  createFileContextItem,
  createSavedLlmResponseContextItem,
} from "./contextItems";
import {
  getContextItemDisplayEntries,
  getContextItemDisplayOrder,
} from "./contextItemDisplay";

test("groups file context items under compact alphabetical folder headers", () => {
  const entries = getContextItemDisplayEntries([
    createFileContextItem("src/lib/integration/file3.js"),
    createFileContextItem("src/lib/file1.js"),
    createFileContextItem("src/lib/integration/file2.js"),
  ]);

  expect(
    entries.map((entry) =>
      entry.kind === "folder"
        ? { depth: entry.depth, kind: entry.kind, label: entry.label }
        : { depth: entry.depth, kind: entry.kind, label: entry.label },
    ),
  ).toEqual([
    { depth: 0, kind: "folder", label: "src/lib" },
    { depth: 1, kind: "item", label: "@file1.js" },
    { depth: 1, kind: "folder", label: "/integration" },
    { depth: 2, kind: "item", label: "@file2.js" },
    { depth: 2, kind: "item", label: "@file3.js" },
  ]);
});

test("renders root files before folder groups", () => {
  const entries = getContextItemDisplayEntries([
    createFileContextItem("src/index.ts"),
    createFileContextItem("package.json"),
    createFileContextItem("AGENTS.md"),
    createFileContextItem("docs/guide.md"),
  ]);

  expect(
    entries.map((entry) =>
      entry.kind === "folder"
        ? { depth: entry.depth, kind: entry.kind, label: entry.label }
        : { depth: entry.depth, kind: entry.kind, label: entry.label },
    ),
  ).toEqual([
    { depth: 0, kind: "item", label: "@AGENTS.md" },
    { depth: 0, kind: "item", label: "@package.json" },
    { depth: 0, kind: "folder", label: "docs" },
    { depth: 1, kind: "item", label: "@guide.md" },
    { depth: 0, kind: "folder", label: "src" },
    { depth: 1, kind: "item", label: "@index.ts" },
  ]);
});

test("pinned items sit above the file tree and are not duplicated", () => {
  const pinnedFile = createFileContextItem("src/lib/file1.js").withPinned(true);
  const pinnedAsk = createSavedLlmResponseContextItem({
    createdAt: 1,
    id: "saved:ask",
    output: "next",
    prompt: "what next",
    sourceRequestId: 1,
  }).withPinned(true);
  const unpinnedFile = createFileContextItem("src/lib/file2.js");

  const entries = getContextItemDisplayEntries([
    unpinnedFile,
    pinnedAsk,
    pinnedFile,
  ]);

  expect(
    entries.map((entry) =>
      entry.kind === "folder"
        ? { kind: entry.kind, label: entry.label }
        : { id: entry.item.id, kind: entry.kind, label: entry.label },
    ),
  ).toEqual([
    { id: pinnedAsk.id, kind: "item", label: undefined },
    { id: pinnedFile.id, kind: "item", label: undefined },
    { kind: "folder", label: "src/lib" },
    { id: unpinnedFile.id, kind: "item", label: "@file2.js" },
  ]);
});

test("focus order walks pinned items first", () => {
  const pinnedAsk = createSavedLlmResponseContextItem({
    createdAt: 1,
    id: "saved:ask",
    output: "next",
    prompt: "what next",
    sourceRequestId: 1,
  }).withPinned(true);
  const file = createFileContextItem("src/index.ts");

  expect(
    getContextItemDisplayOrder([file, pinnedAsk]).map((item) => item.id),
  ).toEqual([pinnedAsk.id, file.id]);
});
