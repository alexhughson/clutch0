import {
  getContextItemById,
  SavedAgentSandboxDiffContextItem,
  SavedDiffContextItem,
} from "../../lib/context/contextItems";
import { applyPatchProposal } from "../../lib/patch/patchEngine";
import { applyAgentSandboxDiff } from "../agentAsk/agentSandbox";
import { useAppStore } from "../../store/appStore";

export async function applySavedDiffContextItem(itemId: string) {
  const state = useAppStore.getState();
  const item = getContextItemById(state.workspace.contextItems, itemId);

  if (
    !(item instanceof SavedDiffContextItem) &&
    !(item instanceof SavedAgentSandboxDiffContextItem)
  ) {
    return;
  }

  useAppStore.getState().actions.contextItems.startSavedDiffApply({ itemId });

  try {
    if (item instanceof SavedDiffContextItem) {
      const result = await applyPatchProposal({ proposal: item.proposal });
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
