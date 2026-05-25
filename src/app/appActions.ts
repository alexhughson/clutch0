import type { AppActions, AppState } from "./appTypes";
import { createComposeActions } from "../workflows/compose/composeWorkflow";
import { createContextItemsActions } from "../workflows/contextItems/contextItemsWorkflow";
import { createFindFilesActions } from "../workflows/findFiles/findFilesWorkflow";
import { createNavigationActions } from "../workflows/navigation/navigationWorkflow";
import { createResponseActions } from "../workflows/response/responseWorkflow";

type SetAppState = (
  partial:
    | Partial<AppState>
    | AppState
    | ((state: AppState) => Partial<AppState> | AppState),
) => void;

type GetAppState = () => AppState;

export function createAppActions({
  get,
  set,
}: {
  get: GetAppState;
  set: SetAppState;
}): AppActions {
  return {
    compose: createComposeActions({ get, set }),
    contextItems: createContextItemsActions({ set }),
    findFiles: createFindFilesActions({ set }),
    navigation: createNavigationActions({ set }),
    response: createResponseActions({ set }),
  };
}
