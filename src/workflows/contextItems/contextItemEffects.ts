import {
  getContextItemById,
  PiAgentContextItem,
  SavedAgentSandboxDiffContextItem,
  SavedDiffContextItem,
} from "../../lib/context/contextItems";
import { applyAgentSandboxDiff } from "../agentAsk/agentSandbox";
import { applyAgentSandboxDiffFromSession } from "../agentAsk/agentAskSessionRegistry";
import { useAppStore } from "../../store/appStore";
import { applyPatchProposalWithRuntimeEvents } from "../patch/patchApplyRuntime";
import { recordSessionRuntimeEvent } from "../../store/appStore";

export async function applyDiffForContextItem(itemId: string) {
  const state = useAppStore.getState();
  const item = getContextItemById(state.workspace.contextItems, itemId);

  if (item instanceof PiAgentContextItem) {
    await applyAgentSandboxDiffFromSession(itemId);
    return;
  }

  await applySavedDiffContextItem(itemId);
}

export async function applySavedDiffContextItem(itemId: string) {
  const state = useAppStore.getState();
  const item = getContextItemById(state.workspace.contextItems, itemId);

  if (
    !(item instanceof SavedDiffContextItem) &&
    !(item instanceof SavedAgentSandboxDiffContextItem)
  ) {
    throw new Error(
      `Cannot apply diff for context item ${itemId}: item is not a saved diff.`,
    );
  }

  useAppStore.getState().actions.contextItems.startSavedDiffApply({ itemId });

  try {
    if (item instanceof SavedDiffContextItem) {
      const result = await applyPatchProposalWithRuntimeEvents({
        contextItemId: item.id,
        proposal: item.proposal,
        requestId: item.sourceRequestId,
      });
      if (result.status === "invalid") {
        useAppStore.getState().actions.contextItems.failSavedDiffApply({
          errorMessage: result.errors
            .map((error) => `${error.path || "<unknown>"}: ${error.message}`)
            .join("\n"),
          itemId,
        });
        return;
      }
    } else {
      await applyAgentSandboxDiff({ diffText: item.diffText });
      recordSessionRuntimeEvent({
        itemId,
        kind: "agent-session.sandbox-diff-applied",
        summary: item.summary,
      });
    }

    useAppStore
      .getState()
      .actions.contextItems.finishSavedDiffApply({ itemId });
  } catch (error) {
    useAppStore.getState().actions.contextItems.failSavedDiffApply({
      errorMessage: error instanceof Error ? error.message : String(error),
      itemId,
    });
  }
}
