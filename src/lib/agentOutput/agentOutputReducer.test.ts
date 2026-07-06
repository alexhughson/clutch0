import { expect, test } from "bun:test";
import { applyAgentOutputUpdate } from "./agentOutputReducer";
import type { AgentOutputBlock, AgentOutputUpdate } from "./agentOutputTypes";

test("coalesces thinking deltas into one stream block", () => {
  const blocks = applyAgentOutputUpdate(
    applyAgentOutputUpdate([], delta("thinking", "Searching")),
    delta("thinking", " files"),
  );

  expect(blocks).toHaveLength(1);
  expect(blocks[0]).toMatchObject({
    kind: "stream",
    streamKind: "thinking",
    text: "Searching files",
  });
});

test("separates assistant and thinking stream blocks", () => {
  const blocks = [
    delta("thinking", "thinking"),
    delta("assistant", "answer"),
  ].reduce(
    (currentBlocks, update) => applyAgentOutputUpdate(currentBlocks, update),
    [] as AgentOutputBlock[],
  );

  expect(blocks).toHaveLength(2);
  expect(
    blocks.map((block) => block.kind === "stream" && block.streamKind),
  ).toEqual(["thinking", "assistant"]);
});

test("tool blocks interrupt stream coalescing", () => {
  const blocks = [
    delta("thinking", "before", "thinking:before"),
    block({
      id: "tool",
      kind: "tool",
      phase: "start",
      summary: "grep",
      timestamp: 1,
      toolName: "grep",
    }),
    delta("thinking", "after", "thinking:after"),
  ].reduce(
    (currentBlocks, update) => applyAgentOutputUpdate(currentBlocks, update),
    [] as AgentOutputBlock[],
  );

  expect(blocks).toHaveLength(3);
  expect(blocks[0]).toMatchObject({ kind: "stream", text: "before" });
  expect(blocks[2]).toMatchObject({ kind: "stream", text: "after" });
});

test("ignores whitespace deltas that would create a new stream block", () => {
  const blocks = applyAgentOutputUpdate([], delta("thinking", " "));
  expect(blocks).toEqual([]);
});

test("caps blocks and stream text", () => {
  const cappedText = applyAgentOutputUpdate([], delta("thinking", "abcdef"), {
    maxStreamCharacters: 4,
  });
  expect(cappedText[0]).toMatchObject({ text: "abc…", truncated: true });

  const cappedBlocks = [
    block(status("one")),
    block(status("two")),
    block(status("three")),
  ].reduce(
    (blocks, update) =>
      applyAgentOutputUpdate(blocks, update, { maxBlocks: 2 }),
    [] as AgentOutputBlock[],
  );
  expect(
    cappedBlocks.map((item) => item.kind === "status" && item.message),
  ).toEqual(["two", "three"]);
});

test("does not cut off assistant output at the thinking trace limit", () => {
  const firstChunk = "a".repeat(4_500);
  const finalChunk = " final sentence";
  const blocks = [
    delta("assistant", firstChunk),
    delta("assistant", finalChunk),
  ].reduce(
    (currentBlocks, update) => applyAgentOutputUpdate(currentBlocks, update),
    [] as AgentOutputBlock[],
  );

  expect(blocks[0]).toMatchObject({
    kind: "stream",
    streamKind: "assistant",
    text: `${firstChunk}${finalChunk}`,
  });
});

test("does not cap long finalized assistant output by default", () => {
  const finalText = `${"a".repeat(130_000)} final sentence`;
  const blocks = applyAgentOutputUpdate([], reconcile(finalText));

  expect(blocks[0]).toMatchObject({
    kind: "stream",
    streamKind: "assistant",
    text: finalText,
  });
});

test("keeps default thinking traces bounded", () => {
  const blocks = applyAgentOutputUpdate(
    [],
    delta("thinking", "t".repeat(4_500)),
  );

  expect(blocks[0]).toMatchObject({
    kind: "stream",
    streamKind: "thinking",
    truncated: true,
  });
  expect(
    blocks[0]?.kind === "stream" ? blocks[0].text.endsWith("…") : false,
  ).toBe(true);
});

test("reconciles final assistant text after trailing agent events", () => {
  const blocks = [
    delta("assistant", "partial ans"),
    block(status("pi: turn complete (0 tool result(s))")),
    reconcile("partial answer with final sentence"),
    block(status("pi: agent done")),
  ].reduce(
    (currentBlocks, update) => applyAgentOutputUpdate(currentBlocks, update),
    [] as AgentOutputBlock[],
  );

  expect(blocks).toHaveLength(3);
  expect(blocks[0]).toMatchObject({
    kind: "stream",
    streamKind: "assistant",
    text: "partial answer with final sentence",
  });
});

test("appends reconciled assistant text when no deltas were streamed", () => {
  const blocks = [
    block(status("pi: thinking")),
    reconcile("final answer"),
  ].reduce(
    (currentBlocks, update) => applyAgentOutputUpdate(currentBlocks, update),
    [] as AgentOutputBlock[],
  );

  expect(blocks[1]).toMatchObject({
    kind: "stream",
    streamKind: "assistant",
    text: "final answer",
  });
});

test("does not replace an older assistant message when final text arrives after summarizing without deltas", () => {
  const blocks = [
    delta("assistant", "Earlier complete answer."),
    block(status("pi: compaction started (threshold)")),
    block(status("pi: compaction ended (threshold)")),
    reconcile("New final answer after summarizing."),
    block(status("pi: agent done")),
  ].reduce(
    (currentBlocks, update) => applyAgentOutputUpdate(currentBlocks, update),
    [] as AgentOutputBlock[],
  );

  const assistantBlocks = blocks.filter(
    (
      outputBlock,
    ): outputBlock is Extract<AgentOutputBlock, { kind: "stream" }> =>
      outputBlock.kind === "stream" && outputBlock.streamKind === "assistant",
  );

  expect(assistantBlocks.map((outputBlock) => outputBlock.text)).toEqual([
    "Earlier complete answer.",
    "New final answer after summarizing.",
  ]);
});

function delta(
  streamKind: "assistant" | "thinking",
  delta: string,
  id = `delta:${streamKind}`,
): AgentOutputUpdate {
  return {
    delta,
    id,
    kind: "append-stream-delta",
    streamKind,
    timestamp: 1,
  };
}

function reconcile(text: string): AgentOutputUpdate {
  return {
    id: `reconcile:${text}`,
    kind: "reconcile-stream",
    streamKind: "assistant",
    text,
    timestamp: 1,
  };
}

function block(block: AgentOutputBlock): AgentOutputUpdate {
  return {
    block,
    kind: "append-block",
  };
}

function status(message: string): AgentOutputBlock {
  return {
    id: `status:${message}`,
    kind: "status",
    message,
    timestamp: 1,
  };
}
