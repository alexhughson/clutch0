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
    delta("thinking", "before"),
    block({
      id: "tool",
      kind: "tool",
      phase: "start",
      summary: "grep",
      timestamp: 1,
      toolName: "grep",
    }),
    delta("thinking", "after"),
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

function delta(
  streamKind: "assistant" | "thinking",
  delta: string,
): AgentOutputUpdate {
  return {
    delta,
    id: `delta:${streamKind}:${delta}`,
    kind: "append-stream-delta",
    streamKind,
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
