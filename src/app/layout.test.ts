import { expect, test } from "bun:test";
import type { AppTask } from "./appTypes";
import {
  estimateContextListHeight,
  getWorkspaceLayout,
  getWorkspaceLayoutMode,
  getWorkspaceStackLayout,
} from "./layout";
import {
  canUseContextListKeyboardWithPane,
  isWorkspacePaneTask,
} from "./taskPresentation";
import type { ContextItem, ContextItemSummaryView } from "../types";

test("classifies workspace layout from terminal dimensions", () => {
  expect(getWorkspaceLayoutMode({ height: 35, width: 140 })).toBe("wide");
  expect(getWorkspaceLayoutMode({ height: 25, width: 90 })).toBe("medium");
  expect(getWorkspaceLayoutMode({ height: 20, width: 90 })).toBe("compact");
  expect(getWorkspaceLayoutMode({ height: 35, width: 70 })).toBe("compact");
});

test("pane takes over only when preferred context height exceeds half the terminal", () => {
  const fewItems = [item("a", false), item("b", false)];
  const manyItems = Array.from({ length: 20 }, (_, index) =>
    item(`item-${index}`, true),
  );

  expect(
    getWorkspaceLayout({
      contextItems: fewItems,
      hasPaneTask: true,
      height: 20,
      width: 70,
    }),
  ).toEqual({ paneTakesOver: false, mode: "compact" });

  expect(
    getWorkspaceLayout({
      contextItems: manyItems,
      hasPaneTask: true,
      height: 24,
      width: 90,
    }),
  ).toEqual({ paneTakesOver: true, mode: "medium" });

  expect(
    getWorkspaceLayout({
      contextItems: manyItems,
      hasPaneTask: false,
      height: 24,
      width: 90,
    }),
  ).toEqual({ paneTakesOver: false, mode: "medium" });

  expect(
    getWorkspaceLayout({
      contextItems: manyItems,
      hasPaneTask: true,
      height: 35,
      width: 140,
    }),
  ).toEqual({ paneTakesOver: false, mode: "wide" });
});

test("routes command tasks into the workspace pane", () => {
  expect(isWorkspacePaneTask(null)).toBe(false);
  expect(isWorkspacePaneTask(configTask("first-run"))).toBe(false);
  expect(isWorkspacePaneTask(configTask("settings"))).toBe(true);
  expect(isWorkspacePaneTask({ kind: "find-files" } as AppTask)).toBe(true);
  expect(isWorkspacePaneTask({ kind: "create-file" } as AppTask)).toBe(true);
  expect(isWorkspacePaneTask({ kind: "shell-command" } as AppTask)).toBe(true);
  expect(isWorkspacePaneTask({ kind: "show-context" } as AppTask)).toBe(true);
  expect(isWorkspacePaneTask({ kind: "response" } as AppTask)).toBe(true);
  expect(isWorkspacePaneTask({ kind: "context-item-viewer" } as AppTask)).toBe(
    true,
  );
});

test("only passive panes share context-list keyboard navigation", () => {
  expect(
    canUseContextListKeyboardWithPane({ kind: "response" } as AppTask),
  ).toBe(true);
  expect(
    canUseContextListKeyboardWithPane({
      kind: "context-item-viewer",
    } as AppTask),
  ).toBe(true);
  expect(
    canUseContextListKeyboardWithPane({ kind: "find-files" } as AppTask),
  ).toBe(false);
  expect(
    canUseContextListKeyboardWithPane({ kind: "shell-command" } as AppTask),
  ).toBe(false);
});

test("workspace stack heights fit supported small layouts", () => {
  expect(stackTotal("medium", 24, 90, false, [])).toBeLessThanOrEqual(24);
  expect(stackTotal("medium", 25, 90, true, [])).toBeLessThanOrEqual(25);
  expect(stackTotal("compact", 20, 80, false, [])).toBeLessThanOrEqual(20);
  expect(stackTotal("compact", 20, 80, true, [])).toBeLessThanOrEqual(20);
  expect(stackTotal("compact", 19, 80, true, [])).toBeLessThanOrEqual(19);
  expect(stackTotal("compact", 14, 80, true, [])).toBeLessThanOrEqual(14);
  expect(stackTotal("compact", 14, 80, false, [])).toBeLessThanOrEqual(14);
});

test("workspace stack sizes context to content until the composer is pinned", () => {
  const oneItem = [item("one", false)];
  const twoSummarized = [item("one", true), item("two", true)];

  // Small lists keep a minimum chrome height; larger lists grow with content.
  expect(stack("medium", 40, 100, false, oneItem).contextHeight).toBe(4);
  expect(stack("compact", 40, 100, false, twoSummarized).contextHeight).toBe(
    estimateContextListHeight({
      columns: 1,
      contextItems: twoSummarized,
      wrapWidth: 94,
    }),
  );
  expect(stack("compact", 20, 100, false, []).contextHeight).toBe(4);

  const growing = [
    item("one", true),
    item("two", true),
    item("three", true),
    item("four", true),
  ];
  expect(stack("compact", 40, 100, false, growing).contextHeight).toBe(
    estimateContextListHeight({
      columns: 1,
      contextItems: growing,
      wrapWidth: 94,
    }),
  );

  const manyItems = Array.from({ length: 30 }, (_, index) =>
    item(`item-${index}`, true),
  );
  const constrained = stack("compact", 20, 100, false, manyItems);
  expect(constrained.contextHeight).toBeLessThan(
    estimateContextListHeight({
      columns: 1,
      contextItems: manyItems,
      wrapWidth: 94,
    }),
  );
  expect(stackTotal("compact", 20, 100, false, manyItems)).toBeLessThanOrEqual(
    20,
  );
});

test("estimateContextListHeight accounts for summary rows and columns", () => {
  const items = [item("a", true), item("b", true), item("c", false)];
  expect(
    estimateContextListHeight({
      columns: 1,
      contextItems: items,
      wrapWidth: 80,
    }),
  ).toBe(1 + 2 + 2 + 1);
  expect(
    estimateContextListHeight({
      columns: 2,
      contextItems: items,
      wrapWidth: 39,
    }),
  ).toBe(1 + Math.max(2 + 2, 1));
});

test("estimateContextListHeight wraps and caps long summaries", () => {
  const longTitle = "x".repeat(500);
  const items = [itemWithSummary(longTitle)];

  expect(
    estimateContextListHeight({
      columns: 1,
      contextItems: items,
      wrapWidth: 80,
    }),
  ).toBe(1 + 1 + 2);

  expect(
    estimateContextListHeight({
      columns: 1,
      contextItems: items,
      wrapWidth: 40,
    }),
  ).toBe(1 + 1 + 2);
});

function configTask(mode: "first-run" | "settings"): AppTask {
  return {
    agentHarness: { kind: "cursor", config: {} },
    configuredProviders: [],
    endpoints: [],
    kind: "config",
    mode,
    primary: { model: "gpt-test", provider: "openrouter" },
    summarization: { model: "gpt-test", provider: "openrouter" },
  };
}

function stack(
  mode: "compact" | "medium",
  terminalHeight: number,
  terminalWidth: number,
  composerHasSuggestions: boolean,
  contextItems: readonly ContextItem[],
) {
  return getWorkspaceStackLayout({
    composerHasSuggestions,
    contextItems,
    mode,
    terminalHeight,
    terminalWidth,
  });
}

function stackTotal(
  mode: "compact" | "medium",
  terminalHeight: number,
  terminalWidth: number,
  composerHasSuggestions: boolean,
  contextItems: readonly ContextItem[],
): number {
  const layout = stack(
    mode,
    terminalHeight,
    terminalWidth,
    composerHasSuggestions,
    contextItems,
  );
  const suggestionRows =
    layout.suggestionHeight === undefined ? 0 : layout.suggestionHeight + 1;

  return (
    8 +
    layout.contextHeight +
    layout.summaryHeight +
    layout.inputHeight +
    suggestionRows
  );
}

function item(id: string, withSummary: boolean): ContextItem {
  const summary: ContextItemSummaryView = withSummary
    ? {
        label: id,
        status: "ready",
        title: `${id} summary line`,
      }
    : {
        label: id,
        status: "ready",
        title: id,
      };

  return makeItem(id, summary);
}

function itemWithSummary(title: string): ContextItem {
  const summary: ContextItemSummaryView = {
    label: `${title} label`,
    status: "ready",
    title,
  };

  return makeItem(title, summary);
}

function makeItem(id: string, summary: ContextItemSummaryView): ContextItem {
  return {
    id,
    getListGroup: () => null,
    getSummaryView: () => summary,
    isPinned: () => false,
  } as ContextItem;
}
