import { expect, test } from "bun:test";
import { ContextItemRow } from "./ContextItemsList";

test("context item summaries wrap across two rows when needed", () => {
  const element = ContextItemRow({
    depth: 0,
    focused: false,
    label: "Saved answer",
    summary: {
      label: "Saved answer",
      status: "ready",
      title:
        "A longer generated summary that definitely needs a second terminal row when wrapped at eighty columns",
    },
    wrapWidth: 80,
  });

  const summaryText = collectElementsByType(element, "text").find((text) =>
    getTextContent(text).includes("definitely needs a second terminal row"),
  );

  expect(summaryText?.props.wrapMode).toBe("word");
  expect(summaryText?.props.truncate).toBeUndefined();
});

test("single-line context item summaries do not reserve extra height", () => {
  const element = ContextItemRow({
    depth: 0,
    focused: false,
    label: "Saved answer",
    summary: {
      label: "Saved answer",
      status: "ready",
      title: "Short summary",
    },
    wrapWidth: 80,
  });

  const summaryText = collectElementsByType(element, "text").find((text) =>
    getTextContent(text).includes("Short summary"),
  );

  expect(summaryText?.props.style).toEqual({ fg: "gray" });
});

test("say items render their full text inline in the context list", () => {
  const element = ContextItemRow({
    depth: 1,
    focused: true,
    inlineContent: "remember the full layout details",
    summary: {
      label: "User text: remember the full…",
      status: "missing",
      title: "User text: remember the full…",
    },
    wrapWidth: 80,
  });

  const contentText = collectElementsByType(element, "text").find((text) =>
    getTextContent(text).includes("remember the full layout details"),
  );

  expect(contentText?.props.wrapMode).toBe("word");
  expect(contentText?.props.truncate).toBeUndefined();
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

function getTextContent(element: UiElement | undefined): string {
  if (element === undefined) {
    return "";
  }

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
