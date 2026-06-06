import type { AppTask } from "./appTypes";

export function isWorkspacePaneTask(task: AppTask | null): task is AppTask {
  return task !== null && (task.kind !== "config" || task.mode === "settings");
}

export function canUseContextListKeyboardWithPane(task: AppTask): boolean {
  return task.kind === "context-item-viewer" || task.kind === "response";
}
