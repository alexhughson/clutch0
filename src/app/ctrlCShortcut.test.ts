import type { KeyEvent } from "@opentui/core";
import { expect, test } from "bun:test";
import type { AppTask } from "./appTypes";
import {
  BASE_CTRL_C_EXIT_INTERVAL_MS,
  getCtrlCShortcutDecision,
  isCtrlCKey,
} from "./ctrlCShortcut";

test("recognizes ctrl+c key events", () => {
  expect(isCtrlCKey(keyEvent({ ctrl: true, name: "c" }))).toBe(true);
  expect(isCtrlCKey(keyEvent({ name: "c" }))).toBe(false);
  expect(isCtrlCKey(keyEvent({ ctrl: true, name: "x" }))).toBe(false);
});

test("requires two ctrl+c presses on the base screen to exit", () => {
  expect(
    getCtrlCShortcutDecision({
      activeTask: null,
      lastBaseCtrlCAt: null,
      now: 1000,
    }),
  ).toBe("arm-exit");
  expect(
    getCtrlCShortcutDecision({
      activeTask: null,
      lastBaseCtrlCAt: 1000,
      now: 1000 + BASE_CTRL_C_EXIT_INTERVAL_MS,
    }),
  ).toBe("exit");
});

test("re-arms base ctrl+c exit after the double-press window expires", () => {
  expect(
    getCtrlCShortcutDecision({
      activeTask: null,
      lastBaseCtrlCAt: 1000,
      now: 1000 + BASE_CTRL_C_EXIT_INTERVAL_MS + 1,
    }),
  ).toBe("arm-exit");
});

test("closes an idle context item viewer", () => {
  expect(
    getCtrlCShortcutDecision({
      activeTask: {
        applyStatus: "idle",
        itemId: "file:src/App.tsx",
        kind: "context-item-viewer",
      },
      lastBaseCtrlCAt: null,
      now: 1000,
    }),
  ).toBe("close-task");
});

test("does not close tasks while they are applying or loading", () => {
  expect(
    getCtrlCShortcutDecision({
      activeTask: {
        applyStatus: "applying",
        itemId: "diff:1",
        kind: "context-item-viewer",
      },
      lastBaseCtrlCAt: 1000,
      now: 1100,
    }),
  ).toBe("ignore");
  expect(
    getCtrlCShortcutDecision({
      activeTask: responseTask("streaming"),
      lastBaseCtrlCAt: 1000,
      now: 1100,
    }),
  ).toBe("ignore");
});

test("does not close first-run config with ctrl+c", () => {
  expect(
    getCtrlCShortcutDecision({
      activeTask: {
        configuredProviders: [],
        kind: "config",
        mode: "first-run",
        primary: { model: "gpt-test", provider: "openai" },
        summarization: { model: "gpt-test", provider: "openai" },
      },
      lastBaseCtrlCAt: null,
      now: 1000,
    }),
  ).toBe("ignore");
});

function responseTask(
  status: "done" | "loading" | "streaming",
): Extract<AppTask, { kind: "response" }> {
  return {
    kind: "response",
    request: {
      contextItems: [],
      focusedContextItemId: null,
      id: 1,
      question: "question",
      responseText: "",
      status,
    },
  };
}

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
