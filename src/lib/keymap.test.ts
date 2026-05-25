import type { KeyEvent } from "@opentui/core";
import { expect, test } from "bun:test";
import {
  getKeyAction,
  getVerticalNavigationDirection,
  type KeyBinding,
} from "./keymap";

type TestAction = "next" | "previous";

const bindings: KeyBinding<TestAction>[] = [
  { name: "down", action: "next" },
  { name: "n", ctrl: true, action: "next" },
  { name: "up", action: "previous" },
  { name: "p", ctrl: true, action: "previous" },
];

test("maps a key event to an abstract action", () => {
  expect(getKeyAction(keyEvent({ name: "down" }), bindings)).toBe("next");
  expect(getKeyAction(keyEvent({ name: "p", ctrl: true }), bindings)).toBe(
    "previous",
  );
});

test("requires modifiers to match exactly", () => {
  expect(getKeyAction(keyEvent({ name: "down", ctrl: true }), bindings)).toBe(
    null,
  );
  expect(getKeyAction(keyEvent({ name: "n" }), bindings)).toBe(null);
});

test("maps shared vertical navigation keys", () => {
  expect(getVerticalNavigationDirection(keyEvent({ name: "down" }))).toBe(
    "next",
  );
  expect(
    getVerticalNavigationDirection(keyEvent({ name: "n", ctrl: true })),
  ).toBe("next");
  expect(getVerticalNavigationDirection(keyEvent({ name: "up" }))).toBe(
    "previous",
  );
  expect(
    getVerticalNavigationDirection(keyEvent({ name: "p", ctrl: true })),
  ).toBe("previous");
  expect(getVerticalNavigationDirection(keyEvent({ name: "j" }))).toBe(null);
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
