import { ContextDeck } from "../../app/contextDeck";
import type { AppActions, AppState } from "../../app/appTypes";
import { createFileContextItem } from "../../lib/context/contextItems";
import type { FilePath } from "../../types";

type SetAppState = (
  partial:
    | Partial<AppState>
    | AppState
    | ((state: AppState) => Partial<AppState> | AppState),
) => void;

export function createAddFilesActions({
  set,
}: {
  set: SetAppState;
}): AppActions["addFiles"] {
  return {
    addToContext: ({ paths }) =>
      set((state) => ({
        workspace: addFilePathsToContext(state, paths),
      })),
  };
}

function addFilePathsToContext(
  state: AppState,
  paths: readonly FilePath[],
): AppState["workspace"] {
  return paths
    .reduce(
      (deck, path) => deck.add(createFileContextItem(path)),
      ContextDeck.fromComposeScreen(state.workspace),
    )
    .applyTo(state.workspace);
}
