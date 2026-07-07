import { expect, test } from "bun:test";
import { ContextItemRow } from "./ContextItemsList";

test("context item summaries wrap across two rows", () => {
  const element = ContextItemRow({
    depth: 0,
    focused: false,
    label: "Saved answer",
    summary: {
      label: "Saved answer",
      status: "ready",
      title: "A longer generated summary that needs a second terminal row",
    },
  });

  const summaryText = collectElementsByType(element, "text").find((text) =>
    getTextContent(text).includes("A longer generated summary"),
  );

  expect(summaryText?.props.wrapMode).toBe("word");
  expect(summaryText?.props.style).toMatchObject({ height: 2 });
  expect(summaryText?.props.truncate).toBeUndefined();
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

function getTextContent(element: UiElement): string {
  const children = element.props.children;
  if (typeof children === "string") {
    return children;
  }

  return "";
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
    style?: unknown;
    truncate?: boolean;
    wrapMode?: string;
  };
  type: string;
};
