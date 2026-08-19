import {
  LlmCompletionError,
  streamLlmInteraction,
} from "../../lib/llm/streamResponse";
import type { ComposerState } from "../../app/appTypes";
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
      if (result.kind !== "command-proposal") {
        recordSessionRuntimeEvent({
          kind: "shell-command.selection-failed",
          reason: `unexpected-result-kind:${result.kind}`,
          requestId,
        });
        useAppStore.getState().actions.shellCommand.fail({
          errorMessage:
            "The model proposed a non-command workflow. Try a direct shell command request.",
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

  recordSessionRuntimeEvent({
    command,
    kind: "shell-command.selection-finished",
    requestId,
    resultKind: "command-proposal",
  });
  useAppStore.getState().actions.shellCommand.propose({
    command,
    requestId,
  });
}
