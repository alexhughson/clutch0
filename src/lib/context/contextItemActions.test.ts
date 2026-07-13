import type { KeyEvent } from "@opentui/core";
import { expect, test } from "bun:test";
import type { ContextItemAction } from "../../types";
import {
  formatContextItemAction,
  formatPaneActionHints,
  getContextItemActionForKeyEvent,
  getContextItemActionForPaneKeyEvent,
} from "./contextItemActions";

const rerunAction: ContextItemAction = {
  command: {
    expectedResult: "text",
    itemId: "saved:1",
    kind: "rerun-prompt",
    prompt: "question",
  },
  id: "rerun",
  label: "rerun",
  shortcut: { ctrl: true, display: "Ctrl+r", name: "r" },
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

test("matches pane shortcuts without modifier keys", () => {
  const applyAction: ContextItemAction = {
    command: { itemId: "diff:1", kind: "apply-diff" },
    id: "apply",
    label: "apply",
    paneShortcut: { display: "a", name: "a" },
    shortcut: { ctrl: true, display: "Ctrl+y", name: "y" },
  };

  expect(
    getContextItemActionForPaneKeyEvent({
      actions: [applyAction],
      event: keyEvent({ name: "a" }),
    }),
  ).toBe(applyAction);
  expect(
    getContextItemActionForPaneKeyEvent({
      actions: [applyAction],
      event: keyEvent({ ctrl: true, name: "y" }),
    }),
  ).toBeNull();
  expect(formatPaneActionHints([applyAction, rerunAction])).toBe("a apply");
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
