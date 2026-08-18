import { assembleLlmContextInput } from "../../lib/llm/context";
import { createRuntimeAbortHandle } from "../../lib/session/runtimeInterrupts";
import { useAppStore } from "../../store/appStore";
import type { ComposerState } from "../../app/appTypes";
import { startAgentSession } from "./agentAskSessionRegistry";

export function startAgentRequest(
  prompt: string,
  { rejectComposer }: { rejectComposer?: ComposerState } = {},
) {
  const state = useAppStore.getState();
  const { contextItems, focusedContextItemId } = assembleLlmContextInput({
    automaticContextItems: state.workspace.automaticContextItems,
    contextItems: state.workspace.contextItems,
    focusedContextItemId: state.workspace.focusedContextItemId,
  });
  const itemId = state.actions.agentAsk.start({
    prompt,
    rejectComposer,
  });
  if (itemId === null) {
    return;
  }

  const abortHandle = createRuntimeAbortHandle();
  void startAgentSession({
    contextItems,
    focusedContextItemId,
    itemId,
    prompt,
    signal: abortHandle.signal,
  }).finally(() => {
    abortHandle.dispose();
  });
}
