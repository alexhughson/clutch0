import {
  getContextItemById,
  SavedDiffContextItem,
} from "../../lib/context/contextItems";
import { applyPatchProposal } from "../../lib/patch/patchEngine";
import { useAppStore } from "../../store/appStore";

export async function applySavedDiffContextItem(itemId: string) {
  const state = useAppStore.getState();
  const item = getContextItemById(state.workspace.contextItems, itemId);

  if (!(item instanceof SavedDiffContextItem)) {
    return;
  }

  useAppStore.getState().actions.contextItems.startSavedDiffApply({ itemId });

  try {
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
