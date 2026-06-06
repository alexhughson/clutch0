export type WorkspaceLayoutMode = "compact" | "medium" | "wide";

export type WorkspaceLayout = {
  paneTakesOver: boolean;
  mode: WorkspaceLayoutMode;
};

const WIDE_MIN_WIDTH = 120;
const WIDE_MIN_HEIGHT = 28;
const MEDIUM_MIN_WIDTH = 82;
const MEDIUM_MIN_HEIGHT = 24;

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
