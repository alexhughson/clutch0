import { expect, test } from "bun:test";
import { mapDeltaToAgentOutputUpdates } from "./cursorSdkDriver";

test("mapDeltaToAgentOutputUpdates appends text deltas on one stream id", () => {
  const streamState = { assistantStreamId: null, thinkingStreamId: null };
  const first = mapDeltaToAgentOutputUpdates(
    { type: "text-delta", text: "hel" },
    streamState,
  );
  const second = mapDeltaToAgentOutputUpdates(
    { type: "text-delta", text: "lo" },
    streamState,
  );

  expect(first[0]?.kind).toBe("append-stream-delta");
  expect(second[0]?.kind).toBe("append-stream-delta");
  if (
    first[0]?.kind === "append-stream-delta" &&
    second[0]?.kind === "append-stream-delta"
  ) {
    expect(first[0].delta).toBe("hel");
    expect(second[0].delta).toBe("lo");
    expect(second[0].id).toBe(first[0].id);
  }
});

test("mapDeltaToAgentOutputUpdates maps tool-call-started with args", () => {
  const streamState = {
    assistantStreamId: "asst-1",
    thinkingStreamId: "think-1",
  };
  const updates = mapDeltaToAgentOutputUpdates(
    {
      type: "tool-call-started",
      callId: "call-1",
      modelCallId: "model-1",
      toolCall: {
        type: "shell",
        args: { command: "ls -la" },
      },
    },
    streamState,
  );

  expect(streamState.assistantStreamId).toBeNull();
  expect(streamState.thinkingStreamId).toBeNull();
  expect(updates).toHaveLength(1);
  if (updates[0]?.kind === "append-block" && updates[0].block.kind === "tool") {
    expect(updates[0].block.toolName).toBe("shell");
    expect(updates[0].block.summary).toBe("ls -la");
    expect(updates[0].block.phase).toBe("start");
  }
});

test("mapDeltaToAgentOutputUpdates strips sandbox roots from tool paths", () => {
  const sandbox = "/tmp/clutch-agent-edit-xyz";
  const updates = mapDeltaToAgentOutputUpdates(
    {
      type: "tool-call-started",
      callId: "call-1",
      modelCallId: "model-1",
      toolCall: {
        type: "read",
        args: { path: `${sandbox}/src/app/layout.ts` },
      },
    },
    { assistantStreamId: null, thinkingStreamId: null },
    sandbox,
  );

  expect(updates).toHaveLength(1);
  if (updates[0]?.kind === "append-block" && updates[0].block.kind === "tool") {
    expect(updates[0].block.summary).toBe("src/app/layout.ts");
  }
});

test("mapDeltaToAgentOutputUpdates maps tool-call-completed errors", () => {
  const updates = mapDeltaToAgentOutputUpdates(
    {
      type: "tool-call-completed",
      callId: "call-1",
      modelCallId: "model-1",
      toolCall: {
        type: "read",
        args: { path: "missing.ts" },
        result: { status: "error", error: "not found" },
      },
    },
    { assistantStreamId: null, thinkingStreamId: null },
  );

  expect(updates).toHaveLength(1);
  if (updates[0]?.kind === "append-block" && updates[0].block.kind === "tool") {
    expect(updates[0].block.phase).toBe("end");
    expect(updates[0].block.isError).toBe(true);
  }
});

test("thinking-completed seals the thinking stream id", () => {
  const streamState = { assistantStreamId: null, thinkingStreamId: "t1" };
  const updates = mapDeltaToAgentOutputUpdates(
    { type: "thinking-completed", thinkingDurationMs: 12 },
    streamState,
  );
  expect(updates).toEqual([]);
  expect(streamState.thinkingStreamId).toBeNull();
});
