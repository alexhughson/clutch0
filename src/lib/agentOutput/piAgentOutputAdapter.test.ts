import { expect, test } from "bun:test";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { applyAgentOutputUpdate } from "./agentOutputReducer";
import {
  createPiAgentOutputFormatter,
  formatPiAgentOutputUpdates,
  getLatestAssistantText,
} from "./piAgentOutputAdapter";
import type { AgentOutputBlock, AgentOutputUpdate } from "./agentOutputTypes";

test("extracts the latest assistant text from completed pi messages", () => {
  expect(
    getLatestAssistantText([
      { role: "user", content: "hello", timestamp: 1 },
      assistantMessage("first"),
      assistantMessage("final", " answer"),
    ]),
  ).toBe("final answer");
});

test("agent_end reconciles the displayed assistant stream before done status", () => {
  const updates = formatPiAgentOutputUpdates({
    messages: [assistantMessage("complete final answer")],
    type: "agent_end",
    willRetry: false,
  } as AgentSessionEvent);

  expect(updates).toHaveLength(2);
  expect(updates[0]).toMatchObject({
    kind: "reconcile-stream",
    streamKind: "assistant",
    text: "complete final answer",
  });
  expect(updates[1]).toMatchObject({
    block: { kind: "status", message: "pi: agent done" },
    kind: "append-block",
  });
});

test("message_end reconciles finalized assistant text that was not streamed as deltas", () => {
  const updates = formatPiAgentOutputUpdates({
    message: assistantMessage("partial answer with final sentence"),
    type: "message_end",
  } as AgentSessionEvent);

  expect(updates).toHaveLength(1);
  expect(updates[0]).toMatchObject({
    kind: "reconcile-stream",
    streamKind: "assistant",
    text: "partial answer with final sentence",
  });
});

test("pi event sequence stores full finalized assistant text from message_end", () => {
  const formatter = createPiAgentOutputFormatter();
  const events = [
    {
      message: assistantMessage(""),
      type: "message_start",
    },
    {
      assistantMessageEvent: {
        contentIndex: 0,
        delta: "partial ans",
        partial: assistantMessage("partial ans"),
        type: "text_delta",
      },
      message: assistantMessage("partial ans"),
      type: "message_update",
    },
    {
      message: assistantMessage("partial answer with final sentence"),
      type: "message_end",
    },
    {
      reason: "threshold",
      type: "compaction_start",
    },
  ] as AgentSessionEvent[];

  const blocks = events
    .flatMap((event) => formatter.format(event))
    .reduce(
      (currentBlocks, update) => applyAgentOutputUpdate(currentBlocks, update),
      [] as AgentOutputBlock[],
    );

  expect(blocks[0]).toMatchObject({
    kind: "stream",
    streamKind: "assistant",
    text: "partial answer with final sentence",
  });
});

test("pi event sequence preserves long finalized assistant text", () => {
  const finalText = `${"x".repeat(130_000)} final sentence`;
  const formatter = createPiAgentOutputFormatter();
  const events = [
    {
      assistantMessageEvent: {
        delta: finalText.slice(0, 100),
        type: "text_delta",
      },
      message: assistantMessage(finalText.slice(0, 100)),
      type: "message_update",
    },
    {
      message: assistantMessage(finalText),
      type: "message_end",
    },
  ] as AgentSessionEvent[];

  formatter.beginPrompt();
  const blocks = events
    .flatMap((event) => formatter.format(event))
    .reduce(
      (currentBlocks, update) => applyAgentOutputUpdate(currentBlocks, update),
      [] as AgentOutputBlock[],
    );

  expect(blocks[0]).toMatchObject({
    kind: "stream",
    streamKind: "assistant",
    text: finalText,
  });
});

test("final session messages repair a partial streamed assistant response", () => {
  const formatter = createPiAgentOutputFormatter();
  formatter.beginPrompt();

  const updates = [
    ...formatter.format({
      message: assistantMessage(""),
      type: "message_start",
    } as AgentSessionEvent),
    ...formatter.format({
      assistantMessageEvent: {
        contentIndex: 0,
        delta: "partial answer",
        partial: assistantMessage("partial answer"),
        type: "text_delta",
      },
      message: assistantMessage("partial answer"),
      type: "message_update",
    } as AgentSessionEvent),
    ...formatter.format({
      message: assistantMessage("partial answer"),
      type: "message_end",
    } as AgentSessionEvent),
    ...formatter.formatFinalMessages([
      assistantMessage("partial answer with FINAL_SENTINEL"),
    ]),
  ];

  const blocks = applyUpdates(updates);
  const assistantBlocks = assistantStreamBlocks(blocks);
  expect(assistantBlocks.map((block) => block.text)).toEqual([
    "partial answer with FINAL_SENTINEL",
  ]);
});

test("final session messages do not overwrite a previous answer with prefix text", () => {
  const formatter = createPiAgentOutputFormatter();
  formatter.beginPrompt();

  const firstPromptUpdates = [
    ...formatter.format({
      message: assistantMessage(""),
      type: "message_start",
    } as AgentSessionEvent),
    ...formatter.format({
      assistantMessageEvent: {
        contentIndex: 0,
        delta: "Hello",
        partial: assistantMessage("Hello"),
        type: "text_delta",
      },
      message: assistantMessage("Hello"),
      type: "message_update",
    } as AgentSessionEvent),
    ...formatter.format({
      message: assistantMessage("Hello"),
      type: "message_end",
    } as AgentSessionEvent),
  ];

  formatter.beginPrompt();
  const secondPromptUpdates = formatter.formatFinalMessages([
    assistantMessage("Hello with a new final answer"),
  ]);

  const assistantBlocks = assistantStreamBlocks(
    applyUpdates([...firstPromptUpdates, ...secondPromptUpdates]),
  );
  expect(assistantBlocks.map((block) => block.text)).toEqual([
    "Hello",
    "Hello with a new final answer",
  ]);
});

test("text_end reconciles finalized assistant text before compaction starts", () => {
  const formatter = createPiAgentOutputFormatter();
  const events = [
    {
      message: assistantMessage(""),
      type: "message_start",
    },
    {
      assistantMessageEvent: {
        contentIndex: 0,
        delta: "partial ans",
        partial: assistantMessage("partial ans"),
        type: "text_delta",
      },
      message: assistantMessage("partial ans"),
      type: "message_update",
    },
    {
      assistantMessageEvent: {
        content: "partial answer with final sentence",
        contentIndex: 0,
        partial: assistantMessage("partial answer with final sentence"),
        type: "text_end",
      },
      message: assistantMessage("partial answer with final sentence"),
      type: "message_update",
    },
    {
      reason: "threshold",
      type: "compaction_start",
    },
  ] as AgentSessionEvent[];

  const blocks = events
    .flatMap((event) => formatter.format(event))
    .reduce(
      (currentBlocks, update) => applyAgentOutputUpdate(currentBlocks, update),
      [] as AgentOutputBlock[],
    );

  expect(blocks[0]).toMatchObject({
    kind: "stream",
    streamKind: "assistant",
    text: "partial answer with final sentence",
  });
});

test("done event reconciles final assistant text when message_end is absent", () => {
  const formatter = createPiAgentOutputFormatter();
  const events = [
    {
      message: assistantMessage(""),
      type: "message_start",
    },
    {
      assistantMessageEvent: {
        contentIndex: 0,
        delta: "almost done",
        partial: assistantMessage("almost done"),
        type: "text_delta",
      },
      message: assistantMessage("almost done"),
      type: "message_update",
    },
    {
      assistantMessageEvent: {
        message: assistantMessage("almost done, with final words"),
        reason: "stop",
        type: "done",
      },
      message: assistantMessage("almost done, with final words"),
      type: "message_update",
    },
  ] as AgentSessionEvent[];

  const blocks = events
    .flatMap((event) => formatter.format(event))
    .reduce(
      (currentBlocks, update) => applyAgentOutputUpdate(currentBlocks, update),
      [] as AgentOutputBlock[],
    );

  expect(blocks[0]).toMatchObject({
    kind: "stream",
    streamKind: "assistant",
    text: "almost done, with final words",
  });
});

test("error event preserves partial assistant text", () => {
  const formatter = createPiAgentOutputFormatter();
  const events = [
    {
      message: assistantMessage(""),
      type: "message_start",
    },
    {
      assistantMessageEvent: {
        error: assistantMessage("partial answer before provider error"),
        reason: "error",
        type: "error",
      },
      message: assistantMessage("partial answer before provider error"),
      type: "message_update",
    },
  ] as AgentSessionEvent[];

  const blocks = events
    .flatMap((event) => formatter.format(event))
    .reduce(
      (currentBlocks, update) => applyAgentOutputUpdate(currentBlocks, update),
      [] as AgentOutputBlock[],
    );

  expect(blocks[0]).toMatchObject({
    kind: "stream",
    streamKind: "assistant",
    text: "partial answer before provider error",
  });
});

test("thinking_end reconciles completed thinking text", () => {
  const formatter = createPiAgentOutputFormatter();
  const events = [
    {
      message: assistantMessage(""),
      type: "message_start",
    },
    {
      assistantMessageEvent: {
        contentIndex: 0,
        delta: "part",
        partial: assistantMessage(""),
        type: "thinking_delta",
      },
      message: assistantMessage(""),
      type: "message_update",
    },
    {
      assistantMessageEvent: {
        content: "partial thinking",
        contentIndex: 0,
        partial: assistantMessage(""),
        type: "thinking_end",
      },
      message: assistantMessage(""),
      type: "message_update",
    },
  ] as AgentSessionEvent[];

  const blocks = events
    .flatMap((event) => formatter.format(event))
    .reduce(
      (currentBlocks, update) => applyAgentOutputUpdate(currentBlocks, update),
      [] as AgentOutputBlock[],
    );

  expect(blocks[0]).toMatchObject({
    kind: "stream",
    streamKind: "thinking",
    text: "partial thinking",
  });
});

test("assistant stream keeps one block when text deltas are interrupted by tool events", () => {
  const formatter = createPiAgentOutputFormatter();
  const events = [
    {
      message: assistantMessage(""),
      type: "message_start",
    },
    {
      assistantMessageEvent: {
        contentIndex: 0,
        delta: "prefix ",
        partial: assistantMessage("prefix "),
        type: "text_delta",
      },
      message: assistantMessage("prefix "),
      type: "message_update",
    },
    {
      args: { path: "src/index.ts" },
      toolCallId: "tool:1",
      toolName: "read",
      type: "tool_execution_start",
    },
    {
      assistantMessageEvent: {
        contentIndex: 2,
        delta: "suffix",
        partial: assistantMessage("prefix ", "suffix"),
        type: "text_delta",
      },
      message: assistantMessage("prefix ", "suffix"),
      type: "message_update",
    },
    {
      assistantMessageEvent: {
        content: "suffix",
        contentIndex: 2,
        partial: assistantMessage("prefix ", "suffix"),
        type: "text_end",
      },
      message: assistantMessage("prefix ", "suffix"),
      type: "message_update",
    },
  ] as AgentSessionEvent[];

  const blocks = events
    .flatMap((event) => formatter.format(event))
    .reduce(
      (currentBlocks, update) => applyAgentOutputUpdate(currentBlocks, update),
      [] as AgentOutputBlock[],
    );

  const assistantBlocks = blocks.filter(
    (
      block,
    ): block is Extract<AgentOutputBlock, { kind: "stream" }> =>
      block.kind === "stream" && block.streamKind === "assistant",
  );
  expect(assistantBlocks.map((block) => block.text)).toEqual([
    "prefix suffix",
  ]);
});

test("new assistant message does not replace older message with prefix text", () => {
  const formatter = createPiAgentOutputFormatter();
  const events = [
    {
      message: assistantMessage(""),
      type: "message_start",
    },
    {
      assistantMessageEvent: {
        contentIndex: 0,
        delta: "Hello",
        partial: assistantMessage("Hello"),
        type: "text_delta",
      },
      message: assistantMessage("Hello"),
      type: "message_update",
    },
    {
      message: assistantMessage("Hello"),
      type: "message_end",
    },
    {
      reason: "threshold",
      type: "compaction_start",
    },
    {
      aborted: false,
      reason: "threshold",
      result: undefined,
      type: "compaction_end",
      willRetry: false,
    },
    {
      message: assistantMessage(""),
      type: "message_start",
    },
    {
      message: assistantMessage("Hello with a new final answer"),
      type: "message_end",
    },
  ] as AgentSessionEvent[];

  const blocks = events
    .flatMap((event) => formatter.format(event))
    .reduce(
      (currentBlocks, update) => applyAgentOutputUpdate(currentBlocks, update),
      [] as AgentOutputBlock[],
    );

  const assistantBlocks = blocks.filter(
    (
      block,
    ): block is Extract<AgentOutputBlock, { kind: "stream" }> =>
      block.kind === "stream" && block.streamKind === "assistant",
  );
  expect(assistantBlocks.map((block) => block.text)).toEqual([
    "Hello",
    "Hello with a new final answer",
  ]);
});

test("retrying agent_end does not reconcile an intermediate assistant message", () => {
  const updates = formatPiAgentOutputUpdates({
    messages: [assistantMessage("will retry")],
    type: "agent_end",
    willRetry: true,
  } as AgentSessionEvent);

  expect(updates).toHaveLength(1);
  expect(updates[0]).toMatchObject({
    block: { kind: "status", message: "pi: agent ended; retrying" },
    kind: "append-block",
  });
});

function applyUpdates(updates: readonly AgentOutputUpdate[]): AgentOutputBlock[] {
  return updates.reduce(
    (currentBlocks, update) => applyAgentOutputUpdate(currentBlocks, update),
    [] as AgentOutputBlock[],
  );
}

function assistantStreamBlocks(
  blocks: readonly AgentOutputBlock[],
): Extract<AgentOutputBlock, { kind: "stream" }>[] {
  return blocks.filter(
    (
      block,
    ): block is Extract<AgentOutputBlock, { kind: "stream" }> =>
      block.kind === "stream" && block.streamKind === "assistant",
  );
}

function assistantMessage(...texts: string[]): AssistantMessage {
  return {
    api: "openai-completions",
    content: texts.map((text) => ({ text, type: "text" as const })),
    model: "test-model",
    provider: "openai",
    role: "assistant" as const,
    stopReason: "stop",
    timestamp: 1,
    usage: {
      cacheRead: 0,
      cacheWrite: 0,
      cost: {
        cacheRead: 0,
        cacheWrite: 0,
        input: 0,
        output: 0,
        total: 0,
      },
      input: 0,
      output: 0,
      totalTokens: 0,
    },
  };
}
