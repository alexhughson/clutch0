import type { KeyEvent } from "@opentui/core";
import { getKeyAction, type KeyBinding } from "../../lib/keymap";

export type MessageComposerKeyAction =
  | "confirm"
  | "select-next-file"
  | "select-previous-file";

const messageComposerKeyBindings: KeyBinding<MessageComposerKeyAction>[] = [
  { name: "return", action: "confirm" },
  { name: "kpenter", action: "confirm" },
  { name: "linefeed", action: "confirm" },
  { name: "down", action: "select-next-file" },
  { name: "n", ctrl: true, action: "select-next-file" },
  { name: "up", action: "select-previous-file" },
  { name: "p", ctrl: true, action: "select-previous-file" },
];

export function getMessageComposerKeyAction(
  event: KeyEvent,
): MessageComposerKeyAction | null {
  return getKeyAction(event, messageComposerKeyBindings);
}
