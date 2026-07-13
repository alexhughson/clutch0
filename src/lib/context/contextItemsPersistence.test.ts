import { test, expect } from "bun:test";
import { applyAgentOutputUpdate } from "../agentOutput/agentOutputReducer";
import {
  createFileContextItem,
  createLiveLlmResponseContextItem,
  createPiAgentContextItem,
  createSavedAgentSandboxDiffContextItem,
  createSavedDiffContextItem,
  createSavedLlmResponseContextItem,
  createShellCommandOutputContextItem,
  createUserTextContextItem,
} from "./contextItemFactories";
import { getContextItemHistoryEvents } from "./contextItemRegistry";
import { MISSING_SUMMARY_STATE } from "./contextItemTypes";
import {
  CONTEXT_RECORDS_V1_SNAPSHOT,
  LEGACY_DIFF_V1_RECORD,
} from "../session/contextRecordsV1.fixture";
import {
  decodeContextItemV1,
  encodeContextItemV1,
} from "./contextItemPersistence";

test("factory-built persistent items round-trip through encode and decode", () => {
  const items = [
    createFileContextItem("src/index.tsx"),
    createSavedLlmResponseContextItem({
      createdAt: 1,
      id: "saved:1",
      output: "answer",
      prompt: "question",
      sourceRequestId: 1,
    }),
    createShellCommandOutputContextItem({
      createdAt: 2,
      id: "shell:2",
      result: {
        command: "printf hi",
        durationMs: 1,
        exitCode: 0,
        stderr: "",
        stdout: "hi",
        timedOut: false,
        truncated: false,
      },
      sourceRequestId: 2,
    }),
    createUserTextContextItem({
      createdAt: 4,
      id: "say:4",
      text: "remember",
    }),
    createLiveLlmResponseContextItem({
      createdAt: 5,
      id: "saved:5",
      output: "partial",
      prompt: "prompt",
      sourceRequestId: 5,
    }),
    createPiAgentContextItem({
      createdAt: 6,
      id: "agent:6",
      mode: "edit",
      prompt: "fix it",
    }),
    createSavedDiffContextItem({
      createdAt: 7,
      diffText: "diff --git a/a b/a",
      id: "diff:7",
      prompt: "patch",
      proposal: {
        patch:
          "*** Begin Patch\n*** Update File: a\n@@\n-old\n+new\n*** End Patch",
        summary: "patch",
      },
      sourceRequestId: 7,
      summary: "patch",
    }),
    createSavedAgentSandboxDiffContextItem({
      createdAt: 8,
      diffText: "diff --git a/a b/a",
      id: "agent-diff:8",
      prompt: "agent patch",
      sourceAgentItemId: "agent:6",
      summary: "agent patch",
    }),
  ];

  for (const item of items) {
    const encoded = encodeContextItemV1(item);
    const restored = decodeContextItemV1(encoded);
    expect(decodeContextItemV1(encodeContextItemV1(restored))).toEqual(encoded);
    expect(restored).toEqual(item);
  }
});

test("literal v1 records decode and encode all persistent variants", () => {
  const items = [
    ...CONTEXT_RECORDS_V1_SNAPSHOT.workspace.contextItems,
    ...CONTEXT_RECORDS_V1_SNAPSHOT.activeTask.request.contextItems,
  ];

  for (const item of items) {
    const decoded = decodeContextItemV1(item);
    expect(encodeContextItemV1(decoded)).toEqual(item);
  }
});

test("restore rejects unknown context item schema and type", () => {
  expect(() =>
    decodeContextItemV1({
      id: "x",
      schemaVersion: 99,
      summaryState: { status: "missing" },
      type: "user-text",
    }),
  ).toThrow("Unsupported context item schema version");

  expect(() =>
    decodeContextItemV1({
      id: "x",
      schemaVersion: 1,
      summaryState: { status: "missing" },
      type: "mystery",
    }),
  ).toThrow("Unknown context item type");
});

test("restore normalizes pending summary state to missing", () => {
  const restored = decodeContextItemV1({
    createdAt: 1,
    id: "say:1",
    schemaVersion: 1,
    summaryState: { sourceHash: "abc", status: "pending", workerId: "w" },
    text: "hello",
    type: "user-text",
  });

  expect(restored.summaryState).toEqual({ status: "missing" });
});

test("literal legacy diff edits decode and pending summaries restart", () => {
  const decoded = decodeContextItemV1(LEGACY_DIFF_V1_RECORD);
  expect(decoded.type).toBe("diff");
  if (decoded.type !== "diff") {
    throw new Error("Expected decoded diff.");
  }

  expect(decoded.proposal.patch).toContain("*** Update File: src/legacy.ts");
  expect(decoded.summaryState).toEqual({ status: "missing" });
});

test("legacy diff encodes to modern patch form on first save after resume", () => {
  const decoded = decodeContextItemV1(LEGACY_DIFF_V1_RECORD);
  expect(decoded.type).toBe("diff");

  const encoded = encodeContextItemV1(decoded);
  expect(encoded.type).toBe("diff");
  if (encoded.type !== "diff") {
    throw new Error("Expected encoded diff.");
  }

  expect("edits" in encoded.proposal).toBe(false);
  expect(encoded.proposal).toEqual({
    patch: expect.stringContaining("*** Update File: src/legacy.ts"),
    summary: "Legacy update",
  });
});

test("summary-only transitions emit exactly summary-updated events", () => {
  const readySummary = {
    sourceHash: "hash",
    status: "ready" as const,
    summary: {
      details: "details",
      generatedAt: 1,
      oneLine: "summary",
      sourceHash: "hash",
    },
  };

  const text = createUserTextContextItem({
    createdAt: 1,
    id: "say:1",
    text: "hello",
  });
  const textEvents = getContextItemHistoryEvents(
    { ...text, summaryState: readySummary },
    text,
  );
  expect(textEvents).toEqual([
    expect.objectContaining({ kind: "user-text.summary-updated" }),
  ]);
  expect(textEvents).toHaveLength(1);

  const response = createSavedLlmResponseContextItem({
    createdAt: 1,
    id: "saved:1",
    output: "answer",
    prompt: "question",
    sourceRequestId: 1,
  });
  const responseEvents = getContextItemHistoryEvents(
    { ...response, summaryState: readySummary },
    response,
  );
  expect(responseEvents).toEqual([
    expect.objectContaining({ kind: "llm-response.summary-updated" }),
  ]);
  expect(responseEvents).toHaveLength(1);
});

test("context items emit semantic history events for state changes", () => {
  const text = createUserTextContextItem({
    createdAt: 1,
    id: "say:1",
    text: "before",
  });
  const nextText = {
    ...text,
    summaryState: MISSING_SUMMARY_STATE,
    text: "after",
  };
  expect(getContextItemHistoryEvents(nextText, text)).toEqual([
    expect.objectContaining({ kind: "user-text.edited" }),
  ]);

  const live = createLiveLlmResponseContextItem({
    createdAt: 1,
    id: "saved:1",
    prompt: "work",
    sourceRequestId: 1,
  });
  expect(
    getContextItemHistoryEvents({ ...live, output: "partial" }, live),
  ).toEqual([
    expect.objectContaining({ kind: "live-llm-response.output-updated" }),
  ]);
  expect(
    getContextItemHistoryEvents(
      { ...live, errorMessage: "boom", status: "error" },
      live,
    ),
  ).toEqual([
    expect.objectContaining({ kind: "live-llm-response.status-changed" }),
  ]);

  const agent = createPiAgentContextItem({
    createdAt: 1,
    id: "agent:1",
    mode: "edit",
    prompt: "work",
  });
  expect(
    getContextItemHistoryEvents(
      {
        ...agent,
        blocks: applyAgentOutputUpdate(agent.blocks, {
          block: {
            id: "block:1",
            kind: "status",
            message: "started",
            timestamp: 1,
          },
          kind: "append-block",
        }),
      },
      agent,
    ),
  ).toEqual([expect.objectContaining({ kind: "pi-agent.output-updated" })]);
  const streamingAgent = {
    ...agent,
    blocks: applyAgentOutputUpdate(agent.blocks, {
      delta: "hello",
      id: "stream:1",
      kind: "append-stream-delta",
      streamKind: "assistant",
      timestamp: 1,
    }),
  };
  expect(
    getContextItemHistoryEvents(
      {
        ...streamingAgent,
        blocks: applyAgentOutputUpdate(streamingAgent.blocks, {
          delta: " world",
          id: "stream:1",
          kind: "append-stream-delta",
          streamKind: "assistant",
          timestamp: 2,
        }),
      },
      streamingAgent,
    ),
  ).toEqual([expect.objectContaining({ kind: "pi-agent.output-updated" })]);
  expect(
    getContextItemHistoryEvents({ ...agent, status: "idle" }, agent),
  ).toEqual([expect.objectContaining({ kind: "pi-agent.status-changed" })]);
  expect(
    getContextItemHistoryEvents(
      {
        ...agent,
        sandbox: {
          baselineTree: "abc",
          diffStatus: "dirty",
          path: "/tmp/sandbox",
          root: "/repo",
        },
      },
      agent,
    ),
  ).toEqual([expect.objectContaining({ kind: "pi-agent.sandbox-updated" })]);
});

test("diff and shell context items emit focused update events", () => {
  const file = createFileContextItem("src/index.tsx");
  expect(
    getContextItemHistoryEvents(
      {
        ...file,
        summaryState: {
          sourceHash: "hash",
          status: "ready",
          summary: {
            details: "details",
            generatedAt: 1,
            oneLine: "summary",
            sourceHash: "hash",
          },
        },
      },
      file,
    ),
  ).toEqual([expect.objectContaining({ kind: "file.summary-updated" })]);

  const response = createSavedLlmResponseContextItem({
    createdAt: 1,
    id: "saved:1",
    output: "before",
    prompt: "question",
    sourceRequestId: 1,
  });
  const nextResponse = createSavedLlmResponseContextItem({
    ...response,
    output: "after",
  });
  expect(getContextItemHistoryEvents(nextResponse, response)).toEqual([
    expect.objectContaining({ kind: "llm-response.output-updated" }),
  ]);

  const shell = createShellCommandOutputContextItem({
    createdAt: 1,
    id: "shell:1",
    result: {
      command: "printf hi",
      durationMs: 1,
      exitCode: 0,
      stderr: "",
      stdout: "hi",
      timedOut: false,
      truncated: false,
    },
    sourceRequestId: 1,
  });
  const nextShell = createShellCommandOutputContextItem({
    ...shell,
    result: { ...shell.result, stdout: "bye" },
  });
  expect(getContextItemHistoryEvents(nextShell, shell)).toEqual([
    expect.objectContaining({ kind: "shell-command-output.result-updated" }),
  ]);

  const diff = createSavedDiffContextItem({
    createdAt: 1,
    diffText: "diff --git a/a b/a",
    id: "diff:1",
    prompt: "patch",
    proposal: {
      patch:
        "*** Begin Patch\n*** Update File: a\n@@\n-old\n+new\n*** End Patch",
      summary: "patch",
    },
    sourceRequestId: 1,
    summary: "patch",
  });
  const nextDiff = createSavedDiffContextItem({
    ...diff,
    diffText: "diff --git a/a b/a\nchanged",
  });
  expect(getContextItemHistoryEvents(nextDiff, diff)).toEqual([
    expect.objectContaining({ kind: "saved-diff.updated" }),
  ]);

  const agentDiff = createSavedAgentSandboxDiffContextItem({
    createdAt: 1,
    diffText: "diff --git a/a b/a",
    id: "agent-diff:1",
    prompt: "patch",
    sourceAgentItemId: "agent:1",
    summary: "before",
  });
  const nextAgentDiff = createSavedAgentSandboxDiffContextItem({
    ...agentDiff,
    summary: "after",
  });
  expect(getContextItemHistoryEvents(nextAgentDiff, agentDiff)).toEqual([
    expect.objectContaining({ kind: "agent-sandbox-diff.updated" }),
  ]);
});
