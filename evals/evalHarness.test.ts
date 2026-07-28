import { expect, test } from "bun:test";
import type { LlmAssistantMessage } from "../src/lib/llm/types";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadEvalCases,
  prepareEvalCase,
  renderEvalCasePromptMarkdown,
} from "./lib/evalCases";
import { writeEvalPatchArtifacts } from "./lib/evalArtifacts";
import { normalizeAssistantMessage, parseEvalModelSpec } from "./lib/liveEval";
import type { EvalCaseRunResult } from "./lib/liveEval";

const requiredCasePaths = [
  "classifier/add-files-request",
  "classifier/cmd-command",
  "classifier/create-new-file",
  "classifier/do-not-patch-when-asking-plan",
  "classifier/edit-request-needs-file-search",
  "classifier/plain-edit-with-file",
  "edit/create-file-when-explicit",
  "edit/cross-file-rename",
  "edit/missing-context-no-hallucinated-patch",
  "edit/multi-hunk-single-file",
  "edit/one-line-bugfix",
  "edit/reject-existing-file-empty-oldtext",
];

test("loads the required eval case suite", async () => {
  const cases = await loadEvalCases();

  expect(cases.map((evalCase) => evalCase.path)).toEqual(requiredCasePaths);
});

test("renders prompts through real Clutch context and tools", async () => {
  const evalCase = (await loadEvalCases()).find(
    (candidate) => candidate.path === "classifier/plain-edit-with-file",
  );
  expect(evalCase).toBeDefined();

  const prepared = await prepareEvalCase(evalCase!);
  const prompt = renderEvalCasePromptMarkdown(prepared);

  expect(prompt).toContain("<file");
  expect(prompt).toContain("src/count.ts");
  expect(prompt).toContain("apply_patch");
  expect(prompt).toContain("<user_request>");
});

test("slash command cases restrict tools using Clutch slash command metadata", async () => {
  const evalCase = (await loadEvalCases()).find(
    (candidate) => candidate.path === "classifier/cmd-command",
  );
  expect(evalCase).toBeDefined();

  const prepared = await prepareEvalCase(evalCase!);

  expect(prepared.allowedToolNames).toEqual(["run_shell_command"]);
  expect(prepared.context.tools?.map((tool) => tool.name)).toEqual([
    "run_shell_command",
  ]);
  expect(prepared.context.systemPrompt).not.toContain("apply_patch");
  expect(prepared.context.systemPrompt).not.toContain("find_relevant_files");
});

test("normalizes assistant messages into classifier results", () => {
  const message = {
    api: "openai-responses",
    content: [
      {
        arguments: { goal: "Find parser" },
        id: "tool-1",
        name: "find_relevant_files",
        type: "toolCall",
      },
    ],
    model: "model",
    provider: "provider",
    role: "assistant",
    stopReason: "toolUse",
    timestamp: 1,
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 0,
      output: 0,
      totalTokens: 0,
    },
  } satisfies LlmAssistantMessage;

  expect(normalizeAssistantMessage(message)).toMatchObject({
    classification: "find_relevant_files",
    toolCall: { name: "find_relevant_files" },
  });
});

test("parses direct eval model specs", () => {
  expect(parseEvalModelSpec("openrouter:anthropic/claude-sonnet-4")).toEqual({
    label: "openrouter:anthropic/claude-sonnet-4",
    modelId: "anthropic/claude-sonnet-4",
    provider: "openrouter",
  });
  expect(() => parseEvalModelSpec("cerebras:gpt-oss-120b")).toThrow(
    "Unsupported eval model provider",
  );
  expect(() => parseEvalModelSpec("missing")).toThrow("provider:model");
});

test("writes Clutch validator-generated diffs as eval artifacts", async () => {
  const runDir = await mkdtemp(join(tmpdir(), "clutch-eval-artifacts-"));
  const diffText =
    "Index: src/example.ts\n===================================================================\n--- src/example.ts\n+++ src/example.ts\n@@ -1 +1 @@\n-old\n+new";
  const result = await writeEvalPatchArtifacts({
    runDir,
    result: {
      attempts: [
        {
          assistantText: "",
          casePath: "edit/example",
          classification: "propose_patch",
          failures: [],
          passed: true,
          patchValidation: {
            diffText,
            proposal: {
              patch:
                "*** Begin Patch\n*** Update File: src/example.ts\n@@\n-old\n+new\n*** End Patch",
              summary: "Update example",
            },
            status: "valid",
          },
          rawAssistantMessage: assistantMessageFixture(),
          target: "test:model",
          toolCalls: [],
        },
      ],
      casePath: "edit/example",
      passed: true,
      target: "test:model",
    } satisfies EvalCaseRunResult,
  });

  const generatedDiffPath = result.attempts[0]?.generatedDiffPath;
  expect(generatedDiffPath).toBeDefined();
  expect(await readFile(join(runDir, generatedDiffPath!), "utf8")).toBe(
    `${diffText}\n`,
  );
});

function assistantMessageFixture(): LlmAssistantMessage {
  return {
    api: "openai-responses",
    content: [],
    model: "model",
    provider: "provider",
    role: "assistant",
    stopReason: "stop",
    timestamp: 1,
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0, total: 0 },
      input: 0,
      output: 0,
      totalTokens: 0,
    },
  };
}
