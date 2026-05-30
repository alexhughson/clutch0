import { expect, test } from "bun:test";
import type { AppActions, AppState } from "../../app/appTypes";
import { createInitialAppState } from "../../app/appInitialState";
import { createShellCommandOutputContextItem } from "../../lib/context/contextItems";
import { createShellCommandActions } from "./shellCommandWorkflow";

function createHarness(
  initialState: Omit<AppState, "actions"> = createInitialAppState(),
) {
  let state: AppState = {
    ...initialState,
    actions: {} as AppActions,
  };

  const shellCommand = createShellCommandActions({
    get: () => state,
    set: (partial) => {
      const next = typeof partial === "function" ? partial(state) : partial;
      state = { ...state, ...next };
    },
  });

  return {
    get state() {
      return state;
    },
    shellCommand,
  };
}

test("general LLM shell command result moves into the shell command task", () => {
  const harness = createHarness({
    ...createInitialAppState(),
    activeTask: {
      kind: "response",
      request: {
        contextItems: [],
        focusedContextItemId: null,
        id: 1,
        question: "inspect package scripts",
        responseText: "",
        status: "loading",
      },
    },
  });

  harness.shellCommand.finish({
    requestId: 1,
    result: {
      command: "cat package.json",
      durationMs: 10,
      exitCode: 0,
      stderr: "",
      stdout: "{ scripts: {} }",
      timedOut: false,
      truncated: false,
    },
  });

  expect(harness.state.activeTask).toMatchObject({
    kind: "shell-command",
    prompt: "inspect package scripts",
    result: { command: "cat package.json", stdout: "{ scripts: {} }" },
    status: "done",
  });
});

test("rerunning a saved shell command replaces the context item", () => {
  const saved = createShellCommandOutputContextItem({
    createdAt: 1,
    id: "saved:1",
    result: {
      command: "printf old",
      durationMs: 10,
      exitCode: 0,
      stderr: "",
      stdout: "old",
      timedOut: false,
      truncated: false,
    },
    sourceRequestId: 1,
  });
  const harness = createHarness({
    ...createInitialAppState(),
    workspace: {
      ...createInitialAppState().workspace,
      contextItems: [saved],
      focusedContextItemId: saved.id,
    },
  });

  const requestId = harness.shellCommand.start({
    prompt: saved.result.command,
    replacement: { contextItemId: saved.id },
  });
  expect(requestId).toBe(1);

  harness.shellCommand.finish({
    requestId: 1,
    result: {
      command: "printf new",
      durationMs: 12,
      exitCode: 0,
      stderr: "",
      stdout: "new",
      timedOut: false,
      truncated: false,
    },
  });

  expect(harness.state.workspace.contextItems).toHaveLength(1);
  expect(harness.state.workspace.contextItems[0]).toMatchObject({
    id: saved.id,
    result: { command: "printf new", stdout: "new" },
    type: "shell-command-output",
  });
  expect(harness.state.activeTask).toMatchObject({
    kind: "shell-command",
    savedContextItemId: saved.id,
    status: "done",
  });
});

test("shell command output stays in its own task until saved", () => {
  const harness = createHarness();
  const requestId = harness.shellCommand.start({ prompt: "list files" });
  expect(requestId).toBe(1);

  harness.shellCommand.finish({
    requestId: 1,
    result: {
      command: "ls",
      durationMs: 10,
      exitCode: 0,
      stderr: "",
      stdout: "package.json",
      timedOut: false,
      truncated: false,
    },
  });

  expect(harness.state.activeTask?.kind).toBe("shell-command");
  expect(harness.state.workspace.contextItems).toHaveLength(0);

  harness.shellCommand.saveOutputToContext({ requestId: 1 });

  expect(harness.state.activeTask?.kind).toBe("shell-command");
  expect(harness.state.workspace.contextItems).toHaveLength(1);
  expect(harness.state.workspace.contextItems[0]?.type).toBe(
    "shell-command-output",
  );
});
