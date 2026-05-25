import type { ContextItemReplacementTarget } from "../../app/appTypes";
import { streamLlmInteraction } from "../../lib/llm/streamResponse";
import { useAppStore } from "../../store/appStore";
import { handleLlmInteractionResult } from "../llmTools/handleLlmInteractionResult";

export function startLlmRequest(
  question: string,
  options: { replacement?: ContextItemReplacementTarget } = {},
) {
  const currentState = useAppStore.getState();
  const contextItems = currentState.workspace.contextItems.filter(
    (item) => item.id !== options.replacement?.contextItemId,
  );
  const focusedContextItemId = contextItems.some(
    (item) => item.id === currentState.workspace.focusedContextItemId,
  )
    ? currentState.workspace.focusedContextItemId
    : null;
  const requestId = currentState.actions.compose.startLlmRequest({
    question,
    replacement: options.replacement,
  });
  if (requestId === null) {
    return;
  }

  void streamLlmInteraction({
    question,
    contextItems,
    focusedContextItemId,
    onDelta: (delta) => {
      useAppStore.getState().actions.response.appendDelta({ delta, requestId });
    },
  }).then(
    (result) => {
      handleLlmInteractionResult({
        actions: useAppStore.getState().actions,
        requestId,
        result,
      });
    },
    (error: unknown) => {
      useAppStore.getState().actions.response.fail({
        errorMessage: error instanceof Error ? error.message : String(error),
        requestId,
      });
    },
  );
}
