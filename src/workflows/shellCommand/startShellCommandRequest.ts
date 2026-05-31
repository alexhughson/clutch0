import {
  LlmCompletionError,
  streamLlmInteraction,
} from "../../lib/llm/streamResponse";
import { runShellCommand } from "../../lib/shell/shellCommand";
import { useAppStore } from "../../store/appStore";
import { RUN_SHELL_COMMAND_TOOL_NAME } from "../llmTools/shellCommandWorkflowTool";
import { handleLlmWorkflowResult } from "../llmTools/toolRegistry";

export function startShellCommandRequest(
  prompt: string,
  options: { commandDirective: string },
) {
  const currentState = useAppStore.getState();
  const requestId = currentState.actions.shellCommand.start({ prompt });
  if (requestId === null) {
    return;
  }

  void streamLlmInteraction({
    allowedToolNames: [RUN_SHELL_COMMAND_TOOL_NAME],
    commandDirective: options.commandDirective,
    contextItems: currentState.workspace.contextItems,
    focusedContextItemId: currentState.workspace.focusedContextItemId,
    question: prompt,
  }).then(
    (result) => {
      if (result.kind === "text") {
        useAppStore.getState().actions.shellCommand.fail({
          errorMessage:
            "The model did not run a shell command. Try a more specific /cmd request.",
          requestId,
        });
        return;
      }

      handleLlmWorkflowResult({
        actions: useAppStore.getState().actions,
        requestId,
        result,
      });
    },
    (error: unknown) => {
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

  void runShellCommand({ command }).then(
    (result) => {
      useAppStore.getState().actions.shellCommand.finish({
        requestId,
        result,
      });
    },
    (error: unknown) => {
      useAppStore.getState().actions.shellCommand.fail({
        errorMessage: error instanceof Error ? error.message : String(error),
        requestId,
      });
    },
  );
}
