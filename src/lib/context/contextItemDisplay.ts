import type { ContextItem } from "../../types";
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

export function getContextItemDisplayEntries(
  contextItems: readonly ContextItem[],
): ContextItemDisplayEntry[] {
  const fileItems = getFileContextItems(contextItems);
  const nonFileEntries = contextItems
    .filter((item) => !(item instanceof FileContextItem))
    .map((item) => ({ depth: 0, item, kind: "item" as const }));

  return [...getFileDisplayEntries(fileItems), ...nonFileEntries];
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
  const childNames = [...node.files.keys(), ...node.directories.keys()].sort(
    comparePath,
  );

  for (const childName of childNames) {
    const fileItem = node.files.get(childName);
    if (fileItem !== undefined) {
      entries.push({
        depth,
        item: fileItem,
        kind: "item",
        label: `@${childName}`,
      });
      continue;
    }

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
