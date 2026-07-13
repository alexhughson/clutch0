import { getContextItemById } from "../../lib/context/contextItemFactories";
import { applyAgentSandboxDiff } from "../agentAsk/agentSandbox";
import { useAppStore } from "../../store/appStore";
import { applyPatchProposalWithRuntimeEvents } from "../patch/patchApplyRuntime";

export async function applySavedDiffContextItem(itemId: string) {
  const state = useAppStore.getState();
  const item = getContextItemById(state.workspace.contextItems, itemId);

  if (item?.type !== "diff" && item?.type !== "agent-sandbox-diff") {
    throw new Error(
      `Cannot apply diff for context item ${itemId}: item is not a saved diff.`,
    );
  }

  useAppStore.getState().actions.contextItems.startSavedDiffApply({ itemId });

  try {
    if (item.type === "diff") {
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
