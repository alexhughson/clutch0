import { ContextDeck } from "../../app/contextDeck";
import type {
  AppActions,
  AppState,
  ShellCommandReplacementTarget,
} from "../../app/appTypes";
import {
  ShellCommandOutputContextItem,
  createShellCommandOutputContextItem,
  getContextItemById,
  preserveContextItemPlacement,
} from "../../lib/context/contextItems";
import { invariant } from "../../lib/invariant";
import type { ShellCommandResult } from "../../lib/shell/shellCommand";
import { markContextItemRerunStarted } from "../contextItems/regenerateContextItem";
import { runApprovedShellCommand } from "./runApprovedShellCommand";

type SetAppState = (
  partial:
    | Partial<AppState>
    | AppState
    | ((state: AppState) => Partial<AppState> | AppState),
) => void;

type GetAppState = () => AppState;

export function createShellCommandActions({
  get,
  runCommand = runApprovedShellCommand,
  set,
}: {
  get: GetAppState;
  runCommand?: typeof runApprovedShellCommand;
  set: SetAppState;
}): AppActions["shellCommand"] {
  return {
    appendOutput: ({ chunk, outputContextItemId, requestId, stream }) =>
      set((state) =>
        appendShellCommandOutput(state, {
          chunk,
          outputContextItemId,
          requestId,
          stream,
        }),
      ),
    confirmRun: ({ requestId }) =>
      confirmShellCommandRun({ requestId, runCommand, set }),
    fail: ({ errorMessage, requestId }) =>
      set((state) => failShellCommand(state, requestId, errorMessage)),
    finish: ({ outputContextItemId, replacementContextItemId, requestId, result }) =>
      set((state) =>
        finishShellCommand(state, {
          outputContextItemId,
          replacementContextItemId,
          requestId,
          result,
        }),
      ),
    propose: ({ command, requestId }) =>
      set((state) => proposeShellCommand(state, requestId, command)),
    rerun: ({ command, replaceContextItemId }) =>
      rerunShellCommand({
        command,
        replaceContextItemId,
        runCommand,
        set,
      }),
    saveOutputToContext: ({ requestId }) =>
      set((state) => saveShellCommandOutputToContext(state, requestId)),
    start: ({ prompt, rejectComposer, replacement }) =>
      startShellCommand({ get, prompt, rejectComposer, replacement, set }),
  };
}

function rerunShellCommand({
  command,
  replaceContextItemId,
  runCommand,
  set,
}: {
  command: string;
  replaceContextItemId: string;
  runCommand: typeof runApprovedShellCommand;
  set: SetAppState;
}): number | null {
  let requestId: number | null = null;
  set((state) => {
    const existingItem = getShellCommandOutputItemById(state, replaceContextItemId);
    invariant(
      existingItem !== null,
      `Cannot rerun shell command for missing context item ${replaceContextItemId}.`,
    );

    requestId = state.nextLlmRequestId;
    const result = createInProgressShellCommandResult(command);
    return {
      nextLlmRequestId: state.nextLlmRequestId + 1,
      workspace: replacePreservingPlacement(state, existingItem.withResult(result)),
    };
  });

  if (requestId === null) {
    return null;
  }

  markContextItemRerunStarted(replaceContextItemId);
  runCommand({
    command,
    outputContextItemId: replaceContextItemId,
    requestId,
  });
  return requestId;
}

function startShellCommand({
  get,
  prompt,
  rejectComposer,
  replacement,
  set,
}: {
  get: GetAppState;
  prompt: string;
  rejectComposer?: AppState["workspace"]["composer"];
  replacement?: ShellCommandReplacementTarget;
  set: SetAppState;
}): number | null {
  const state = get();
  if (state.activeTask !== null) {
    return null;
  }

  const requestId = state.nextLlmRequestId;
  set({
    activeTask: {
      id: requestId,
      kind: "shell-command",
      prompt,
      ...(rejectComposer === undefined ? {} : { rejectComposer }),
      replacement,
      status: "selecting",
    },
    nextLlmRequestId: requestId + 1,
  });

  return requestId;
}

function proposeShellCommand(
  state: AppState,
  requestId: number,
  command: string,
): Partial<AppState> | AppState {
  if (
    state.activeTask?.kind === "response" &&
    state.activeTask.request.id === requestId
  ) {
    return {
      activeTask: {
        id: requestId,
        kind: "shell-command",
        prompt: state.activeTask.request.question,
        proposedCommand: command,
        ...(state.activeTask.rejectComposer === undefined
          ? {}
          : { rejectComposer: state.activeTask.rejectComposer }),
        status: "awaiting-approval",
      },
    };
  }

  if (
    state.activeTask?.kind !== "shell-command" ||
    state.activeTask.id !== requestId ||
    state.activeTask.status !== "selecting"
  ) {
    return state;
  }

  return {
    activeTask: {
      ...state.activeTask,
      proposedCommand: command,
      status: "awaiting-approval",
    },
  };
}

function confirmShellCommandRun({
  requestId,
  runCommand,
  set,
}: {
  requestId: number;
  runCommand: typeof runApprovedShellCommand;
  set: SetAppState;
}) {
  let approvedCommand: string | null = null;
  let outputContextItemId: string | null = null;
  let replacementContextItemId: string | undefined;
  set((state) => {
    const transition = transitionShellCommandToRunning(state, requestId);
    if (transition === null) {
      return state;
    }
    approvedCommand = transition.command;
    outputContextItemId = transition.outputContextItemId;
    replacementContextItemId = transition.replacementContextItemId;
    return transition.state;
  });

  if (approvedCommand === null || outputContextItemId === null) {
    return;
  }
  if (replacementContextItemId !== undefined) {
    markContextItemRerunStarted(replacementContextItemId);
  }
  runCommand({
    command: approvedCommand,
    outputContextItemId,
    replacementContextItemId,
    requestId,
  });
}

function transitionShellCommandToRunning(
  state: AppState,
  requestId: number,
):
  | {
      command: string;
      outputContextItemId: string;
      replacementContextItemId?: string;
      state: Partial<AppState> | AppState;
    }
  | null {
  if (
    state.activeTask?.kind !== "shell-command" ||
    state.activeTask.id !== requestId ||
    state.activeTask.status !== "awaiting-approval"
  ) {
    return null;
  }

  const { proposedCommand } = state.activeTask;
  invariant(
    proposedCommand !== undefined && proposedCommand.trim().length > 0,
    `shell command task ${requestId} is missing an approved command.`,
  );

  const inProgressResult = createInProgressShellCommandResult(proposedCommand);

  if (state.activeTask.replacement !== undefined) {
    const replacementItemId = state.activeTask.replacement.contextItemId;
    const streamingItemId = `saved:${state.nextContextItemId}`;
    const item = createShellCommandOutputContextItem({
      createdAt: Date.now(),
      id: streamingItemId,
      result: inProgressResult,
      sourceRequestId: requestId,
    });

    return {
      command: proposedCommand,
      outputContextItemId: streamingItemId,
      replacementContextItemId: replacementItemId,
      state: {
        activeTask: null,
        nextContextItemId: state.nextContextItemId + 1,
        workspace: ContextDeck.fromComposeScreen(state.workspace)
          .add(item)
          .applyTo(state.workspace),
      },
    };
  }

  const savedContextItemId = `saved:${state.nextContextItemId}`;
  const item = createShellCommandOutputContextItem({
    createdAt: Date.now(),
    id: savedContextItemId,
    result: inProgressResult,
    sourceRequestId: requestId,
  });

  return {
    command: proposedCommand,
    outputContextItemId: savedContextItemId,
    state: {
      activeTask: null,
      nextContextItemId: state.nextContextItemId + 1,
      workspace: ContextDeck.fromComposeScreen(state.workspace)
        .add(item)
        .applyTo(state.workspace),
    },
  };
}

function createInProgressShellCommandResult(command: string): ShellCommandResult {
  return {
    command,
    durationMs: 0,
    exitCode: null,
    stderr: "",
    stdout: "",
    timedOut: false,
    truncated: false,
  };
}

function finishShellCommand(
  state: AppState,
  {
    outputContextItemId,
    replacementContextItemId,
    requestId,
    result,
  }: {
    outputContextItemId: string;
    replacementContextItemId?: string;
    requestId: number;
    result: ShellCommandResult;
  },
): Partial<AppState> | AppState {
  const outputItem = getShellCommandOutputItemById(state, outputContextItemId);
  if (outputItem === null) {
    return state;
  }

  if (replacementContextItemId === undefined) {
    const finishedItem = outputItem.withResult(result);

    return {
      workspace: replacePreservingPlacement(state, finishedItem),
    };
  }

  const replacementItem = createShellCommandOutputContextItem({
    createdAt: Date.now(),
    id: replacementContextItemId,
    result,
    sourceRequestId: requestId,
  });
  const workspaceWithReplacement = replacePreservingPlacement(
    state,
    replacementItem,
  );
  if (outputContextItemId === replacementContextItemId) {
    return {
      workspace: workspaceWithReplacement,
    };
  }

  return {
    workspace: ContextDeck.fromComposeScreen(workspaceWithReplacement)
      .remove(outputContextItemId)
      .applyTo(workspaceWithReplacement),
  };
}

function getShellCommandOutputItemById(
  state: AppState,
  itemId: string,
): ShellCommandOutputContextItem | null {
  const item = getContextItemById(state.workspace.contextItems, itemId);
  if (item instanceof ShellCommandOutputContextItem) {
    return item;
  }

  return null;
}

function appendShellCommandOutput(
  state: AppState,
  {
    chunk,
    outputContextItemId,
    requestId,
    stream,
  }: {
    chunk: string;
    outputContextItemId: string;
    requestId: number;
    stream: "stderr" | "stdout";
  },
): Partial<AppState> | AppState {
  if (chunk.length === 0) {
    return state;
  }

  const item = getShellCommandOutputItemById(state, outputContextItemId);
  if (item === null) {
    return state;
  }

  const result = appendResultOutput(item.result, stream, chunk);
  const nextItem = item.withResult(result);

  const workspace = replacePreservingPlacement(state, nextItem);
  if (
    state.activeTask?.kind !== "shell-command" ||
    state.activeTask.id !== requestId ||
    state.activeTask.status !== "running"
  ) {
    return {
      workspace,
    };
  }

  return {
    activeTask: {
      ...state.activeTask,
      result,
    },
    workspace,
  };
}

function appendResultOutput(
  result: ShellCommandResult,
  stream: "stderr" | "stdout",
  chunk: string,
): ShellCommandResult {
  if (stream === "stdout") {
    return {
      ...result,
      stdout: `${result.stdout}${chunk}`,
    };
  }

  return {
    ...result,
    stderr: `${result.stderr}${chunk}`,
  };
}

function replacePreservingPlacement(
  state: AppState,
  item: ReturnType<typeof createShellCommandOutputContextItem>,
) {
  const previous = getContextItemById(state.workspace.contextItems, item.id);
  const next =
    previous === null ? item : preserveContextItemPlacement(previous, item);
  return ContextDeck.fromComposeScreen(state.workspace)
    .replace(next)
    .applyTo(state.workspace);
}

function failShellCommand(
  state: AppState,
  requestId: number,
  errorMessage: string,
): Partial<AppState> | AppState {
  if (
    state.activeTask?.kind !== "shell-command" ||
    state.activeTask.id !== requestId ||
    (state.activeTask.status !== "awaiting-approval" &&
      state.activeTask.status !== "running" &&
      state.activeTask.status !== "selecting")
  ) {
    return state;
  }

  return {
    activeTask: {
      ...state.activeTask,
      errorMessage,
      status: "error",
    },
  };
}

function saveShellCommandOutputToContext(
  state: AppState,
  requestId: number,
): Partial<AppState> | AppState {
  if (
    state.activeTask?.kind !== "shell-command" ||
    state.activeTask.id !== requestId ||
    state.activeTask.status !== "done" ||
    state.activeTask.result === undefined ||
    state.activeTask.savedContextItemId !== undefined
  ) {
    return state;
  }

  const itemId = `saved:${state.nextContextItemId}`;
  const item = createShellCommandOutputContextItem({
    createdAt: Date.now(),
    id: itemId,
    result: state.activeTask.result,
    sourceRequestId: requestId,
  });

  return {
    activeTask: {
      ...state.activeTask,
      savedContextItemId: itemId,
    },
    nextContextItemId: state.nextContextItemId + 1,
    workspace: ContextDeck.fromComposeScreen(state.workspace)
      .add(item)
      .applyTo(state.workspace),
  };
}
