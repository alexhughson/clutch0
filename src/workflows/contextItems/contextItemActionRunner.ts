import type { ContextItemAction } from "../../types";
import {
  disposeAgentAskSession,
  saveAgentSandboxDiffToContext,
} from "../agentAsk/agentAskSessionRegistry";
import { startLlmRequest } from "../llmRequest/startLlmRequest";
import { startShellCommandRerun } from "../shellCommand/startShellCommandRequest";
import { useAppStore } from "../../store/appStore";
import { applySavedDiffContextItem } from "./contextItemEffects";

export function runContextItemAction({
  action,
  closeAfterRemove,
}: {
  action: ContextItemAction;
  closeAfterRemove: boolean;
}) {
  void action.run({
    applyAgentSandboxDiff: (itemId) => {
      void applySavedDiffContextItem(itemId);
    },
    applySavedDiff: (itemId) => {
      void applySavedDiffContextItem(itemId);
    },
    openContextItem: (itemId) => {
      useAppStore.getState().actions.contextItems.openContextItem({ itemId });
    },
    removeContextItem: (itemId) => {
      disposeAgentAskSession(itemId);
      useAppStore.getState().actions.compose.removeContextItem({ itemId });
      if (closeAfterRemove) {
        useAppStore.getState().actions.navigation.dismissPane();
      }
    },
    rerunPrompt: ({ expectedResult, prompt, replaceContextItemId }) =>
      startLlmRequest(prompt, {
        replacement: {
          contextItemId: replaceContextItemId,
          expectedResult,
        },
      }),
    rerunShellCommand: ({ command, replaceContextItemId }) =>
      startShellCommandRerun({ command, replaceContextItemId }),
    saveAgentSandboxDiff: (itemId) => {
      void saveAgentSandboxDiffToContext(itemId);
    },
  });
}
