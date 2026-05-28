import { useAppStore } from "../../store/appStore";
import { startAgentAskSession } from "./agentAskSessionRegistry";

export function startAgentAskRequest(prompt: string) {
  const itemId = useAppStore.getState().actions.agentAsk.start({ prompt });
  if (itemId === null) {
    return;
  }

  void startAgentAskSession({ itemId, prompt });
}
