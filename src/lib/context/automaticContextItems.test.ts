import { execFile } from "node:child_process";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "bun:test";
import {
  getVisibleContextItems,
  UNSTAGED_CHANGES_CONTEXT_ITEM_ID,
} from "./automaticContextItems";

const execFileAsync = promisify(execFile);

test("shows automatic unstaged changes in the visible context list", () => {
  expect(getVisibleContextItems([]).map((item) => item.getListLabel())).toEqual(
    ["@AGENTS.md", "Unstaged changes", "File list"],
  );
});

test("unstaged changes detail shows the working tree diff", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-unstaged-context-"));
  await git(root, ["init"]);
  await writeFile(join(root, "example.txt"), "before\n");
  await git(root, ["add", "example.txt"]);
  await writeFile(join(root, "example.txt"), "after\n");

  const item = getUnstagedChangesItem();
  const detail = await item.getDetailView({ root });

  expect(detail?.kind).toBe("diff");
  if (detail?.kind !== "diff") {
    throw new Error("Expected diff detail view.");
  }

  expect(detail.diffText).toContain("--- a/example.txt");
  expect(detail.diffText).toContain("-before");
  expect(detail.diffText).toContain("+after");
});

test("unstaged changes detail shows an empty state when the tree is clean", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-unstaged-context-"));
  await git(root, ["init"]);

  const detail = await getUnstagedChangesItem().getDetailView({ root });

  expect(detail).toEqual({
    content: "No unstaged changes.",
    kind: "text",
    title: "Unstaged changes",
  });
});

test("unstaged changes detail is empty outside git repositories", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-unstaged-context-"));

  const detail = await getUnstagedChangesItem().getDetailView({ root });

  expect(detail).toEqual({
    content: "No unstaged changes.",
    kind: "text",
    title: "Unstaged changes",
  });
});

function getUnstagedChangesItem() {
  const item = getVisibleContextItems([]).find(
    (contextItem) => contextItem.id === UNSTAGED_CHANGES_CONTEXT_ITEM_ID,
  );
  if (item === undefined) {
    throw new Error("Expected automatic unstaged changes context item.");
  }

  return item;
}

async function git(root: string, args: readonly string[]) {
  await execFileAsync("git", ["-C", root, ...args]);
}
