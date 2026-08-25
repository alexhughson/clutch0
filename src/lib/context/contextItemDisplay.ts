import type {
  ContextItem,
  ContextItemListGroupId,
  ContextItemSummaryView,
} from "../../types";
import { FileContextItem, UserTextContextItem } from "./contextItems";

// These must track the workspace stack styles in App.tsx: outer padding,
// the gap between context columns, and the row indent plus marker width.
const WORKSPACE_STACK_HORIZONTAL_CHROME = 2;
const CONTEXT_COLUMN_GAP = 2;
const CONTEXT_ROW_WRAP_CHROME = 4;
// Extra wrap chrome per tree depth: two indent columns per level.
const CONTEXT_ROW_WRAP_CHROME_PER_DEPTH = 2;

// Inline notes and generated summaries are capped so one item cannot push
// the composer out of the workspace stack. Rendering truncates with the
// same helpers, so estimates and rendered rows stay in agreement.
const INLINE_LIST_MAX_ROWS = 3;
const SUMMARY_LIST_MAX_ROWS = 2;

export type ContextItemDisplayEntry =
  | {
      depth: number;
      key: string;
      kind: "folder";
      label: string;
    }
  | {
      depth: number;
      item: ContextItem;
      kind: "item";
      label?: string;
    };

type FileTreeNode = {
  directories: Map<string, FileTreeNode>;
  files: Map<string, FileContextItem>;
};

const LIST_GROUP_ORDER = [
  "say",
  "ask",
  "workspace",
  "agent",
  "edit",
  "commands",
] as const satisfies readonly ContextItemListGroupId[];

const LIST_GROUP_LABELS: Record<ContextItemListGroupId, string> = {
  agent: "/agent",
  ask: "/ask",
  commands: "commands",
  edit: "/edit",
  say: "/say",
  workspace: "workspace",
};

export function getContextItemDisplayEntries(
  contextItems: readonly ContextItem[],
): ContextItemDisplayEntry[] {
  const pinnedItems = contextItems.filter((item) => item.isPinned());
  const unpinnedItems = contextItems.filter((item) => !item.isPinned());
  const fileItems = getFileContextItems(unpinnedItems);
  const nonFileItems = unpinnedItems.filter(
    (item) => !(item instanceof FileContextItem),
  );

  return [
    ...getPinnedDisplayEntries(pinnedItems),
    ...getTypeGroupDisplayEntries(nonFileItems),
    ...getFileDisplayEntries(fileItems),
  ];
}

export function getContextItemInlineListContent(
  item: ContextItem,
): string | null {
  if (item instanceof UserTextContextItem) {
    return item.text.length > 0 ? item.text : "Empty note";
  }

  return null;
}

export function getContextItemShortSummary(
  summary: ContextItemSummaryView,
): string | null {
  if (summary.status === "ready" && summary.title !== summary.label) {
    return summary.title;
  }

  if (summary.status === "pending") {
    return "Summarizing…";
  }

  return null;
}

export function getContextListWrapWidth({
  columns,
  terminalWidth,
}: {
  columns: 1 | 2;
  terminalWidth: number;
}): number {
  const paddedWidth = Math.max(
    0,
    terminalWidth - WORKSPACE_STACK_HORIZONTAL_CHROME,
  );
  const columnWidth =
    columns === 1
      ? paddedWidth
      : Math.floor((paddedWidth - CONTEXT_COLUMN_GAP) / 2);
  return getWrapWidthForColumn(columnWidth);
}

export function getWrapWidthForColumn(columnWidth: number): number {
  return Math.max(1, columnWidth - CONTEXT_ROW_WRAP_CHROME);
}

export function getWrapWidthForDepth(wrapWidth: number, depth: number): number {
  return Math.max(1, wrapWidth - depth * CONTEXT_ROW_WRAP_CHROME_PER_DEPTH);
}

export function getContextItemSummaryRowCount(
  summary: string,
  wrapWidth: number,
): number {
  if (summary.replace(/\s+/g, "").length === 0) {
    return 0;
  }

  let rows = 0;
  for (const line of summary.split("\n")) {
    rows += Math.max(1, Math.ceil(line.length / wrapWidth));
  }
  return rows;
}

export function truncateTextToRows(
  text: string,
  wrapWidth: number,
  maxRows: number,
): string {
  let rowsUsed = 0;
  const keptLines: string[] = [];
  for (const line of text.split("\n")) {
    const remainingRows = maxRows - rowsUsed;
    if (remainingRows <= 0) {
      trimLastLineForEllipsis(keptLines, wrapWidth);
      return `${keptLines.join("\n")}…`;
    }

    const lineRows = Math.max(1, Math.ceil(line.length / wrapWidth));
    if (lineRows <= remainingRows) {
      keptLines.push(line);
      rowsUsed += lineRows;
      continue;
    }

    keptLines.push(line.slice(0, Math.max(1, remainingRows * wrapWidth - 1)));
    return `${keptLines.join("\n")}…`;
  }
  return keptLines.join("\n");
}

// Appending the ellipsis must not push the last kept line onto a new row.
function trimLastLineForEllipsis(lines: string[], wrapWidth: number): void {
  if (lines.length === 0) {
    return;
  }

  const lastLine = lines[lines.length - 1];
  if (lastLine.length % wrapWidth === 0) {
    lines[lines.length - 1] = lastLine.slice(
      0,
      Math.max(0, lastLine.length - 1),
    );
  }
}

// Single truncation path: rendering and row estimates both go through these
// helpers, so the estimated height always matches the rendered rows.
export function getInlineListDisplayContent(
  item: ContextItem,
  wrapWidth: number,
): { content: string; rowCount: number } | null {
  const inlineContent = getContextItemInlineListContent(item);
  if (inlineContent === null) {
    return null;
  }
  return fitToRowBudget(inlineContent, wrapWidth, INLINE_LIST_MAX_ROWS);
}

export function getListShortSummary(
  summary: ContextItemSummaryView,
  wrapWidth: number,
): { content: string; rowCount: number } | null {
  const shortSummary = getContextItemShortSummary(summary);
  if (shortSummary === null) {
    return null;
  }
  return fitToRowBudget(shortSummary, wrapWidth, SUMMARY_LIST_MAX_ROWS);
}

function fitToRowBudget(
  text: string,
  wrapWidth: number,
  maxRows: number,
): { content: string; rowCount: number } {
  const content = truncateTextToRows(text, wrapWidth, maxRows);
  return {
    content,
    rowCount: getContextItemSummaryRowCount(content, wrapWidth),
  };
}

export function estimateContextItemListRowCount(
  item: ContextItem,
  wrapWidth: number,
): number {
  const inlineDisplay = getInlineListDisplayContent(item, wrapWidth);
  if (inlineDisplay !== null) {
    return inlineDisplay.rowCount;
  }

  let rows = 1;
  const regenStatus = item.getRegenStatus?.();
  if (regenStatus?.status === "running" || regenStatus?.status === "error") {
    rows += 1;
  }

  const summaryDisplay = getListShortSummary(item.getSummaryView(), wrapWidth);
  if (summaryDisplay !== null) {
    rows += summaryDisplay.rowCount;
  }

  return rows;
}

export function getContextItemDisplayOrder(
  contextItems: readonly ContextItem[],
): ContextItem[] {
  return getContextItemDisplayEntries(contextItems)
    .filter(
      (entry): entry is Extract<ContextItemDisplayEntry, { kind: "item" }> =>
        entry.kind === "item",
    )
    .map((entry) => entry.item);
}

function getPinnedDisplayEntries(
  pinnedItems: readonly ContextItem[],
): ContextItemDisplayEntry[] {
  if (pinnedItems.length === 0) {
    return [];
  }

  return [
    {
      depth: 0,
      key: "group:pinned",
      kind: "folder",
      label: "pinned",
    },
    ...pinnedItems.map((item) => ({
      depth: 1,
      item,
      kind: "item" as const,
      label: item.getListGroup()?.itemLabel,
    })),
  ];
}

function getTypeGroupDisplayEntries(
  items: readonly ContextItem[],
): ContextItemDisplayEntry[] {
  const ungrouped: ContextItem[] = [];
  const buckets = new Map<
    ContextItemListGroupId,
    { item: ContextItem; itemLabel: string }[]
  >();

  for (const item of items) {
    const group = item.getListGroup();
    if (group === null) {
      ungrouped.push(item);
      continue;
    }

    if (!isListGroupId(group.id)) {
      throw new Error(
        `Unknown context item list group: ${group.id} (${item.id})`,
      );
    }

    const existing = buckets.get(group.id);
    if (existing === undefined) {
      buckets.set(group.id, [{ item, itemLabel: group.itemLabel }]);
      continue;
    }

    existing.push({ item, itemLabel: group.itemLabel });
  }

  const entries: ContextItemDisplayEntry[] = [];
  for (const item of ungrouped) {
    entries.push({ depth: 0, item, kind: "item" });
  }

  for (const groupId of LIST_GROUP_ORDER) {
    const groupItems = buckets.get(groupId);
    if (groupItems === undefined) {
      continue;
    }

    entries.push({
      depth: 0,
      key: `group:${groupId}`,
      kind: "folder",
      label: LIST_GROUP_LABELS[groupId],
    });
    for (const { item, itemLabel } of groupItems) {
      entries.push({
        depth: 1,
        item,
        kind: "item",
        label: itemLabel,
      });
    }
  }

  return entries;
}

function isListGroupId(value: string): value is ContextItemListGroupId {
  return (LIST_GROUP_ORDER as readonly string[]).includes(value);
}

function getFileContextItems(
  contextItems: readonly ContextItem[],
): FileContextItem[] {
  return contextItems
    .filter((item): item is FileContextItem => item instanceof FileContextItem)
    .sort((a, b) => comparePath(a.filePath, b.filePath));
}

function getFileDisplayEntries(
  fileItems: readonly FileContextItem[],
): ContextItemDisplayEntry[] {
  const root = createFileTreeNode();
  for (const item of fileItems) {
    insertFile(root, item);
  }

  return renderNodeChildren(root, 0, "");
}

function createFileTreeNode(): FileTreeNode {
  return {
    directories: new Map(),
    files: new Map(),
  };
}

function insertFile(root: FileTreeNode, item: FileContextItem) {
  const parts = item.filePath.split("/").filter((part) => part.length > 0);
  if (parts.length === 0) {
    return;
  }

  let node = root;
  for (const directory of parts.slice(0, -1)) {
    const existing = node.directories.get(directory);
    if (existing !== undefined) {
      node = existing;
      continue;
    }

    const next = createFileTreeNode();
    node.directories.set(directory, next);
    node = next;
  }

  node.files.set(parts[parts.length - 1] ?? item.filePath, item);
}

function renderNodeChildren(
  node: FileTreeNode,
  depth: number,
  keyPrefix: string,
): ContextItemDisplayEntry[] {
  const entries: ContextItemDisplayEntry[] = [];
  const fileNames = [...node.files.keys()].sort(comparePath);
  const directoryNames = [...node.directories.keys()].sort(comparePath);

  for (const childName of fileNames) {
    const fileItem = node.files.get(childName);
    if (fileItem !== undefined) {
      entries.push({
        depth,
        item: fileItem,
        kind: "item",
        label: `@${childName}`,
      });
    }
  }

  for (const childName of directoryNames) {
    const directory = node.directories.get(childName);
    if (directory !== undefined) {
      entries.push(...renderDirectory(childName, directory, depth, keyPrefix));
    }
  }

  return entries;
}

function renderDirectory(
  name: string,
  node: FileTreeNode,
  depth: number,
  keyPrefix: string,
): ContextItemDisplayEntry[] {
  const { compactName, compactNode } = compactDirectory(name, node);
  const key = `${keyPrefix}/${compactName}`;
  const label = depth === 0 ? compactName : `/${compactName}`;

  return [
    {
      depth,
      key,
      kind: "folder",
      label,
    },
    ...renderNodeChildren(compactNode, depth + 1, key),
  ];
}

function compactDirectory(name: string, node: FileTreeNode) {
  const parts = [name];
  let current = node;

  while (current.files.size === 0 && current.directories.size === 1) {
    const [[nextName, nextNode]] = current.directories.entries();
    if (nextName === undefined || nextNode === undefined) {
      break;
    }

    parts.push(nextName);
    current = nextNode;
  }

  return {
    compactName: parts.join("/"),
    compactNode: current,
  };
}

function comparePath(a: string, b: string): number {
  if (a === b) {
    return 0;
  }

  return a < b ? -1 : 1;
}
