import type { KeyEvent } from "@opentui/core";
import type { ContextItemAction } from "../../types";

export function getContextItemActionForKeyEvent({
  actions,
  event,
}: {
  actions: readonly ContextItemAction[];
  event: KeyEvent;
}): ContextItemAction | null {
  return (
    actions.find(
      (action) =>
        action.shortcut !== undefined &&
        action.shortcut.name === event.name &&
        Boolean(action.shortcut.ctrl) === event.ctrl &&
        Boolean(action.shortcut.shift) === event.shift &&
        Boolean(action.shortcut.meta) === event.meta &&
        Boolean(action.shortcut.option) === event.option &&
        Boolean(action.shortcut.super) === Boolean(event.super) &&
        Boolean(action.shortcut.hyper) === Boolean(event.hyper),
    ) ?? null
  );
}

export function formatContextItemAction(action: ContextItemAction): string {
  return action.shortcut === undefined
    ? action.label
    : `${action.shortcut.display} ${action.label}`;
}
