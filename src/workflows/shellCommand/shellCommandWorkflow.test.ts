import { expect, test } from "bun:test";
import type { AppActions, AppState } from "../../app/appTypes";
import { createInitialAppState } from "../../app/appInitialState";
import { createShellCommandOutputContextItem } from "../../lib/context/contextItems";
import { createShellCommandActions } from "./shellCommandWorkflow";

function createHarness(
  initialState: Omit<AppState, "actions"> = createInitialAppState(),
) {
  const runCalls: {
    command: string;
    outputContextItemId: string;
    replacementContextItemId?: string;
    requestId: number;
    root?: string;
  }[] = [];
  let state: AppState = {
    ...initialState,
    actions: {} as AppActions,
  };

  const shellCommand = createShellCommandActions({
    get: () => state,
    runCommand: (options) => {
      runCalls.push(options);
    },
    set: (partial) => {
      const next = typeof partial === "function" ? partial(state) : partial;
      state = { ...state, ...next };
    },
  });

  return {
    get state() {
      return state;
    },
    runCalls,
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

  harness.shellCommand.propose({
    command: "cat package.json",
    requestId: 1,
  });

  expect(harness.state.activeTask).toMatchObject({
    kind: "shell-command",
    prompt: "inspect package scripts",
    status: "awaiting-approval",
  });
  if (harness.state.activeTask?.kind !== "shell-command") {
    throw new Error("Expected shell-command task.");
  }
  expect(harness.state.activeTask.proposedCommand).toBe("cat package.json");
});

test("running shell command output replaces the saved context item", () => {
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
  })
    .withPinned(true)
    .withAutoRegenerate(true);

  const harness = createHarness({
    ...createInitialAppState(),
    workspace: {
      ...createInitialAppState().workspace,
      contextItems: [saved],
      focusedContextItemId: saved.id,
    },
  });

  harness.shellCommand.finish({
    outputContextItemId: saved.id,
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
  expect(harness.state.activeTask).toBeNull();
  expect(harness.state.workspace.contextItems[0]?.isPinned()).toBe(true);
  expect(
    harness.state.workspace.contextItems[0]?.getAutoRegenerate?.(),
  ).toBe(true);
});

test("replacement finish keeps prior item until completion and removes stream item", () => {
  const previous = createShellCommandOutputContextItem({
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
  const streaming = createShellCommandOutputContextItem({
    createdAt: 2,
    id: "saved:2",
    result: {
      command: "printf old",
      durationMs: 0,
      exitCode: null,
      stderr: "",
      stdout: "partial",
      timedOut: false,
      truncated: false,
    },
    sourceRequestId: 2,
  });
  const harness = createHarness({
    ...createInitialAppState(),
    workspace: {
      ...createInitialAppState().workspace,
      contextItems: [previous, streaming],
      focusedContextItemId: previous.id,
    },
  });

  harness.shellCommand.finish({
    outputContextItemId: streaming.id,
    replacementContextItemId: previous.id,
    requestId: 2,
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
    id: "saved:1",
    result: { stdout: "new" },
    type: "shell-command-output",
  });
  expect(harness.state.activeTask).toBeNull();
});

test("shell command stream chunks update context output item", () => {
  const runningItem = createShellCommandOutputContextItem({
    createdAt: 1,
    id: "saved:1",
    result: {
      command: "ls",
      durationMs: 0,
      exitCode: null,
      stderr: "",
      stdout: "",
      timedOut: false,
      truncated: false,
    },
    sourceRequestId: 1,
  });
  const harness = createHarness({
    ...createInitialAppState(),
    workspace: {
      ...createInitialAppState().workspace,
      contextItems: [runningItem],
    },
  });

  harness.shellCommand.appendOutput({
    chunk: "package.json\n",
    outputContextItemId: "saved:1",
    requestId: 1,
    stream: "stdout",
  });
  harness.shellCommand.appendOutput({
    chunk: "warning\n",
    outputContextItemId: "saved:1",
    requestId: 1,
    stream: "stderr",
  });

  expect(harness.state.activeTask).toBeNull();
  expect(harness.state.workspace.contextItems[0]).toMatchObject({
    id: "saved:1",
    result: {
      stderr: "warning\n",
      stdout: "package.json\n",
    },
    type: "shell-command-output",
  });
});

test("confirm run moves from approval to running and creates context item", () => {
  const harness = createHarness();
  const requestId = harness.shellCommand.start({ prompt: "list files" });
  expect(requestId).toBe(1);
  harness.shellCommand.propose({
    command: "ls",
    requestId: 1,
  });

  harness.shellCommand.confirmRun({ requestId: 1 });

  expect(harness.state.activeTask).toBeNull();
  expect(harness.state.workspace.contextItems).toHaveLength(1);
  expect(harness.state.workspace.contextItems[0]).toMatchObject({
    id: "saved:1",
    result: { command: "ls", stderr: "", stdout: "" },
    type: "shell-command-output",
  });
  expect(harness.runCalls).toEqual([
    {
      command: "ls",
      outputContextItemId: "saved:1",
      requestId: 1,
    },
  ]);
});

test("rerun starts immediately and reuses existing context item", () => {
  const previous = createShellCommandOutputContextItem({
    createdAt: 1,
    id: "saved:44",
    result: {
      command: "npm test",
      durationMs: 12,
      exitCode: 0,
      stderr: "",
      stdout: "old output",
      timedOut: false,
      truncated: false,
    },
    sourceRequestId: 9,
  });
  const harness = createHarness({
    ...createInitialAppState(),
    workspace: {
      ...createInitialAppState().workspace,
      contextItems: [previous],
      focusedContextItemId: previous.id,
    },
  });

  const requestId = harness.shellCommand.rerun({
    command: "npm test",
    replaceContextItemId: previous.id,
  });
  expect(requestId).toBe(1);
  expect(harness.state.activeTask).toBeNull();
  expect(harness.state.workspace.contextItems).toHaveLength(1);
  expect(harness.state.workspace.contextItems[0]).toMatchObject({
    id: previous.id,
    result: {
      command: "npm test",
      stderr: "",
      stdout: "",
    },
    type: "shell-command-output",
  });
  expect(harness.runCalls).toEqual([
    {
      command: "npm test",
      outputContextItemId: "saved:44",
      requestId: 1,
    },
  ]);
});
