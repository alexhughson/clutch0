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

test("shows automatic current changes in the visible context list", () => {
  expect(getVisibleContextItems([]).map((item) => item.getListLabel())).toEqual(
    ["@AGENTS.md", "Current changes", "File list"],
  );
});

test("automatic items cannot be pinned", () => {
  const item = getUnstagedChangesItem();
  expect(item.isPinned()).toBe(false);
  expect(() => item.withPinned(true)).toThrow(
    "Automatic context items cannot be pinned.",
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

test("unstaged changes detail matches LLM context text", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-unstaged-context-"));
  await git(root, ["init"]);
  await writeFile(join(root, "tracked.txt"), "before\n");
  await git(root, ["add", "tracked.txt"]);
  await writeFile(join(root, "tracked.txt"), "after\n");
  await writeFile(join(root, "untracked.txt"), "new file\n");

  const item = getUnstagedChangesItem();
  const detail = await item.getDetailView({ root });
  const summaryInput = await item.getSummarizationInput({ root });
  const formatted = await item.formatForLlm({
    focused: false,
    remainingFileCharacters: Number.POSITIVE_INFINITY,
    root,
  });

  expect(detail?.kind).toBe("diff");
  if (detail?.kind !== "diff") {
    throw new Error("Expected diff detail view.");
  }

  expect(detail.diffText).toBe(formatted.text);
  expect(summaryInput?.content).toBe(`Current changes\n\n${detail.diffText}`);
  expect(detail.diffText).toContain("+after");
  expect(detail.diffText).toContain("+new file");
});

test("unstaged changes detail shows the full large working tree diff", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-unstaged-context-"));
  await git(root, ["init"]);
  await writeFile(join(root, "large.txt"), repeatLines("before", 30_000));
  await git(root, ["add", "large.txt"]);
  await git(root, [
    "-c",
    "user.email=test@example.com",
    "-c",
    "user.name=Test",
    "commit",
    "-m",
    "initial",
  ]);
  await writeFile(join(root, "large.txt"), repeatLines("after", 30_000));

  const item = getUnstagedChangesItem();
  const detail = await item.getDetailView({ root });
  const summaryInput = await item.getSummarizationInput({ root });
  const formatted = await item.formatForLlm({
    focused: false,
    remainingFileCharacters: Number.POSITIVE_INFINITY,
    root,
  });

  expect(detail?.kind).toBe("diff");
  if (detail?.kind !== "diff") {
    throw new Error("Expected diff detail view.");
  }

  expect(detail.diffText).toContain("--- a/large.txt");
  expect(detail.diffText).toContain("after 29999");
  expect(detail.diffText).not.toContain("[Context truncated.]");
  expect(detail.diffText.length).toBeGreaterThan(formatted.text.length);
  expect(formatted.text).toContain("[Context truncated.]");
  expect(summaryInput?.content).toBe(`Current changes\n\n${formatted.text}`);
});

test("current changes detail shows the full large staged diff", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-unstaged-context-"));
  await git(root, ["init"]);
  await writeFile(join(root, "large-staged.txt"), repeatLines("staged", 30_000));
  await git(root, ["add", "large-staged.txt"]);

  const item = getUnstagedChangesItem();
  const detail = await item.getDetailView({ root });
  const summaryInput = await item.getSummarizationInput({ root });
  const formatted = await item.formatForLlm({
    focused: false,
    remainingFileCharacters: Number.POSITIVE_INFINITY,
    root,
  });

  expect(detail?.kind).toBe("diff");
  if (detail?.kind !== "diff") {
    throw new Error("Expected diff detail view.");
  }

  expect(detail.diffText).toContain("large-staged.txt");
  expect(detail.diffText).toContain("staged 29999");
  expect(detail.diffText).not.toContain("[Context truncated.]");
  expect(detail.diffText.length).toBeGreaterThan(formatted.text.length);
  expect(formatted.text).toContain("[Context truncated.]");
  expect(summaryInput?.content).toBe(`Current changes\n\n${formatted.text}`);
});

test("current changes LLM context marks byte-truncated multibyte diffs", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-unstaged-context-"));
  await git(root, ["init"]);
  await writeFile(join(root, "large-cjk.txt"), repeatLine("漢字漢字", 20_000));
  await git(root, ["add", "large-cjk.txt"]);

  const item = getUnstagedChangesItem();
  const detail = await item.getDetailView({ root });
  const summaryInput = await item.getSummarizationInput({ root });
  const formatted = await item.formatForLlm({
    focused: false,
    remainingFileCharacters: Number.POSITIVE_INFINITY,
    root,
  });

  expect(detail?.kind).toBe("diff");
  if (detail?.kind !== "diff") {
    throw new Error("Expected diff detail view.");
  }

  expect(detail.diffText).not.toContain("[Context truncated.]");
  expect(formatted.text).toContain("[Context truncated.]");
  expect(summaryInput?.content).toStartWith("Current changes\n\n");
  expect(summaryInput?.content).toContain("[Context truncated.]");
});

test("current changes LLM context keeps staged diff when untracked diff byte-truncates", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-unstaged-context-"));
  await git(root, ["init"]);
  await writeFile(join(root, "staged.txt"), "small staged marker\n");
  await git(root, ["add", "staged.txt"]);
  await writeFile(join(root, "large-untracked.txt"), repeatLine("漢字漢字", 20_000));

  const formatted = await getUnstagedChangesItem().formatForLlm({
    focused: false,
    remainingFileCharacters: Number.POSITIVE_INFINITY,
    root,
  });

  expect(formatted.text).toContain("small staged marker");
  expect(formatted.text).toContain("large-untracked.txt");
  expect(formatted.text).toContain("[Context truncated.]");
});

test("current changes LLM context keeps cached diff when unborn working tree diff byte-truncates", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-unstaged-context-"));
  await git(root, ["init"]);
  await writeFile(join(root, "small-staged.txt"), "small staged marker\n");
  await git(root, ["add", "small-staged.txt"]);
  await writeFile(join(root, "large.txt"), "staged large marker\n");
  await git(root, ["add", "large.txt"]);
  await writeFile(join(root, "large.txt"), repeatLine("漢字漢字", 20_000));

  const formatted = await getUnstagedChangesItem().formatForLlm({
    focused: false,
    remainingFileCharacters: Number.POSITIVE_INFINITY,
    root,
  });

  expect(formatted.text).toContain("small-staged.txt");
  expect(formatted.text).toContain("small staged marker");
  expect(formatted.text).toContain("large.txt");
  expect(formatted.text).toContain("[Context truncated.]");
});

test("current changes LLM context does not treat an oversized untracked path list as diff text", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-unstaged-context-"));
  await git(root, ["init"]);
  await writeFile(join(root, "staged.txt"), "small staged marker\n");
  await git(root, ["add", "staged.txt"]);
  for (let index = 0; index < 1_600; index += 1) {
    await writeFile(
      join(root, `rawpathmarker-${index}-${"x".repeat(180)}.txt`),
      "untracked\n",
    );
  }

  const formatted = await getUnstagedChangesItem().formatForLlm({
    focused: false,
    remainingFileCharacters: Number.POSITIVE_INFINITY,
    root,
  });

  expect(formatted.text).toContain("small staged marker");
  expect(formatted.text).toContain("[Context truncated.]");
  expect(formatted.text).not.toContain("rawpathmarker");
  expect(formatted.text).not.toContain("\0");
});

test("unstaged changes detail shows an empty state when the tree is clean", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-unstaged-context-"));
  await git(root, ["init"]);

  const detail = await getUnstagedChangesItem().getDetailView({ root });

  expect(detail).toEqual({
    content: "No current changes.",
    kind: "text",
    title: "Current changes",
  });
});

test("current changes detail is empty outside git repositories", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-unstaged-context-"));

  const item = getUnstagedChangesItem();
  const detail = await item.getDetailView({ root });
  const summaryInput = await item.getSummarizationInput({ root });
  const formatted = await item.formatForLlm({
    focused: false,
    remainingFileCharacters: Number.POSITIVE_INFINITY,
    root,
  });

  expect(detail).toEqual({
    content: "No current changes.",
    kind: "text",
    title: "Current changes",
  });
  expect(summaryInput).toBeNull();
  expect(formatted.text).toBe("");
});

test("current changes detail fails loudly for unexpected git errors", async () => {
  const root = join(
    await mkdtemp(join(tmpdir(), "clutch-unstaged-context-")),
    "missing",
  );

  await expect(
    getUnstagedChangesItem().getDetailView({ root }),
  ).rejects.toThrow();
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

function repeatLine(line: string, count: number): string {
  return Array.from({ length: count }, () => `${line}\n`).join("");
}
