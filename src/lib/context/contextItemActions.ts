import type { KeyEvent } from "@opentui/core";
import type { ContextItemAction } from "../../types";

export function openContextItemAction(itemId: string): ContextItemAction {
  return {
    id: "open",
    label: "open",
    shortcut: { ctrl: true, display: "Ctrl+o", name: "o" },
    run: (context) => context.openContextItem(itemId),
  };
}

export function applyDiffAction(itemId: string): ContextItemAction {
  return {
    id: "apply",
    label: "apply",
    paneShortcut: { display: "a", name: "a" },
    shortcut: { ctrl: true, display: "Ctrl+y", name: "y" },
    run: (context) => context.applyDiff(itemId),
  };
}

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

export function getContextItemActionForPaneKeyEvent({
  actions,
  event,
}: {
  actions: readonly ContextItemAction[];
  event: KeyEvent;
}): ContextItemAction | null {
  return (
    actions.find((action) => {
      const paneShortcut = action.paneShortcut;
      if (paneShortcut === undefined) {
        return false;
      }

      return (
        paneShortcut.name === event.name &&
        !event.ctrl &&
        !event.shift &&
        !event.meta &&
        !event.option &&
        !event.super &&
        !event.hyper
      );
    }) ?? null
  );
}

export function formatPaneActionHints(
  actions: readonly ContextItemAction[],
): string {
  return actions
    .map((action) =>
      action.paneShortcut === undefined
        ? null
        : `${action.paneShortcut.display} ${action.label}`,
    )
    .filter((hint): hint is string => hint !== null)
    .join(" · ");
}

export function formatContextItemAction(action: ContextItemAction): string {
  return action.shortcut === undefined
    ? action.label
    : `${action.shortcut.display} ${action.label}`;
}
