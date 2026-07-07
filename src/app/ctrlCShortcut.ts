import type { KeyEvent } from "@opentui/core";
import type { AppTask } from "./appTypes";
import { canCloseTaskWithCtrlC } from "./taskPresentation";

export const BASE_CTRL_C_EXIT_INTERVAL_MS = 1500;

export type CtrlCShortcutDecision =
  | "arm-exit"
  | "close-task"
  | "exit"
  | "ignore";

export function isRawCtrlCSequence(sequence: string): boolean {
  return sequence === "\u0003";
}

export function isCtrlCKey(event: KeyEvent): boolean {
  return (
    (event.ctrl && event.name.toLowerCase() === "c") ||
    isRawCtrlCSequence(event.sequence) ||
    isRawCtrlCSequence(event.raw)
  );
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
  if (
    lastBaseCtrlCAt !== null &&
    now >= lastBaseCtrlCAt &&
    now - lastBaseCtrlCAt <= BASE_CTRL_C_EXIT_INTERVAL_MS
  ) {
    return "exit";
  }

  if (activeTask !== null) {
    return canCloseTaskWithCtrlC(activeTask) ? "close-task" : "arm-exit";
  }

  return "arm-exit";
}
