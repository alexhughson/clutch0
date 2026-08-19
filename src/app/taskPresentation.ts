import type { AppTask } from "./appTypes";
import { assertNever } from "../lib/invariant";

export function isWorkspacePaneTask(task: AppTask | null): task is AppTask {
  return task !== null && (task.kind !== "config" || task.mode === "settings");
}

export function canUseContextListKeyboardWithPane(task: AppTask): boolean {
  return task.kind === "context-item-viewer" || task.kind === "response";
}

export function canCloseTaskWithCtrlC(task: AppTask): boolean {
  switch (task.kind) {
    case "config":
      return task.mode === "settings";
    case "context-item-viewer":
      return task.applyStatus !== "applying";
    case "create-file":
      return task.applyStatus !== "applying";
    case "find-files":
      return task.status !== "searching";
    case "response":
      return canCloseResponseTaskWithCtrlC(task);
    case "shell-command":
      return task.status !== "running" && task.status !== "selecting";
    case "show-context":
      return task.status !== "loading";
    default:
      return assertNever(task, "Unhandled ctrl+c task");
  }
}

function canCloseResponseTaskWithCtrlC(
  task: Extract<AppTask, { kind: "response" }>,
): boolean {
  if (
    task.request.status === "loading" ||
    task.request.status === "streaming"
  ) {
    return false;
  }

  const patch = task.request.patch;
  return (
    patch === undefined ||
    (patch.applyStatus !== "applying" && patch.applyStatus !== "applied")
  );
}
