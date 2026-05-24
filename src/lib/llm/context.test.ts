import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "bun:test";
import { buildLlmContext, MAX_FILE_CONTEXT_CHARACTERS } from "./context";

test("builds LLM context from selected file contents on disk", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-llm-context-"));
  await writeFile(join(root, "example.ts"), "export const answer = 42;\n");

  const { context, files } = await buildLlmContext({
    question: "What is the answer?",
    root,
    selectedFilePaths: ["example.ts"],
  });

  expect(files).toEqual([
    {
      filePath: "example.ts",
      content: "export const answer = 42;\n",
      status: "included",
      truncated: false,
    },
  ]);
  expect(getUserContent(context)).toContain("What is the answer?");
  expect(getUserContent(context)).toContain('<file path="example.ts">');
  expect(getUserContent(context)).toContain("export const answer = 42;");
});

test("skips paths outside the root", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-llm-context-"));

  const { files } = await buildLlmContext({
    question: "Can you read this?",
    root,
    selectedFilePaths: ["../secret.txt"],
  });

  expect(files[0]).toMatchObject({
    filePath: "../secret.txt",
    status: "skipped",
    truncated: false,
  });
  expect(files[0]?.errorMessage).toContain("outside the working directory");
});

test("truncates large selected files", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-llm-context-"));
  const largeContent = "a".repeat(MAX_FILE_CONTEXT_CHARACTERS + 5);
  await writeFile(join(root, "large.txt"), largeContent);

  const { context, files } = await buildLlmContext({
    question: "Summarize this",
    root,
    selectedFilePaths: ["large.txt"],
  });

  expect(files[0]).toMatchObject({
    filePath: "large.txt",
    status: "included",
    truncated: true,
  });
  expect(files[0]?.content).toHaveLength(MAX_FILE_CONTEXT_CHARACTERS);
  expect(getUserContent(context)).toContain("File truncated");
});

function getUserContent(
  context: Awaited<ReturnType<typeof buildLlmContext>>["context"],
): string {
  const content = context.messages[0]?.content;
  if (typeof content !== "string") {
    throw new Error("Expected string user content");
  }

  return content;
}
