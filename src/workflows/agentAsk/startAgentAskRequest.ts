import { assembleLlmContextInput } from "../../lib/llm/context";
import { createRuntimeAbortHandle } from "../../lib/session/runtimeInterrupts";
import { useAppStore } from "../../store/appStore";
import type { ComposerState } from "../../app/appTypes";
import type { AgentAskMode } from "../../types";
import { startAgentAskSession } from "./agentAskSessionRegistry";

export function startAgentAskRequest(
  prompt: string,
  {
    mode = "ask",
    rejectComposer,
  }: {
    mode?: AgentAskMode;
    rejectComposer?: ComposerState;
  } = {},
) {
  const state = useAppStore.getState();
  const { contextItems, focusedContextItemId } = assembleLlmContextInput({
    automaticContextItems: state.workspace.automaticContextItems,
    contextItems: state.workspace.contextItems,
    focusedContextItemId: state.workspace.focusedContextItemId,
  });
  const itemId = state.actions.agentAsk.start({
    mode,
    prompt,
    rejectComposer,
  });
  if (itemId === null) {
    return;
  }

  const abortHandle = createRuntimeAbortHandle();
  void startAgentAskSession({
    contextItems,
    focusedContextItemId,
    itemId,
    mode,
    prompt,
    signal: abortHandle.signal,
  }).finally(() => {
    abortHandle.dispose();
  });
}

export function startAgentEditRequest(
  prompt: string,
  options: { rejectComposer?: ComposerState } = {},
) {
  startAgentAskRequest(prompt, { mode: "edit", ...options });
}
