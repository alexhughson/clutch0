import { ContextDeck } from "../../app/contextDeck";
import type {
  AppActions,
  AppState,
  ShellCommandTaskState,
  ShellCommandReplacementTarget,
} from "../../app/appTypes";
import {
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
    appendOutput: ({ chunk, requestId, stream }) =>
      set((state) => appendShellCommandOutput(state, requestId, stream, chunk)),
    confirmRun: ({ requestId }) =>
      confirmShellCommandRun({ requestId, runCommand, set }),
    fail: ({ errorMessage, requestId }) =>
      set((state) => failShellCommand(state, requestId, errorMessage)),
    finish: ({ requestId, result }) =>
      set((state) => finishShellCommand(state, requestId, result)),
    propose: ({ command, requestId }) =>
      set((state) => proposeShellCommand(state, requestId, command)),
    saveOutputToContext: ({ requestId }) =>
      set((state) => saveShellCommandOutputToContext(state, requestId)),
    start: ({ prompt, rejectComposer, replacement }) =>
      startShellCommand({ get, prompt, rejectComposer, replacement, set }),
  };
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
  let replacementContextItemId: string | undefined;
  set((state) => {
    const transition = transitionShellCommandToRunning(state, requestId);
    if (transition === null) {
      return state;
    }
    approvedCommand = transition.command;
    replacementContextItemId = transition.replacementContextItemId;
    return transition.state;
  });

  if (approvedCommand === null) {
    return;
  }
  if (replacementContextItemId !== undefined) {
    markContextItemRerunStarted(replacementContextItemId);
  }
  runCommand({
    command: approvedCommand,
    requestId,
  });
}

function transitionShellCommandToRunning(
  state: AppState,
  requestId: number,
):
  | {
      command: string;
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
      replacementContextItemId: replacementItemId,
      state: {
        activeTask: {
          ...state.activeTask,
          result: inProgressResult,
          savedContextItemId: streamingItemId,
          status: "running",
        },
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
    state: {
      activeTask: {
        ...state.activeTask,
        result: inProgressResult,
        savedContextItemId,
        status: "running",
      },
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
  requestId: number,
  result: ShellCommandResult,
): Partial<AppState> | AppState {
  if (
    state.activeTask?.kind !== "shell-command" ||
    state.activeTask.id !== requestId ||
    state.activeTask.status !== "running"
  ) {
    return state;
  }

  if (state.activeTask.savedContextItemId !== undefined) {
    if (state.activeTask.replacement !== undefined) {
      const replacementItemId = state.activeTask.replacement.contextItemId;
      const replacementItem = createShellCommandOutputContextItem({
        createdAt: Date.now(),
        id: replacementItemId,
        result,
        sourceRequestId: requestId,
      });
      const updatedWorkspace = replacePreservingPlacement(state, replacementItem);
      const workspace =
        state.activeTask.savedContextItemId === replacementItemId
          ? updatedWorkspace
          : ContextDeck.fromComposeScreen(updatedWorkspace)
              .remove(state.activeTask.savedContextItemId)
              .applyTo(updatedWorkspace);

      return {
        activeTask: {
          ...state.activeTask,
          result,
          savedContextItemId: replacementItemId,
          status: "done",
        },
        workspace,
      };
    }

    const item = createShellCommandOutputContextItem({
      createdAt: Date.now(),
      id: state.activeTask.savedContextItemId,
      result,
      sourceRequestId: requestId,
    });

    return {
      activeTask: {
        ...state.activeTask,
        result,
        savedContextItemId: item.id,
        status: "done",
      },
      workspace: replacePreservingPlacement(state, item),
    };
  }

  return {
    activeTask: {
      ...state.activeTask,
      result,
      status: "done",
    },
  };
}

function appendShellCommandOutput(
  state: AppState,
  requestId: number,
  stream: "stderr" | "stdout",
  chunk: string,
): Partial<AppState> | AppState {
  if (
    state.activeTask?.kind !== "shell-command" ||
    state.activeTask.id !== requestId ||
    state.activeTask.status !== "running" ||
    state.activeTask.result === undefined ||
    chunk.length === 0
  ) {
    return state;
  }

  const result = appendResultOutput(state.activeTask.result, stream, chunk);
  const activeTask: ShellCommandTaskState = {
    ...state.activeTask,
    result,
  };

  if (state.activeTask.savedContextItemId === undefined) {
    return { activeTask };
  }

  const item = createShellCommandOutputContextItem({
    createdAt: Date.now(),
    id: state.activeTask.savedContextItemId,
    result,
    sourceRequestId: requestId,
  });

  return {
    activeTask,
    workspace: replacePreservingPlacement(state, item),
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
