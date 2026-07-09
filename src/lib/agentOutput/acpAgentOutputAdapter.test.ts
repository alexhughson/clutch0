import { expect, test } from "bun:test";
import type { ActiveSessionMessage } from "@agentclientprotocol/sdk";
import { createAcpAgentOutputFormatter } from "./acpAgentOutputAdapter";

test("streams ACP assistant chunks by message id and reconciles on stop", () => {
  const formatter = createAcpAgentOutputFormatter();
  formatter.beginPrompt();

  const updates = [
    ...formatter.format(sessionUpdate("agent_message_chunk", "msg-1", "hel")),
    ...formatter.format(sessionUpdate("agent_message_chunk", "msg-1", "lo")),
    ...formatter.format({
      kind: "stop",
      response: { stopReason: "end_turn" },
      stopReason: "end_turn",
    }),
  ];

  expect(updates).toMatchObject([
    {
      delta: "hel",
      id: "acp-message:msg-1",
      kind: "append-stream-delta",
      streamKind: "assistant",
    },
    {
      delta: "lo",
      id: "acp-message:msg-1",
      kind: "append-stream-delta",
      streamKind: "assistant",
    },
    {
      id: "acp-message:msg-1",
      kind: "reconcile-stream",
      streamKind: "assistant",
      text: "hello",
    },
    {
      block: { kind: "status", message: "agent stopped: end_turn" },
      kind: "append-block",
    },
  ]);
  expect(formatter.getLatestAssistantText()).toBe("hello");
});

test("beginPrompt clears previous assistant text before a silent follow-up", () => {
  const formatter = createAcpAgentOutputFormatter();
  formatter.beginPrompt();

  formatter.format(sessionUpdate("agent_message_chunk", "msg-1", "hello"));
  formatter.format({
    kind: "stop",
    response: { stopReason: "end_turn" },
    stopReason: "end_turn",
  });
  expect(formatter.getLatestAssistantText()).toBe("hello");

  formatter.beginPrompt();
  const updates = formatter.format({
    kind: "stop",
    response: {
      stopReason: "end_turn",
      usage: { inputTokens: 1, outputTokens: 0, totalTokens: 1 },
    },
    stopReason: "end_turn",
  });

  expect(formatter.getLatestAssistantText()).toBeNull();
  expect(updates).toEqual([
    expect.objectContaining({
      block: expect.objectContaining({
        kind: "status",
        message: "agent stopped: end_turn",
      }),
      kind: "append-block",
    }),
    expect.objectContaining({
      block: expect.objectContaining({
        kind: "status",
        message: "agent usage: input 1, output 0, total 1",
      }),
      kind: "append-block",
    }),
  ]);
  expect(updates.some((update) => update.kind === "reconcile-stream")).toBe(
    false,
  );
});

test("maps ACP thoughts, tools, plans, and usage into compact blocks", () => {
  const formatter = createAcpAgentOutputFormatter();
  formatter.beginPrompt();

  const updates = [
    ...formatter.format(
      sessionUpdate("agent_thought_chunk", "thought-1", "plan"),
    ),
    ...formatter.format({
      kind: "session_update",
      notification: {
        sessionId: "session-1",
        update: {
          kind: "search",
          sessionUpdate: "tool_call",
          status: "in_progress",
          title: "Search files",
          toolCallId: "tool-1",
        },
      },
      update: {
        kind: "search",
        sessionUpdate: "tool_call",
        status: "in_progress",
        title: "Search files",
        toolCallId: "tool-1",
      },
    }),
    ...formatter.format({
      kind: "session_update",
      notification: {
        sessionId: "session-1",
        update: {
          entries: [
            { content: "Read router", priority: "high", status: "in_progress" },
          ],
          sessionUpdate: "plan",
        },
      },
      update: {
        entries: [
          { content: "Read router", priority: "high", status: "in_progress" },
        ],
        sessionUpdate: "plan",
      },
    }),
    ...formatter.format({
      kind: "session_update",
      notification: {
        sessionId: "session-1",
        update: {
          sessionUpdate: "usage_update",
          size: 100,
          used: 25,
        },
      },
      update: {
        sessionUpdate: "usage_update",
        size: 100,
        used: 25,
      },
    }),
  ];

  expect(updates).toEqual([
    expect.objectContaining({
      delta: "plan",
      kind: "append-stream-delta",
      streamKind: "thinking",
    }),
    expect.objectContaining({
      block: expect.objectContaining({
        kind: "tool",
        phase: "start",
        summary: "Search files | in_progress",
        toolName: "search",
      }),
      kind: "append-block",
    }),
    expect.objectContaining({
      block: expect.objectContaining({
        kind: "status",
        message: "agent plan: Read router",
      }),
      kind: "append-block",
    }),
    expect.objectContaining({
      block: expect.objectContaining({
        kind: "status",
        message: "agent usage: 25/100 tokens",
      }),
      kind: "append-block",
    }),
  ]);
});

function sessionUpdate(
  sessionUpdate: "agent_message_chunk" | "agent_thought_chunk",
  messageId: string,
  text: string,
): ActiveSessionMessage {
  return {
    kind: "session_update",
    notification: {
      sessionId: "session-1",
      update: {
        content: { text, type: "text" },
        messageId,
        sessionUpdate,
      },
    },
    update: {
      content: { text, type: "text" },
      messageId,
      sessionUpdate,
    },
  };
}
