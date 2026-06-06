import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, test } from "bun:test";
import {
  createFileContextItem,
  createSavedDiffContextItem,
  createSavedLlmResponseContextItem,
  createUserTextContextItem,
  PiAgentContextItem,
} from "../context/contextItems";
import { buildLlmContext, MAX_FILE_CONTEXT_CHARACTERS } from "./context";

test("builds LLM context from selected file contents on disk", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-llm-context-"));
  await writeFile(join(root, "example.ts"), "export const answer = 42;\n");

  const { context, files } = await buildLlmContext({
    question: "What is the answer?",
    root,
    contextItems: [createFileContextItem("example.ts")],
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

test("marks focused context item for the LLM", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-llm-context-"));
  await writeFile(join(root, "example.ts"), "export const answer = 42;\n");
  const item = createFileContextItem("example.ts");

  const { context } = await buildLlmContext({
    contextItems: [item],
    focusedContextItemId: item.id,
    question: "Focus here",
    root,
  });

  expect(getUserContent(context)).toContain(
    "Focused context item:\n@example.ts",
  );
  expect(getUserContent(context)).toContain(
    '<file path="example.ts" focused="true">',
  );
});

test("adds directory automatic context without making it selected context", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-llm-context-"));
  await writeFile(join(root, "AGENTS.md"), "Follow the project rules.\n");
  await writeFile(join(root, "example.ts"), "export {};\n");

  const { context } = await buildLlmContext({
    contextItems: [],
    question: "What rules apply?",
    root,
  });

  expect(getUserContent(context)).toContain("No selected context items.");
  expect(getUserContent(context)).not.toContain(
    '<automatic_context name="AGENTS.md">',
  );
  expect(getUserContent(context)).toContain(
    '<automatic_context name="directory_tree">',
  );
  expect(getUserContent(context)).toContain("example.ts");
});

test("includes AGENTS.md through normal selected file context", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-llm-context-"));
  await writeFile(join(root, "AGENTS.md"), "Follow the project rules.\n");

  const { context } = await buildLlmContext({
    contextItems: [createFileContextItem("AGENTS.md")],
    question: "What rules apply?",
    root,
  });

  expect(getUserContent(context)).toContain('<file path="AGENTS.md">');
  expect(getUserContent(context)).toContain("Follow the project rules.");
});

test("builds LLM context from saved responses and diffs", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-llm-context-"));

  const { context } = await buildLlmContext({
    contextItems: [
      createSavedLlmResponseContextItem({
        createdAt: 1_700_000_000_000,
        id: "saved:1",
        output: "The answer is 42.",
        prompt: "What is the answer?",
        sourceRequestId: 1,
      }),
      createSavedDiffContextItem({
        createdAt: 1_700_000_000_001,
        diffText: "--- a/example.ts\n+++ b/example.ts",
        id: "saved:2",
        prompt: "Change the answer",
        proposal: { summary: "Update answer", edits: [] },
        sourceRequestId: 2,
        summary: "Update answer",
      }),
    ],
    question: "Use prior work",
    root,
  });

  expect(getUserContent(context)).toContain("<llm_response");
  expect(getUserContent(context)).toContain("The answer is 42.");
  expect(getUserContent(context)).toContain("<saved_diff");
  expect(getUserContent(context)).toContain("Update answer");
});

test("builds LLM context from user text context items", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-llm-context-"));
  const item = createUserTextContextItem({
    createdAt: 1_700_000_000_000,
    id: "say:1",
    text: "Remember to preserve the narrow layout.",
  });

  const { context } = await buildLlmContext({
    contextItems: [item],
    focusedContextItemId: item.id,
    question: "Use note",
    root,
  });

  expect(getUserContent(context)).toContain(
    "Focused context item:\nUser text:",
  );
  expect(getUserContent(context)).toContain("<user_text");
  expect(getUserContent(context)).toContain('focused="true"');
  expect(getUserContent(context)).toContain(
    "Remember to preserve the narrow layout.",
  );
});

test("agent session context includes only the latest assistant message", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-llm-context-"));
  const { context } = await buildLlmContext({
    contextItems: [
      new PiAgentContextItem(
        "agent:1",
        "Investigate routing",
        [
          {
            id: "status:1",
            kind: "status",
            message: "pi: thinking",
            timestamp: 1,
          },
          {
            id: "stream:1",
            kind: "stream",
            streamKind: "assistant",
            text: "First answer.",
            timestamp: 2,
          },
          {
            id: "tool:1",
            kind: "tool",
            phase: "start",
            summary: "read src/index.ts",
            timestamp: 3,
            toolName: "read",
          },
          {
            id: "stream:2",
            kind: "stream",
            streamKind: "thinking",
            text: "Private reasoning",
            timestamp: 4,
          },
          {
            id: "stream:3",
            kind: "stream",
            streamKind: "assistant",
            text: "Latest answer.",
            timestamp: 5,
          },
        ],
        "idle",
        1_700_000_000_000,
      ),
    ],
    question: "Use agent context",
    root,
  });

  const userContent = getUserContent(context);
  expect(userContent).toContain("<prompt>\nInvestigate routing\n</prompt>");
  expect(userContent).toContain(
    "<latest_agent_message>\nLatest answer.\n</latest_agent_message>",
  );
  expect(userContent).not.toContain("First answer.");
  expect(userContent).not.toContain("Private reasoning");
  expect(userContent).not.toContain("read src/index.ts");
  expect(userContent).not.toContain("pi: thinking");
});

test("skips paths outside the root", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-llm-context-"));

  const { files } = await buildLlmContext({
    question: "Can you read this?",
    root,
    contextItems: [createFileContextItem("../secret.txt")],
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
    contextItems: [createFileContextItem("large.txt")],
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
