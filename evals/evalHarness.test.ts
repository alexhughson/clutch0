import { expect, test } from "bun:test";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  loadEvalCases,
  prepareEvalCase,
  renderEvalCasePromptMarkdown,
} from "./lib/evalCases";
import { joinTextUserMessages } from "../src/lib/llm/context";
import { writeEvalPatchArtifacts } from "./lib/evalArtifacts";
import { normalizeAssistantMessage, parseEvalModelSpec } from "./lib/liveEval";
import type { EvalCaseRunResult } from "./lib/liveEval";

const requiredCasePaths = [
  "classifier/add-files-request",
  "classifier/answer-selected-file",
  "classifier/answer-selected-saved-response",
  "classifier/ask-command-suppresses-tools",
  "classifier/cmd-command",
  "classifier/create-new-file",
  "classifier/do-not-patch-when-asking-plan",
  "classifier/edit-command-missing-context",
  "classifier/edit-command-with-file",
  "classifier/edit-request-needs-file-search",
  "classifier/explain-current-diff",
  "classifier/find-command",
  "classifier/find-debug-stacktrace",
  "classifier/find-incomplete-context",
  "classifier/find-missing-code-context",
  "classifier/find-truncated-context",
  "classifier/no-find-general-question",
  "classifier/no-shell-for-dangerous-or-vague",
  "classifier/plain-edit-with-file",
  "classifier/refactor-selected-file",
  "classifier/review-not-edit",
  "edit-hard/add-mode-through-config-and-tests",
  "edit-hard/agents-md-clarify-pi-ai-adapter",
  "edit-hard/agents-md-multiline-newtext",
  "edit-hard/create-helper-and-update-callers",
  "edit-hard/cross-file-rename",
  "edit-hard/duplicate-error-branch",
  "edit-hard/extract-predicate-three-files",
  "edit-hard/focused-file-over-decoy",
  "edit-hard/four-file-customer-rename",
  "edit-hard/long-repeated-validation-branch",
  "edit-hard/markdown-duplicate-heading",
  "edit-hard/markdown-selected-release-note",
  "edit-hard/markdown-table-row-update",
  "edit-hard/markdown-whitespace-oldtext",
  "edit-hard/nested-config-target",
  "edit-hard/order-sensitive-route-insertion",
  "edit-hard/partial-snapshot-update",
  "edit-hard/propagate-signature-change",
  "edit-hard/remove-case-and-clean-test",
  "edit-hard/remove-obsolete-branch-and-import",
  "edit-hard/repeated-oldtext-unique-context",
  "edit-hard/saved-diff-followup",
  "edit-hard/selected-file-over-same-symbol",
  "edit-hard/source-and-test-new-status",
  "edit-hard/three-label-coordinated-update",
  "edit-hard/two-identical-call-sites-focused",
  "edit-hard/type-and-test-propagation",
  "edit-limit/duplicate-feature-flag-branch",
  "edit-limit/duplicate-object-property",
  "edit-limit/duplicate-rate-limit-branch",
  "edit-limit/duplicate-return-payment-timeout",
  "edit-limit/duplicate-search-empty-branch",
  "edit-limit/duplicate-switch-label",
  "edit-limit/duplicate-throw-message",
  "edit-limit/duplicate-title-guard",
  "edit-limit/duplicate-triple-empty-branch",
  "edit-limit/duplicate-webhook-branch",
  "edit-limit/focused-address-fallback-decoy",
  "edit-limit/focused-badge-copy-decoy",
  "edit-limit/focused-code-decoy-second",
  "edit-limit/focused-code-same-object",
  "edit-limit/focused-count-label-decoy",
  "edit-limit/focused-currency-decoy",
  "edit-limit/focused-date-fallback-decoy",
  "edit-limit/focused-description-fallback-decoy",
  "edit-limit/focused-display-name-decoy",
  "edit-limit/focused-email-fallback-decoy",
  "edit-limit/focused-empty-array-decoy",
  "edit-limit/focused-file-implicit-same-function",
  "edit-limit/focused-format-price-decoy",
  "edit-limit/focused-list-empty-copy-decoy",
  "edit-limit/focused-markdown-implicit",
  "edit-limit/focused-note-fallback-decoy",
  "edit-limit/focused-notification-copy-decoy",
  "edit-limit/focused-permission-decoy",
  "edit-limit/focused-phone-fallback-decoy",
  "edit-limit/focused-role-default-decoy",
  "edit-limit/focused-route-builder-decoy",
  "edit-limit/focused-same-basename",
  "edit-limit/focused-sort-order-decoy",
  "edit-limit/focused-summary-limit-decoy",
  "edit-limit/focused-timeout-decoy",
  "edit-limit/focused-title-fallback-decoy",
  "edit-limit/focused-token-expiry-decoy",
  "edit-limit/focused-total-label-decoy",
  "edit-limit/focused-validator-decoy",
  "edit-limit/markdown-code-fence-production-only",
  "edit-limit/markdown-duplicate-checklist",
  "edit-limit/markdown-two-files-same-heading",
  "edit-limit/multi-file-source-propagation",
  "edit-limit/tsx-duplicate-button-label",
  "edit-limit/two-hunks-same-oldtext",
  "edit-limit/yaml-duplicate-environment",
  "edit/create-file-when-explicit",
  "edit/missing-context-no-hallucinated-patch",
  "edit/multi-hunk-single-file",
  "edit/no-unrequested-refactor",
  "edit/one-line-bugfix",
  "edit/preserve-style",
  "edit/reject-existing-file-empty-oldtext",
  "edit/use-focused-context",
  "edit/use-saved-diff-context",
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

test(
  "renders the AGENTS.md edit regression with oversized automatic context",
  async () => {
    const evalCase = (await loadEvalCases()).find(
      (candidate) =>
        candidate.path === "edit-hard/agents-md-clarify-pi-ai-adapter",
    );
    expect(evalCase).toBeDefined();

    const prepared = await prepareEvalCase(evalCase!);
    const automaticMessage = String(prepared.context.messages[0]?.content ?? "");
    const userMessages = joinTextUserMessages(prepared.context);

    expect(userMessages.length).toBeGreaterThan(250_000);
    expect(automaticMessage).toContain('<automatic_context name="current_diff">');
    expect(automaticMessage).toContain(
      '<automatic_context name="directory_tree">',
    );
    expect(automaticMessage).toContain("[Context truncated.]");
    expect(automaticMessage).toContain(
      "synthetic/project/packages/very-long-generated-eval-run-output-path-0000",
    );
    expect(userMessages).toContain('<file path="AGENTS.md" focused="true">');
    expect(prepared.context.tools?.map((tool) => tool.name)).toEqual([
      "apply_patch",
    ]);
    expect(evalCase!.expected.repeat).toEqual({ passThreshold: "all" });
  },
  15_000,
);

test("slash command cases restrict tools using Clutch slash command metadata", async () => {
  const cases = await loadEvalCases();
  const evalCase = cases.find(
    (candidate) => candidate.path === "classifier/ask-command-suppresses-tools",
  );
  expect(evalCase).toBeDefined();

  const prepared = await prepareEvalCase(evalCase!);

  expect(prepared.allowedToolNames).toEqual([]);
  expect(prepared.context.tools).toEqual([]);
  expect(prepared.context.systemPrompt).not.toContain("Workflow tools:");
  expect(prepared.context.systemPrompt).not.toContain("find_relevant_files");

  const editCase = cases.find(
    (candidate) => candidate.path === "classifier/edit-command-with-file",
  );
  expect(editCase).toBeDefined();

  const preparedEdit = await prepareEvalCase(editCase!);

  expect(preparedEdit.context.tools?.map((tool) => tool.name)).toEqual([
    "apply_patch",
  ]);
  expect(preparedEdit.context.systemPrompt).toContain("apply_patch");
  expect(preparedEdit.context.systemPrompt).not.toContain(
    "find_relevant_files",
  );
  expect(preparedEdit.context.systemPrompt).not.toContain("add_context_files");
  expect(preparedEdit.context.systemPrompt).not.toContain("create_file");
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
  } satisfies AssistantMessage;

  expect(normalizeAssistantMessage(message)).toMatchObject({
    classification: "find_relevant_files",
    toolCall: { name: "find_relevant_files" },
  });
});

test("parses direct eval model specs", () => {
  expect(parseEvalModelSpec("cerebras:gpt-oss-120b")).toEqual({
    label: "cerebras:gpt-oss-120b",
    modelId: "gpt-oss-120b",
    provider: "cerebras",
  });
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

function assistantMessageFixture(): AssistantMessage {
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
