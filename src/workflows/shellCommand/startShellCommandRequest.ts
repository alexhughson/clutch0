import { streamLlmInteraction } from "../../lib/llm/streamResponse";
import { useAppStore } from "../../store/appStore";
import { RUN_SHELL_COMMAND_TOOL_NAME } from "../llmTools/shellCommandWorkflowTool";

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
      if (result.kind !== "command-output") {
        useAppStore.getState().actions.shellCommand.fail({
          errorMessage:
            "The model did not run a shell command. Try a more specific /cmd request.",
          requestId,
        });
        return;
      }

      useAppStore.getState().actions.shellCommand.finish({
        requestId,
        result: result.result,
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
