import type { KeyEvent } from "@opentui/core";
import { expect, test } from "bun:test";
import type { ContextItemAction } from "../../types";
import {
  formatContextItemAction,
  getContextItemActionForKeyEvent,
} from "./contextItemActions";

const rerunAction: ContextItemAction = {
  id: "rerun",
  label: "rerun",
  shortcut: { ctrl: true, display: "Ctrl+r", name: "r" },
  run: () => {},
};

test("matches context item actions by exact shortcut modifiers", () => {
  expect(
    getContextItemActionForKeyEvent({
      actions: [rerunAction],
      event: keyEvent({ ctrl: true, name: "r" }),
    }),
  ).toBe(rerunAction);

  expect(
    getContextItemActionForKeyEvent({
      actions: [rerunAction],
      event: keyEvent({ name: "r" }),
    }),
  ).toBeNull();
});

test("formats context item action shortcuts", () => {
  expect(formatContextItemAction(rerunAction)).toBe("Ctrl+r rerun");
});

function keyEvent(event: Partial<KeyEvent> & { name: string }): KeyEvent {
  return {
    ctrl: false,
    eventType: "press",
    meta: false,
    number: false,
    option: false,
    raw: event.name,
    sequence: event.name,
    shift: false,
    source: "raw",
    ...event,
  } as KeyEvent;
}
