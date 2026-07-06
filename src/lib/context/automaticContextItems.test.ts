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

test("unstaged changes detail includes untracked non-ignored files", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-unstaged-context-"));
  await git(root, ["init"]);
  await writeFile(join(root, ".gitignore"), "ignored.txt\n");
  await writeFile(join(root, "new.txt"), "hello from an untracked file\n");
  await writeFile(join(root, "ignored.txt"), "ignored\n");

  const detail = await getUnstagedChangesItem().getDetailView({ root });

  expect(detail?.kind).toBe("diff");
  if (detail?.kind !== "diff") {
    throw new Error("Expected diff detail view.");
  }

  expect(detail.diffText).toContain("diff --git a/new.txt b/new.txt");
  expect(detail.diffText).toContain("new file mode");
  expect(detail.diffText).toContain("+hello from an untracked file");
  expect(detail.diffText).not.toContain(
    "diff --git a/ignored.txt b/ignored.txt",
  );
});

test("unstaged changes detail truncates large working tree diffs", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-unstaged-context-"));
  await git(root, ["init"]);
  await writeFile(join(root, "large.txt"), repeatLines("before", 30_000));
  await git(root, ["add", "large.txt"]);
  await writeFile(join(root, "large.txt"), repeatLines("after", 30_000));

  const detail = await getUnstagedChangesItem().getDetailView({ root });

  expect(detail?.kind).toBe("diff");
  if (detail?.kind !== "diff") {
    throw new Error("Expected diff detail view.");
  }

  expect(detail.diffText).toContain("--- a/large.txt");
  expect(detail.diffText).toContain("[Context truncated.]");
  expect(detail.diffText.length).toBeLessThan(130_000);
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

function repeatLines(prefix: string, count: number): string {
  return Array.from(
    { length: count },
    (_, index) => `${prefix} ${index}\n`,
  ).join("");
}
