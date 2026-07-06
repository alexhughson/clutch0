import { expect, test } from "bun:test";
import { AgentOutputLog } from "./AgentOutputLog";
import type { AgentOutputBlock } from "../lib/agentOutput/agentOutputTypes";

test("assistant response pane sticks to the bottom", () => {
  const element = AgentOutputLog({
    blocks: [
      status("pi: compaction started"),
      stream("assistant", `${"line\n".repeat(40)}FINAL_SENTINEL`),
      status("pi: agent done"),
    ],
    height: 8,
  });

  const scrollboxes = collectElementsByType(element, "scrollbox");
  expect(scrollboxes).toHaveLength(2);
  expect(scrollboxes[1]?.props.stickyScroll).toBe(true);
  expect(scrollboxes[1]?.props.stickyStart).toBe("bottom");
});

test("single assistant response pane also sticks to the bottom", () => {
  const element = AgentOutputLog({
    blocks: [stream("assistant", `${"line\n".repeat(40)}FINAL_SENTINEL`)],
    height: 8,
  });

  const scrollboxes = collectElementsByType(element, "scrollbox");
  expect(scrollboxes).toHaveLength(1);
  expect(scrollboxes[0]?.props.stickyScroll).toBe(true);
  expect(scrollboxes[0]?.props.stickyStart).toBe("bottom");
});

function collectElementsByType(element: unknown, type: string): UiElement[] {
  if (!isUiElement(element)) {
    return [];
  }

  const matches = element.type === type ? [element] : [];
  const children = element.props.children;
  if (Array.isArray(children)) {
    return [
      ...matches,
      ...children.flatMap((child) => collectElementsByType(child, type)),
    ];
  }

  return [...matches, ...collectElementsByType(children, type)];
}

function isUiElement(value: unknown): value is UiElement {
  return (
    typeof value === "object" &&
    value !== null &&
    "props" in value &&
    "type" in value
  );
}

type UiElement = {
  props: {
    children?: unknown;
    stickyScroll?: boolean;
    stickyStart?: string;
  };
  type: string;
};

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
