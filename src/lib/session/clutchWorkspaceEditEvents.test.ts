import { expect, test } from "bun:test";
import {
  getWorkspaceEditTriggerItemId,
  isClutchWorkspaceEditEvent,
} from "./clutchWorkspaceEditEvents";

test("accepts successful clutch apply events", () => {
  expect(
    isClutchWorkspaceEditEvent({
      kind: "patch-apply.end",
      success: true,
    }),
  ).toBe(true);
  expect(
    isClutchWorkspaceEditEvent({
      kind: "create-file.apply.end",
      success: true,
    }),
  ).toBe(true);
  expect(
    isClutchWorkspaceEditEvent({
      kind: "agent-session.sandbox-diff-applied",
      itemId: "agent:1",
    }),
  ).toBe(true);
});

test("rejects failed applies and non-edit events", () => {
  expect(
    isClutchWorkspaceEditEvent({
      kind: "patch-apply.end",
      success: false,
    }),
  ).toBe(false);
  expect(
    isClutchWorkspaceEditEvent({
      kind: "patch-apply.begin",
    }),
  ).toBe(false);
  expect(
    isClutchWorkspaceEditEvent({
      kind: "shell-command.finished",
    }),
  ).toBe(false);
  expect(
    isClutchWorkspaceEditEvent({
      kind: "llm.finished",
    }),
  ).toBe(false);
  expect(
    isClutchWorkspaceEditEvent({
      kind: "create-file.apply.end",
      success: false,
    }),
  ).toBe(false);
});

test("reads the triggering item id from apply payloads", () => {
  expect(
    getWorkspaceEditTriggerItemId({
      contextItemId: "diff:1",
      kind: "patch-apply.end",
    }),
  ).toBe("diff:1");
  expect(
    getWorkspaceEditTriggerItemId({
      itemId: "agent:1",
      kind: "agent-session.sandbox-diff-applied",
    }),
  ).toBe("agent:1");
});
