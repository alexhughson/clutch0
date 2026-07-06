import { expect, test } from "bun:test";
import {
  orderAgentOutputBlocksForDisplay,
  splitAgentOutputBlocksForDisplay,
} from "./agentOutputDisplay";
import type { AgentOutputBlock } from "./agentOutputTypes";

test("keeps the latest assistant response at the bottom after trailing pi events", () => {
  const blocks = [
    status("pi: thinking"),
    stream("thinking", "Reading context"),
    stream("assistant", "Use the adapter layer."),
    status("pi: turn complete"),
    status("pi: agent done"),
  ];

  expect(
    orderAgentOutputBlocksForDisplay(blocks).map((block) => block.id),
  ).toEqual([
    "status:pi: thinking",
    "stream:thinking:Reading context",
    "status:pi: turn complete",
    "status:pi: agent done",
    "stream:assistant:Use the adapter layer.",
  ]);
});

test("moves only the latest assistant response", () => {
  const blocks = [
    stream("assistant", "Earlier answer."),
    status("pi: thinking"),
    stream("assistant", "Latest answer."),
    status("pi: done"),
  ];

  expect(
    orderAgentOutputBlocksForDisplay(blocks).map((block) => block.id),
  ).toEqual([
    "stream:assistant:Earlier answer.",
    "status:pi: thinking",
    "status:pi: done",
    "stream:assistant:Latest answer.",
  ]);
});

test("splits final assistant response from summarizing activity", () => {
  const blocks = [
    stream("assistant", "Earlier answer."),
    status("pi: compaction started (threshold)"),
    status("pi: compaction ended (threshold)"),
    stream("assistant", "Final answer with enough text to need its own pane."),
    status("pi: agent done"),
  ];

  const display = splitAgentOutputBlocksForDisplay(blocks);

  expect(display.activityBlocks.map((block) => block.id)).toEqual([
    "stream:assistant:Earlier answer.",
    "status:pi: compaction started (threshold)",
    "status:pi: compaction ended (threshold)",
    "status:pi: agent done",
  ]);
  expect(display.latestAssistantBlock?.id).toBe(
    "stream:assistant:Final answer with enough text to need its own pane.",
  );
});

function status(message: string): AgentOutputBlock {
  return {
    id: `status:${message}`,
    kind: "status",
    message,
    timestamp: 1,
  };
}

function stream(
  streamKind: "assistant" | "thinking",
  text: string,
): AgentOutputBlock {
  return {
    id: `stream:${streamKind}:${text}`,
    kind: "stream",
    streamKind,
    text,
    timestamp: 1,
  };
}
