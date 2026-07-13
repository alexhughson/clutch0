import {
  disposeAgentAskSession,
  saveAgentSandboxDiffToContext,
} from "../agentAsk/agentAskSessionRegistry";
import { startLlmRequest } from "../llmRequest/startLlmRequest";
import { startShellCommandRerun } from "../shellCommand/startShellCommandRequest";
import { useAppStore } from "../../store/appStore";
import { assertNever } from "../../lib/invariant";
import type { ContextItemAction } from "../../types";
import { applySavedDiffContextItem } from "./contextItemEffects";

export function runContextItemAction({
  action,
  closeAfterRemove,
}: {
  action: ContextItemAction;
  closeAfterRemove: boolean;
}) {
  const command = action.command;

  switch (command.kind) {
    case "open":
      useAppStore.getState().actions.contextItems.openContextItem({
        itemId: command.itemId,
      });
      return;
    case "remove":
      void disposeAgentAskSession(command.itemId);
      useAppStore.getState().actions.compose.removeContextItem({
        itemId: command.itemId,
      });
      if (closeAfterRemove) {
        useAppStore.getState().actions.navigation.dismissPane();
      }
      return;
    case "apply-diff":
      void applySavedDiffContextItem(command.itemId);
      return;
    case "rerun-prompt":
      startLlmRequest(command.prompt, {
        replacement: {
          contextItemId: command.itemId,
          expectedResult: command.expectedResult,
        },
      });
      return;
    case "rerun-shell":
      startShellCommandRerun({
        command: command.command,
        replaceContextItemId: command.itemId,
      });
      return;
    case "save-agent-diff":
      void saveAgentSandboxDiffToContext(command.itemId);
      return;
    default:
      return assertNever(command, "Unhandled context item action command");
  }
}
