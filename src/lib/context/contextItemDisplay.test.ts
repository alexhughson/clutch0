import { expect, test } from "bun:test";
import {
  getAutomaticContextItems,
  getVisibleContextItems,
} from "./automaticContextItems";
import {
  createFileContextItem,
  createLiveLlmResponseContextItem,
  createPiAgentContextItem,
  createSavedAgentSandboxDiffContextItem,
  createSavedDiffContextItem,
  createSavedLlmResponseContextItem,
  createShellCommandOutputContextItem,
  createUserTextContextItem,
} from "./contextItems";
import type { ContextItem } from "../../types";
import {
  getContextItemDisplayEntries,
  getContextItemDisplayOrder,
  getContextItemSummaryRowCount,
  getContextListWrapWidth,
  getInlineListDisplayContent,
  getListShortSummary,
  estimateContextItemListRowCount,
  truncateTextToRows,
} from "./contextItemDisplay";

test("counts wrapped rows per explicit line", () => {
  expect(getContextItemSummaryRowCount("short", 80)).toBe(1);
  expect(getContextItemSummaryRowCount("x".repeat(81), 80)).toBe(2);
  expect(
    getContextItemSummaryRowCount(`${"x".repeat(90)}\n${"y".repeat(90)}`, 80),
  ).toBe(4);
  expect(getContextItemSummaryRowCount("   \n  ", 80)).toBe(0);
});

test("truncates text to the row budget and marks the cut", () => {
  expect(truncateTextToRows("short", 80, 3)).toBe("short");
  expect(truncateTextToRows("x".repeat(200), 80, 2)).toBe(
    `${"x".repeat(159)}…`,
  );
  expect(truncateTextToRows("a\nb\nc\nd", 80, 3)).toBe("a\nb\nc…");
});

test("computes list wrap width from terminal width and column count", () => {
  expect(getContextListWrapWidth({ columns: 1, terminalWidth: 100 })).toBe(94);
  expect(getContextListWrapWidth({ columns: 2, terminalWidth: 100 })).toBe(44);
  expect(getContextListWrapWidth({ columns: 2, terminalWidth: 24 })).toBe(6);
});

test("inline note estimates match the truncated render output", () => {
  const say = createUserTextContextItem({
    createdAt: 1,
    id: "say:long",
    text: `${"x".repeat(300)} tail`,
  });

  const display = getInlineListDisplayContent(say, 80);
  if (display === null) {
    throw new Error("expected inline list content for a user text item");
  }

  expect(display.content).toBe(`${"x".repeat(239)}…`);
  expect(display.rowCount).toBe(
    getContextItemSummaryRowCount(display.content, 80),
  );
  expect(display.rowCount).toBeLessThanOrEqual(3);
  expect(estimateContextItemListRowCount(say, 80)).toBe(display.rowCount);
});

test("summary estimates match the truncated render output", () => {
  const longTitle = `${"y".repeat(300)} tail`;
  const item = {
    id: "ask:long",
    getListGroup: () => null,
    getSummaryView: () => ({ label: "ask", status: "ready", title: longTitle }),
    isPinned: () => false,
  } as ContextItem;

  const display = getListShortSummary(
    { label: "ask", status: "ready", title: longTitle },
    80,
  );
  if (display === null) {
    throw new Error("expected short summary for a ready title");
  }

  expect(display.content.endsWith("…")).toBe(true);
  expect(display.rowCount).toBeLessThanOrEqual(2);
  expect(estimateContextItemListRowCount(item, 80)).toBe(1 + display.rowCount);
});

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

  expect(summarizeEntries(entries)).toEqual([
    { kind: "folder", label: "pinned" },
    { id: pinnedAsk.id, kind: "item", label: "what next" },
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

test("focus order walks pinned items, then grouped items, then files", () => {
  const pinnedAsk = createSavedLlmResponseContextItem({
    createdAt: 1,
    id: "saved:ask",
    output: "next",
    prompt: "what next",
    sourceRequestId: 1,
  }).withPinned(true);
  const file = createFileContextItem("package.json");
  const say = createUserTextContextItem({
    createdAt: 2,
    id: "say:1",
    text: "remember the layout",
  });

  expect(
    getContextItemDisplayOrder([say, file, pinnedAsk]).map((item) => item.id),
  ).toEqual([pinnedAsk.id, say.id, file.id]);
});

test("groups non-file items by slash command and drops type prefixes", () => {
  const say = createUserTextContextItem({
    createdAt: 1,
    id: "say:1",
    text: "remember the layout",
  });
  const ask = createSavedLlmResponseContextItem({
    createdAt: 2,
    id: "ask:1",
    output: "next",
    prompt: "what next",
    sourceRequestId: 1,
  });
  const liveAsk = createLiveLlmResponseContextItem({
    createdAt: 3,
    id: "ask:live",
    prompt: "still running",
    sourceRequestId: 2,
  });
  const agent = createPiAgentContextItem({
    createdAt: 4,
    id: "agent:1",
    prompt: "fix the bug",
  });
  const agentDiff = createSavedAgentSandboxDiffContextItem({
    createdAt: 5,
    diffText: "diff --git a/a b/a",
    id: "agent-diff:1",
    prompt: "agent patch",
    sourceAgentItemId: "agent:1",
    summary: "touch a",
  });
  const edit = createSavedDiffContextItem({
    createdAt: 6,
    diffText: "diff --git a/a b/a",
    id: "edit:1",
    prompt: "rename helper",
    proposal: {
      patch:
        "*** Begin Patch\n*** Update File: a\n@@\n-old\n+new\n*** End Patch",
      summary: "rename helper",
    },
    sourceRequestId: 3,
    summary: "rename helper",
  });
  const command = createShellCommandOutputContextItem({
    createdAt: 7,
    id: "cmd:1",
    result: {
      command: "git status",
      durationMs: 10,
      exitCode: 0,
      stderr: "",
      stdout: "clean",
      timedOut: false,
      truncated: false,
    },
    sourceRequestId: 4,
  });
  const file = createFileContextItem("package.json");
  const workspaceItems = getAutomaticContextItems().filter(
    (item) => item.getListGroup()?.id === "workspace",
  );

  const entries = getContextItemDisplayEntries([
    command,
    file,
    edit,
    agentDiff,
    agent,
    liveAsk,
    ask,
    say,
    ...workspaceItems,
  ]);

  expect(summarizeEntries(entries)).toEqual([
    { kind: "folder", label: "/say" },
    { id: say.id, kind: "item", label: "remember the layout" },
    { kind: "folder", label: "/ask" },
    { id: liveAsk.id, kind: "item", label: "still running" },
    { id: ask.id, kind: "item", label: "what next" },
    { kind: "folder", label: "workspace" },
    { id: workspaceItems[0]?.id, kind: "item", label: "Current changes" },
    { id: workspaceItems[1]?.id, kind: "item", label: "File list" },
    { kind: "folder", label: "/agent" },
    { id: agentDiff.id, kind: "item", label: "touch a" },
    { id: agent.id, kind: "item", label: "fix the bug" },
    { kind: "folder", label: "/edit" },
    { id: edit.id, kind: "item", label: "rename helper" },
    { kind: "folder", label: "commands" },
    { id: command.id, kind: "item", label: "git status" },
    { id: file.id, kind: "item", label: "@package.json" },
  ]);
});

test("visible automatic deck keeps the file tree and groups ambient items", () => {
  const entries = getContextItemDisplayEntries(getVisibleContextItems([]));

  expect(summarizeEntries(entries)).toEqual([
    { kind: "folder", label: "workspace" },
    { id: "builtin:unstaged-changes", kind: "item", label: "Current changes" },
    { id: "builtin:file-list", kind: "item", label: "File list" },
    { id: "file:AGENTS.md", kind: "item", label: "@AGENTS.md" },
  ]);
});

test("omits empty type groups and leaves the file tree unchanged", () => {
  const ask = createSavedLlmResponseContextItem({
    createdAt: 1,
    id: "ask:1",
    output: "next",
    prompt: "what next",
    sourceRequestId: 1,
  });
  const nestedFile = createFileContextItem("src/lib/file1.js");

  expect(
    summarizeEntries(getContextItemDisplayEntries([ask, nestedFile])),
  ).toEqual([
    { kind: "folder", label: "/ask" },
    { id: ask.id, kind: "item", label: "what next" },
    { kind: "folder", label: "src/lib" },
    { id: nestedFile.id, kind: "item", label: "@file1.js" },
  ]);
});

function summarizeEntries(
  entries: ReturnType<typeof getContextItemDisplayEntries>,
) {
  return entries.map((entry) =>
    entry.kind === "folder"
      ? { kind: entry.kind, label: entry.label }
      : { id: entry.item.id, kind: entry.kind, label: entry.label },
  );
}
