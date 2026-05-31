import { useAppStore } from "../../store/appStore";
import type { AgentAskMode } from "../../types";
import { startAgentAskSession } from "./agentAskSessionRegistry";

export function startAgentAskRequest(
  prompt: string,
  { mode = "ask" }: { mode?: AgentAskMode } = {},
) {
  const state = useAppStore.getState();
  const contextItems = [...state.workspace.contextItems];
  const focusedContextItemId = contextItems.some(
    (item) => item.id === state.workspace.focusedContextItemId,
  )
    ? state.workspace.focusedContextItemId
    : null;
  const itemId = state.actions.agentAsk.start({ mode, prompt });
  if (itemId === null) {
    return;
  }

  void startAgentAskSession({
    contextItems,
    focusedContextItemId,
    itemId,
    mode,
    prompt,
  });
}

export function startAgentEditRequest(prompt: string) {
  startAgentAskRequest(prompt, { mode: "edit" });
}
