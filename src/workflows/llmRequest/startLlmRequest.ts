import type { ContextItemReplacementTarget } from "../../app/appTypes";
import type { ComposerState } from "../../app/appTypes";
import { assembleLlmContextInput } from "../../lib/llm/context";
import {
  LlmCompletionError,
  streamLlmInteraction,
} from "../../lib/llm/streamResponse";
import { useAppStore } from "../../store/appStore";
import { handleLlmWorkflowResult } from "../llmTools/toolRegistry";

export function startLlmRequest(
  question: string,
  options: {
    allowedToolNames?: readonly string[];
    commandDirective?: string;
    rejectComposer?: ComposerState;
    replacement?: ContextItemReplacementTarget;
  } = {},
) {
  const currentState = useAppStore.getState();
  const { contextItems, focusedContextItemId } = assembleLlmContextInput({
    automaticContextItems: currentState.workspace.automaticContextItems,
    contextItems: currentState.workspace.contextItems,
    excludedContextItemId: options.replacement?.contextItemId,
    focusedContextItemId: currentState.workspace.focusedContextItemId,
  });
  const requestId = currentState.actions.compose.startLlmRequest({
    question,
    rejectComposer: options.rejectComposer,
    replacement: options.replacement,
  });
  if (requestId === null) {
    return;
  }

  void streamLlmInteraction({
    allowedToolNames: options.allowedToolNames,
    commandDirective: options.commandDirective,
    question,
    contextItems,
    focusedContextItemId,
    onDelta: (delta) => {
      useAppStore.getState().actions.response.appendDelta({ delta, requestId });
    },
  }).then(
    (result) => {
      if (result.kind === "text") {
        useAppStore.getState().actions.response.finish({
          requestId,
          responseKind: "text",
          responseText: result.responseText,
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
      useAppStore.getState().actions.response.fail({
        errorMessage: error instanceof Error ? error.message : String(error),
        requestId,
        responseText:
          error instanceof LlmCompletionError ? error.debugOutput : undefined,
      });
    },
  );
}
