import {
  getContextItemDisplayEntries,
  type ContextItemDisplayEntry,
} from "../lib/context/contextItemDisplay";
import type { ContextItem } from "../types";

export type WorkspaceLayoutMode = "compact" | "medium" | "wide";

export type WorkspaceLayout = {
  paneTakesOver: boolean;
  mode: WorkspaceLayoutMode;
};

export type WorkspaceStackLayout = {
  contextHeight: number;
  inputHeight: number;
  suggestionHeight?: number;
  summaryHeight: number;
};

const WIDE_MIN_WIDTH = 120;
const WIDE_MIN_HEIGHT = 28;
const MEDIUM_MIN_WIDTH = 82;
const MEDIUM_MIN_HEIGHT = 24;
const WORKSPACE_VERTICAL_CHROME_HEIGHT = 8;
const CONTEXT_LIST_MIN_HEIGHT = 4;
const CONTEXT_LIST_HEADER_HEIGHT = 1;
const CONTEXT_ITEM_SUMMARY_ROWS = 2;
const MIN_SUMMARY_HEIGHT = 1;
const PANE_TAKEOVER_CONTEXT_RATIO = 0.5;
export const WIDE_SUMMARY_HEIGHT = 9;

const MEDIUM_SUMMARY_HEIGHT = 9;
const MEDIUM_SUMMARY_WITH_SUGGESTIONS_HEIGHT = 8;
const COMPACT_SUMMARY_HEIGHT = 7;

export function getWorkspaceLayout({
  contextItems,
  hasPaneTask,
  height,
  width,
}: {
  contextItems: readonly ContextItem[];
  hasPaneTask: boolean;
  height: number;
  width: number;
}): WorkspaceLayout {
  const mode = getWorkspaceLayoutMode({ height, width });
  const preferredContextHeight = estimateContextListHeight({
    columns: mode === "medium" ? 2 : 1,
    contextItems,
  });

  return {
    paneTakesOver:
      hasPaneTask &&
      mode !== "wide" &&
      preferredContextHeight > height * PANE_TAKEOVER_CONTEXT_RATIO,
    mode,
  };
}

export function getWorkspaceLayoutMode({
  height,
  width,
}: {
  height: number;
  width: number;
}): WorkspaceLayoutMode {
  if (width >= WIDE_MIN_WIDTH && height >= WIDE_MIN_HEIGHT) {
    return "wide";
  }

  if (width >= MEDIUM_MIN_WIDTH && height >= MEDIUM_MIN_HEIGHT) {
    return "medium";
  }

  return "compact";
}

export function getWorkspaceStackLayout({
  composerHasSuggestions,
  contextItems,
  mode,
  terminalHeight,
}: {
  composerHasSuggestions: boolean;
  contextItems: readonly ContextItem[];
  mode: Exclude<WorkspaceLayoutMode, "wide">;
  terminalHeight: number;
}): WorkspaceStackLayout {
  const preferredContextHeight = estimateContextListHeight({
    columns: mode === "medium" ? 2 : 1,
    contextItems,
  });

  if (mode === "medium") {
    const inputHeight = composerHasSuggestions ? 3 : 4;
    const suggestionHeight = fitSuggestionHeight({
      inputHeight,
      preferredSuggestionHeight: composerHasSuggestions ? 5 : undefined,
      terminalHeight,
    });
    const summaryHeight = composerHasSuggestions
      ? MEDIUM_SUMMARY_WITH_SUGGESTIONS_HEIGHT
      : MEDIUM_SUMMARY_HEIGHT;

    return constrainWorkspaceStackLayout({
      inputHeight,
      preferredContextHeight,
      preferredSummaryHeight: summaryHeight,
      suggestionHeight,
      terminalHeight,
    });
  }

  const inputHeight = 2;
  const suggestionHeight = fitSuggestionHeight({
    inputHeight,
    preferredSuggestionHeight: composerHasSuggestions ? 4 : undefined,
    terminalHeight,
  });

  return constrainWorkspaceStackLayout({
    inputHeight,
    preferredContextHeight,
    preferredSummaryHeight: COMPACT_SUMMARY_HEIGHT,
    suggestionHeight,
    terminalHeight,
  });
}

export function estimateContextListHeight({
  columns,
  contextItems,
}: {
  columns: 1 | 2;
  contextItems: readonly ContextItem[];
}): number {
  if (contextItems.length === 0) {
    return CONTEXT_LIST_MIN_HEIGHT;
  }

  const entries = getContextItemDisplayEntries(contextItems);
  if (columns === 1) {
    return CONTEXT_LIST_HEADER_HEIGHT + sumEntryHeights(entries);
  }

  const splitIndex = Math.ceil(entries.length / 2);
  const leftHeight = sumEntryHeights(entries.slice(0, splitIndex));
  const rightHeight = sumEntryHeights(entries.slice(splitIndex));
  return CONTEXT_LIST_HEADER_HEIGHT + Math.max(leftHeight, rightHeight);
}

function sumEntryHeights(entries: readonly ContextItemDisplayEntry[]): number {
  let height = 0;
  for (const entry of entries) {
    if (entry.kind === "folder") {
      height += 1;
      continue;
    }

    height += 1;
    const regenStatus = entry.item.getRegenStatus?.();
    if (
      regenStatus?.status === "running" ||
      regenStatus?.status === "error"
    ) {
      height += 1;
    }
    const summary = entry.item.getSummaryView();
    if (hasShortSummary(summary.status, summary.title, summary.label)) {
      height += CONTEXT_ITEM_SUMMARY_ROWS;
    }
  }
  return height;
}

function hasShortSummary(
  status: string,
  title: string,
  label: string,
): boolean {
  if (status === "ready" && title !== label) {
    return true;
  }
  return status === "pending";
}

function fitSuggestionHeight({
  inputHeight,
  preferredSuggestionHeight,
  terminalHeight,
}: {
  inputHeight: number;
  preferredSuggestionHeight: number | undefined;
  terminalHeight: number;
}): number | undefined {
  if (preferredSuggestionHeight === undefined) {
    return undefined;
  }

  const preferredSuggestionRows = preferredSuggestionHeight + 1;
  const reservedStackHeight = CONTEXT_LIST_MIN_HEIGHT + MIN_SUMMARY_HEIGHT;
  const availableSuggestionRowsWithStack =
    terminalHeight -
    WORKSPACE_VERTICAL_CHROME_HEIGHT -
    inputHeight -
    reservedStackHeight;
  const availableSuggestionRows =
    availableSuggestionRowsWithStack >= 1
      ? availableSuggestionRowsWithStack
      : terminalHeight - WORKSPACE_VERTICAL_CHROME_HEIGHT - inputHeight;

  return Math.max(
    0,
    Math.min(preferredSuggestionRows, availableSuggestionRows) - 1,
  );
}

function constrainWorkspaceStackLayout({
  inputHeight,
  preferredContextHeight,
  preferredSummaryHeight,
  suggestionHeight,
  terminalHeight,
}: {
  inputHeight: number;
  preferredContextHeight: number;
  preferredSummaryHeight: number;
  suggestionHeight?: number;
  terminalHeight: number;
}): WorkspaceStackLayout {
  const suggestionRows =
    suggestionHeight === undefined ? 0 : suggestionHeight + 1;
  const availableHeight =
    terminalHeight -
    WORKSPACE_VERTICAL_CHROME_HEIGHT -
    inputHeight -
    suggestionRows;
  const summaryHeight = Math.max(
    availableHeight <= 0 ? 0 : MIN_SUMMARY_HEIGHT,
    Math.min(preferredSummaryHeight, availableHeight - CONTEXT_LIST_MIN_HEIGHT),
  );
  const maxContextHeight = Math.max(0, availableHeight - summaryHeight);
  const contextHeight = Math.min(
    maxContextHeight,
    Math.max(
      preferredContextHeight,
      maxContextHeight >= CONTEXT_LIST_MIN_HEIGHT ? CONTEXT_LIST_MIN_HEIGHT : 0,
    ),
  );

  return {
    contextHeight,
    inputHeight,
    suggestionHeight,
    summaryHeight,
  };
}
