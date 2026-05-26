import type { KeyEvent } from "@opentui/core";
import {
  getKeyAction,
  getVerticalNavigationDirection,
  type KeyBinding,
} from "../../lib/keymap";

export type MessageComposerKeyAction =
  | "accept-suggestion"
  | "apply-focused-context-item"
  | "confirm"
  | "open-focused-context-item"
  | "remove-focused-context-item"
  | "rerun-focused-context-item"
  | "select-next-file"
  | "select-previous-file";

const messageComposerKeyBindings: KeyBinding<MessageComposerKeyAction>[] = [
  { name: "return", action: "confirm" },
  { name: "kpenter", action: "confirm" },
  { name: "linefeed", action: "confirm" },
  { name: "tab", action: "accept-suggestion" },
  { name: "o", ctrl: true, action: "open-focused-context-item" },
  { name: "r", ctrl: true, action: "rerun-focused-context-item" },
  { name: "x", ctrl: true, action: "remove-focused-context-item" },
  { name: "y", ctrl: true, action: "apply-focused-context-item" },
];

export function getMessageComposerKeyAction(
  event: KeyEvent,
): MessageComposerKeyAction | null {
  const verticalNavigationDirection = getVerticalNavigationDirection(event);
  if (verticalNavigationDirection !== null) {
    return verticalNavigationDirection === "next"
      ? "select-next-file"
      : "select-previous-file";
  }

  return getKeyAction(event, messageComposerKeyBindings);
}
