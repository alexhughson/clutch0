import { test, expect } from "bun:test";
import {
  LiveLlmResponseContextItem,
  PiAgentContextItem,
  createFileContextItem,
  createLiveLlmResponseContextItem,
  createMcpToolOutputContextItem,
  createPiAgentContextItem,
  createSavedAgentSandboxDiffContextItem,
  createSavedDiffContextItem,
  createSavedLlmResponseContextItem,
  createShellCommandOutputContextItem,
  createUserTextContextItem,
  restoreContextItem,
  serializeContextItem,
} from "./contextItems";

test("persistent context items own durable state and round-trip through restore", () => {
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
    createMcpToolOutputContextItem({
      createdAt: 3,
      id: "mcp:3",
      output: {
        arguments: { query: "clutch" },
        contentText: "result",
        isError: false,
        rawResult: { ok: true },
        serverName: "github",
        toolName: "search",
      },
      sourceRequestId: 3,
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
    const snapshot = serializeContextItem(item);
    expect(snapshot).not.toBeNull();
    const restored = restoreContextItem(snapshot);
    expect(restored.type).toBe(item.type);
    expect(restored.id).toBe(item.id);
    expect(restored.state).toEqual(item.state);
  }
});

test("item methods update durable state", () => {
  const item = createUserTextContextItem({
    createdAt: 1,
    id: "say:1",
    text: "before",
  }).withText("after");

  expect(item.text).toBe("after");
  expect(item.state.text).toBe("after");
  expect(item.state.summaryState).toEqual({ status: "missing" });
});

test("restore rejects unknown context item schema and type", () => {
  expect(() =>
    restoreContextItem({
      id: "x",
      schemaVersion: 99,
      summaryState: { status: "missing" },
      type: "user-text",
    }),
  ).toThrow("Unsupported context item schema version");

  expect(() =>
    restoreContextItem({
      id: "x",
      schemaVersion: 1,
      summaryState: { status: "missing" },
      type: "mystery",
    }),
  ).toThrow("Unknown context item type");
});

test("restore normalizes pending summary state to missing", () => {
  const restored = restoreContextItem({
    createdAt: 1,
    id: "say:1",
    schemaVersion: 1,
    summaryState: { sourceHash: "abc", status: "pending", workerId: "w" },
    text: "hello",
    type: "user-text",
  });

  expect(restored.getSummaryState()).toEqual({ status: "missing" });
});

test("MCP state normalizes unknown payloads into JSON-safe values", () => {
  const item = createMcpToolOutputContextItem({
    createdAt: 1,
    id: "mcp:1",
    output: {
      arguments: { query: "clutch" },
      contentText: "ok",
      isError: false,
      rawResult: 1n,
      serverName: "server",
      structuredContent: { value: 1n },
      toolName: "tool",
    },
    sourceRequestId: 1,
  });

  expect(() => JSON.stringify(item.state)).not.toThrow();
  expect(item.output.rawResult).toBe("1");
});

test("restored agent and live response states can be detached or errored", () => {
  const agent = createPiAgentContextItem({
    createdAt: 1,
    id: "agent:1",
    mode: "ask",
    prompt: "work",
  }).withSessionAvailability("detached");
  expect(agent).toBeInstanceOf(PiAgentContextItem);
  expect(agent.sessionAvailability).toBe("detached");

  const response = createLiveLlmResponseContextItem({
    createdAt: 1,
    id: "saved:1",
    prompt: "work",
    sourceRequestId: 1,
  }).withError("stopped");
  expect(response).toBeInstanceOf(LiveLlmResponseContextItem);
  expect(response.status).toBe("error");
});

test("context items emit semantic history events for state changes", () => {
  const text = createUserTextContextItem({
    createdAt: 1,
    id: "say:1",
    text: "before",
  });
  expect(text.withText("after").getHistoryEvents(text)).toEqual([
    expect.objectContaining({ kind: "user-text.edited" }),
  ]);

  const live = createLiveLlmResponseContextItem({
    createdAt: 1,
    id: "saved:1",
    prompt: "work",
    sourceRequestId: 1,
  });
  expect(live.withOutput("partial").getHistoryEvents(live)).toEqual([
    expect.objectContaining({ kind: "live-llm-response.output-updated" }),
  ]);
  expect(live.withError("boom").getHistoryEvents(live)).toEqual([
    expect.objectContaining({ kind: "live-llm-response.status-changed" }),
  ]);

  const agent = createPiAgentContextItem({
    createdAt: 1,
    id: "agent:1",
    mode: "edit",
    prompt: "work",
  });
  expect(
    agent
      .withAgentOutputUpdate({
        block: {
          id: "block:1",
          kind: "status",
          message: "started",
          timestamp: 1,
        },
        kind: "append-block",
      })
      .getHistoryEvents(agent),
  ).toEqual([expect.objectContaining({ kind: "pi-agent.output-updated" })]);
  const streamingAgent = agent.withAgentOutputUpdate({
    delta: "hello",
    id: "stream:1",
    kind: "append-stream-delta",
    streamKind: "assistant",
    timestamp: 1,
  });
  expect(
    streamingAgent
      .withAgentOutputUpdate({
        delta: " world",
        id: "stream:1",
        kind: "append-stream-delta",
        streamKind: "assistant",
        timestamp: 2,
      })
      .getHistoryEvents(streamingAgent),
  ).toEqual([expect.objectContaining({ kind: "pi-agent.output-updated" })]);
  expect(agent.withStatus("idle").getHistoryEvents(agent)).toEqual([
    expect.objectContaining({ kind: "pi-agent.status-changed" }),
  ]);
  expect(
    agent
      .withSandbox({
        baselineTree: "abc",
        diffStatus: "dirty",
        path: "/tmp/sandbox",
        root: "/repo",
      })
      .getHistoryEvents(agent),
  ).toEqual([expect.objectContaining({ kind: "pi-agent.sandbox-updated" })]);
});

test("diff and shell context items emit focused update events", () => {
  const file = createFileContextItem("src/index.tsx");
  expect(
    file
      .withSummaryState({
        sourceHash: "hash",
        status: "ready",
        summary: {
          details: "details",
          generatedAt: 1,
          oneLine: "summary",
          sourceHash: "hash",
        },
      })
      .getHistoryEvents(file),
  ).toEqual([expect.objectContaining({ kind: "file.summary-updated" })]);

  const response = createSavedLlmResponseContextItem({
    createdAt: 1,
    id: "saved:1",
    output: "before",
    prompt: "question",
    sourceRequestId: 1,
  });
  const nextResponse = createSavedLlmResponseContextItem({
    ...response.state,
    output: "after",
  });
  expect(nextResponse.getHistoryEvents(response)).toEqual([
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
    ...shell.state,
    result: { ...shell.result, stdout: "bye" },
  });
  expect(nextShell.getHistoryEvents(shell)).toEqual([
    expect.objectContaining({ kind: "shell-command-output.result-updated" }),
  ]);

  const mcp = createMcpToolOutputContextItem({
    createdAt: 1,
    id: "mcp:1",
    output: {
      arguments: {},
      contentText: "before",
      isError: false,
      rawResult: { ok: true },
      serverName: "server",
      toolName: "tool",
    },
    sourceRequestId: 1,
  });
  const nextMcp = createMcpToolOutputContextItem({
    ...mcp.state,
    output: { ...mcp.output, contentText: "after" },
  });
  expect(nextMcp.getHistoryEvents(mcp)).toEqual([
    expect.objectContaining({ kind: "mcp-tool-output.result-updated" }),
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
    ...diff.state,
    diffText: "diff --git a/a b/a\nchanged",
  });
  expect(nextDiff.getHistoryEvents(diff)).toEqual([
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
    ...agentDiff.state,
    summary: "after",
  });
  expect(nextAgentDiff.getHistoryEvents(agentDiff)).toEqual([
    expect.objectContaining({ kind: "agent-sandbox-diff.updated" }),
  ]);
});
