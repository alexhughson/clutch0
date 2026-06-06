import type { KeyEvent } from "@opentui/core";
import { assertNever } from "../lib/invariant";
import type { AppTask } from "./appTypes";

export const BASE_CTRL_C_EXIT_INTERVAL_MS = 1500;

export type CtrlCShortcutDecision =
  | "arm-exit"
  | "close-task"
  | "exit"
  | "ignore";

export function isCtrlCKey(event: KeyEvent): boolean {
  return event.ctrl && event.name === "c";
}

export function getCtrlCShortcutDecision({
  activeTask,
  lastBaseCtrlCAt,
  now,
}: {
  activeTask: AppTask | null;
  lastBaseCtrlCAt: number | null;
  now: number;
}): CtrlCShortcutDecision {
  if (activeTask !== null) {
    return canCloseTaskWithCtrlC(activeTask) ? "close-task" : "ignore";
  }

  if (
    lastBaseCtrlCAt !== null &&
    now >= lastBaseCtrlCAt &&
    now - lastBaseCtrlCAt <= BASE_CTRL_C_EXIT_INTERVAL_MS
  ) {
    return "exit";
  }

  return "arm-exit";
}

function canCloseTaskWithCtrlC(task: AppTask): boolean {
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
      return task.status !== "running";
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
