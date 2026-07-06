import {
  LlmCompletionError,
  streamLlmInteraction,
} from "../../lib/llm/streamResponse";
import type { ComposerState } from "../../app/appTypes";
import { runShellCommand } from "../../lib/shell/shellCommand";
import { createRuntimeAbortHandle } from "../../lib/session/runtimeInterrupts";
import { recordSessionRuntimeEvent, useAppStore } from "../../store/appStore";
import { RUN_SHELL_COMMAND_TOOL_NAME } from "../llmTools/shellCommandWorkflowTool";
import { handleLlmWorkflowResult } from "../llmTools/toolRegistry";

export function startShellCommandRequest(
  prompt: string,
  options: { commandDirective: string; rejectComposer?: ComposerState },
) {
  const currentState = useAppStore.getState();
  const requestId = currentState.actions.shellCommand.start({
    prompt,
    rejectComposer: options.rejectComposer,
  });
  if (requestId === null) {
    return;
  }

  const abortHandle = createRuntimeAbortHandle();
  recordSessionRuntimeEvent({
    kind: "shell-command.selection-started",
    requestId,
  });
  void streamLlmInteraction({
    allowedToolNames: [RUN_SHELL_COMMAND_TOOL_NAME],
    commandDirective: options.commandDirective,
    contextItems: currentState.workspace.contextItems,
    focusedContextItemId: currentState.workspace.focusedContextItemId,
    question: prompt,
    signal: abortHandle.signal,
  }).then(
    (result) => {
      abortHandle.dispose();
      if (result.kind === "text") {
        recordSessionRuntimeEvent({
          kind: "shell-command.selection-failed",
          reason: "model-returned-text",
          requestId,
        });
        useAppStore.getState().actions.shellCommand.fail({
          errorMessage:
            "The model did not run a shell command. Try a more specific /cmd request.",
          requestId,
        });
        return;
      }

      recordSessionRuntimeEvent({
        kind: "shell-command.selection-finished",
        requestId,
        resultKind: result.kind,
      });
      handleLlmWorkflowResult({
        actions: useAppStore.getState().actions,
        requestId,
        result,
      });
    },
    (error: unknown) => {
      abortHandle.dispose();
      recordSessionRuntimeEvent({
        errorMessage:
          error instanceof LlmCompletionError
            ? error.debugOutput
            : error instanceof Error
              ? error.message
              : String(error),
        kind: "shell-command.selection-failed",
        requestId,
      });
      useAppStore.getState().actions.shellCommand.fail({
        errorMessage:
          error instanceof LlmCompletionError
            ? error.debugOutput
            : error instanceof Error
              ? error.message
              : String(error),
        requestId,
      });
    },
  );
}

export function startShellCommandRerun({
  command,
  replaceContextItemId,
}: {
  command: string;
  replaceContextItemId: string;
}) {
  const requestId = useAppStore.getState().actions.shellCommand.start({
    prompt: command,
    replacement: { contextItemId: replaceContextItemId },
  });
  if (requestId === null) {
    return;
  }

  const abortHandle = createRuntimeAbortHandle();
  recordSessionRuntimeEvent({
    command,
    kind: "shell-command.started",
    requestId,
  });
  void runShellCommand({ command, signal: abortHandle.signal }).then(
    (result) => {
      abortHandle.dispose();
      recordSessionRuntimeEvent({
        command: result.command,
        exitCode: result.exitCode,
        kind: "shell-command.finished",
        requestId,
        signal: result.signal,
        timedOut: result.timedOut,
      });
      useAppStore.getState().actions.shellCommand.finish({
        requestId,
        result,
      });
    },
    (error: unknown) => {
      abortHandle.dispose();
      recordSessionRuntimeEvent({
        errorMessage: error instanceof Error ? error.message : String(error),
        kind: "shell-command.failed",
        requestId,
      });
      useAppStore.getState().actions.shellCommand.fail({
        errorMessage: error instanceof Error ? error.message : String(error),
        requestId,
      });
    },
  );
}
