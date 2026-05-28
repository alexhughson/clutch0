import type { AppActions, AppState } from "./appTypes";
import { createAgentAskActions } from "../workflows/agentAsk/agentAskWorkflow";
import { createComposeActions } from "../workflows/compose/composeWorkflow";
import { createContextItemsActions } from "../workflows/contextItems/contextItemsWorkflow";
import { createContextSummariesActions } from "../workflows/contextSummaries/contextSummariesWorkflow";
import { createCreateFileActions } from "../workflows/createFile/createFileWorkflow";
import { createFindFilesActions } from "../workflows/findFiles/findFilesWorkflow";
import { createNavigationActions } from "../workflows/navigation/navigationWorkflow";
import { createResponseActions } from "../workflows/response/responseWorkflow";
import { createShellCommandActions } from "../workflows/shellCommand/shellCommandWorkflow";
import { createShowContextActions } from "../workflows/showContext/showContextWorkflow";

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
    agentAsk: createAgentAskActions({ get, set }),
    compose: createComposeActions({ get, set }),
    contextSummaries: createContextSummariesActions({ get, set }),
    contextItems: createContextItemsActions({ set }),
    createFile: createCreateFileActions({ set }),
    findFiles: createFindFilesActions({ set }),
    navigation: createNavigationActions({ set }),
    response: createResponseActions({ set }),
    shellCommand: createShellCommandActions({ get, set }),
    showContext: createShowContextActions({ get, set }),
  };
}
