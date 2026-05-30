import type { KeyEvent } from "@opentui/core";
import {
  getKeyAction,
  getVerticalNavigationDirection,
  type KeyBinding,
} from "../../lib/keymap";

export type MessageComposerKeyAction =
  | "accept-suggestion"
  | "confirm"
  | "select-next-file"
  | "select-previous-file";

const messageComposerKeyBindings: KeyBinding<MessageComposerKeyAction>[] = [
  { name: "return", action: "confirm" },
  { name: "kpenter", action: "confirm" },
  { name: "linefeed", action: "confirm" },
  { name: "tab", action: "accept-suggestion" },
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
