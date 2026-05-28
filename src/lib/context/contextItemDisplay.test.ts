import { expect, test } from "bun:test";
import { createFileContextItem } from "./contextItems";
import { getContextItemDisplayEntries } from "./contextItemDisplay";

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
