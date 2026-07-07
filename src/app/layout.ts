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
const MIN_SUMMARY_HEIGHT = 1;
export const WIDE_SUMMARY_HEIGHT = 9;

const MEDIUM_SUMMARY_HEIGHT = 9;
const MEDIUM_SUMMARY_WITH_SUGGESTIONS_HEIGHT = 8;
const COMPACT_SUMMARY_HEIGHT = 7;

export function getWorkspaceLayout({
  hasPaneTask,
  height,
  width,
}: {
  hasPaneTask: boolean;
  height: number;
  width: number;
}): WorkspaceLayout {
  const mode = getWorkspaceLayoutMode({ height, width });

  return {
    paneTakesOver: hasPaneTask && mode === "compact",
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
  hasPaneTask,
  mode,
  terminalHeight,
}: {
  composerHasSuggestions: boolean;
  hasPaneTask: boolean;
  mode: Exclude<WorkspaceLayoutMode, "wide">;
  terminalHeight: number;
}): WorkspaceStackLayout {
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
      maxContextHeight: hasPaneTask ? 8 : 10,
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
    maxContextHeight: Number.POSITIVE_INFINITY,
    preferredSummaryHeight: COMPACT_SUMMARY_HEIGHT,
    suggestionHeight,
    terminalHeight,
  });
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
  maxContextHeight,
  preferredSummaryHeight,
  suggestionHeight,
  terminalHeight,
}: {
  inputHeight: number;
  maxContextHeight: number;
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
  const contextHeight = Math.max(
    0,
    Math.min(
      maxContextHeight,
      Math.max(
        availableHeight - summaryHeight,
        availableHeight >= CONTEXT_LIST_MIN_HEIGHT + MIN_SUMMARY_HEIGHT
          ? CONTEXT_LIST_MIN_HEIGHT
          : 0,
      ),
    ),
  );

  return {
    contextHeight,
    inputHeight,
    suggestionHeight,
    summaryHeight,
  };
}
