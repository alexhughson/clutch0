import { expect, test } from "bun:test";
import type { AppActions, AppState } from "../../app/appTypes";
import { createInitialAppState } from "../../app/appInitialState";
import { createShellCommandActions } from "./shellCommandWorkflow";

function createHarness() {
  let state: AppState = {
    ...createInitialAppState(),
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
