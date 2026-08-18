import { expect, test } from "bun:test";
import { AgentOutputLog } from "./AgentOutputLog";
import type { AgentOutputBlock } from "../lib/agentOutput/agentOutputTypes";

test("agent output uses one sticky bottom scrollbox", () => {
  const element = render(AgentOutputLog({
    blocks: [
      status("pi: compaction started"),
      stream("assistant", `${"line\n".repeat(40)}FINAL_SENTINEL`),
      status("pi: agent done"),
    ],
    height: 8,
  }));

  const scrollboxes = collectElementsByType(element, "scrollbox");
  expect(scrollboxes).toHaveLength(1);
  expect(scrollboxes[0]?.props.stickyScroll).toBe(true);
  expect(scrollboxes[0]?.props.stickyStart).toBe("bottom");
});

test("final assistant is rendered as markdown after compact activity", () => {
  const element = render(AgentOutputLog({
    blocks: [
      tool("shell", "start", "ls"),
      stream("thinking", "planning next step"),
      stream("assistant", "Earlier note."),
      status("pi: turn"),
      stream("assistant", "Final answer."),
    ],
  }));

  const texts = collectTextContents(element);
  expect(texts.some((text) => text.includes("▸ shell  ls"))).toBe(true);
  expect(texts.some((text) => text.includes("thinking · planning next step"))).toBe(
    true,
  );
  expect(texts.some((text) => text.includes("assistant · Earlier note."))).toBe(
    true,
  );
  expect(texts.some((text) => text.includes("── response ──"))).toBe(true);

  const markdown = collectElementsByType(element, "markdown");
  expect(markdown).toHaveLength(1);
  expect(markdown[0]?.props.content).toBe("Final answer.");
});

function render(element: unknown): unknown {
  if (!isUiElement(element)) {
    return element;
  }

  if (typeof element.type === "function") {
    return render(element.type(element.props));
  }

  const children = element.props.children;
  if (Array.isArray(children)) {
    return {
      ...element,
      props: {
        ...element.props,
        children: children.map((child) => render(child)),
      },
    };
  }

  if (children === undefined) {
    return element;
  }

  return {
    ...element,
    props: {
      ...element.props,
      children: render(children),
    },
  };
}

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

function collectTextContents(element: unknown): string[] {
  if (typeof element === "string") {
    return [element];
  }
  if (!isUiElement(element)) {
    return [];
  }

  const children = element.props.children;
  if (typeof children === "string") {
    return [children];
  }
  if (Array.isArray(children)) {
    return children.flatMap((child) => collectTextContents(child));
  }
  return collectTextContents(children);
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
    content?: string;
    stickyScroll?: boolean;
    stickyStart?: string;
  };
  type: string | ((props: Record<string, unknown>) => unknown);
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

function tool(
  toolName: string,
  phase: "start" | "end" | "update",
  summary: string,
): AgentOutputBlock {
  return {
    id: `tool:${toolName}:${phase}:${summary}`,
    kind: "tool",
    phase,
    summary,
    timestamp: 1,
    toolName,
  };
}
