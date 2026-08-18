import type { ContextItem, ContextItemListGroupId } from "../../types";
import { FileContextItem } from "./contextItems";

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
  "workspace",
  "say",
  "ask",
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
    ...getFileDisplayEntries(fileItems),
    ...getTypeGroupDisplayEntries(nonFileItems),
  ];
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
