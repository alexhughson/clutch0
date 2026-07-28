import { expect, test } from "bun:test";
import type { AppTask } from "./appTypes";
import {
  getWorkspaceLayout,
  getWorkspaceLayoutMode,
  getWorkspaceStackLayout,
} from "./layout";
import {
  canUseContextListKeyboardWithPane,
  isWorkspacePaneTask,
} from "./taskPresentation";

test("classifies workspace layout from terminal dimensions", () => {
  expect(getWorkspaceLayoutMode({ height: 35, width: 140 })).toBe("wide");
  expect(getWorkspaceLayoutMode({ height: 25, width: 90 })).toBe("medium");
  expect(getWorkspaceLayoutMode({ height: 20, width: 90 })).toBe("compact");
  expect(getWorkspaceLayoutMode({ height: 35, width: 70 })).toBe("compact");
});

test("compact layout gives pane tasks the whole screen", () => {
  expect(
    getWorkspaceLayout({ hasPaneTask: true, height: 20, width: 70 }),
  ).toEqual({ paneTakesOver: true, mode: "compact" });
  expect(
    getWorkspaceLayout({ hasPaneTask: true, height: 35, width: 140 }),
  ).toEqual({ paneTakesOver: false, mode: "wide" });
  expect(
    getWorkspaceLayout({ hasPaneTask: false, height: 20, width: 70 }),
  ).toEqual({ paneTakesOver: false, mode: "compact" });
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
  expect(stackTotal("medium", 24, false)).toBeLessThanOrEqual(24);
  expect(stackTotal("medium", 25, true)).toBeLessThanOrEqual(25);
  expect(stackTotal("compact", 20, false)).toBeLessThanOrEqual(20);
  expect(stackTotal("compact", 20, true)).toBeLessThanOrEqual(20);
  expect(stackTotal("compact", 19, true)).toBeLessThanOrEqual(19);
  expect(stackTotal("compact", 14, true)).toBeLessThanOrEqual(14);
  expect(stackTotal("compact", 14, false)).toBeLessThanOrEqual(14);
});

test("workspace stack keeps enough context rows for one summarized item", () => {
  expect(stack("medium", 24, false).contextHeight).toBe(4);
  expect(stack("medium", 25, true).contextHeight).toBe(4);
  expect(stack("compact", 20, false).contextHeight).toBe(4);
  expect(stack("compact", 20, true).contextHeight).toBe(4);
  expect(stack("compact", 19, true).contextHeight).toBe(4);
});

function configTask(mode: "first-run" | "settings"): AppTask {
  return {
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
  composerHasSuggestions: boolean,
) {
  return getWorkspaceStackLayout({
    composerHasSuggestions,
    hasPaneTask: false,
    mode,
    terminalHeight,
  });
}

function stackTotal(
  mode: "compact" | "medium",
  terminalHeight: number,
  composerHasSuggestions: boolean,
): number {
  const layout = stack(mode, terminalHeight, composerHasSuggestions);
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
