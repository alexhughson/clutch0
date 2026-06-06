import type { AppTask } from "./appTypes";

export type WorkspaceLayoutMode = "compact" | "medium" | "wide";

export type WorkspaceLayout = {
  detailTakesOver: boolean;
  mode: WorkspaceLayoutMode;
};

const WIDE_MIN_WIDTH = 120;
const WIDE_MIN_HEIGHT = 28;
const MEDIUM_MIN_WIDTH = 82;
const MEDIUM_MIN_HEIGHT = 24;

export function getWorkspaceLayout({
  hasDetailTask,
  height,
  width,
}: {
  hasDetailTask: boolean;
  height: number;
  width: number;
}): WorkspaceLayout {
  const mode = getWorkspaceLayoutMode({ height, width });

  return {
    detailTakesOver: hasDetailTask && mode === "compact",
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

export function isWorkspaceDetailTask(
  task: AppTask | null,
): task is Extract<AppTask, { kind: "context-item-viewer" | "response" }> {
  return task?.kind === "context-item-viewer" || task?.kind === "response";
}
