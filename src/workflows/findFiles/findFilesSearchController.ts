import type { AppActions, FindFilesScreenState } from "../../app/appTypes";
import { assembleLlmContextInput } from "../../lib/llm/context";
import {
  createRuntimeAbortHandle,
  type RuntimeAbortHandle,
} from "../../lib/session/runtimeInterrupts";
import { useAppStore } from "../../store/appStore";
import {
  recordFindFilesFailedRuntimeEvent,
  recordFindFilesFinishedRuntimeEvent,
  recordFindFilesStartedRuntimeEvent,
} from "./findFilesRuntimeEvents";
import {
  runPiFileSearchAgent,
  type RunPiFileSearchAgentOptions,
} from "./piFileSearchAgent";

export function startFindFilesSearch({
  actions,
  createAbortHandle = createRuntimeAbortHandle,
  getState = useAppStore.getState,
  runSearch = runPiFileSearchAgent,
  screen,
}: {
  actions: Pick<AppActions["findFiles"], "fail" | "finish" | "recordAgentOutput">;
  createAbortHandle?: () => RuntimeAbortHandle;
  getState?: typeof useAppStore.getState;
  runSearch?: (
    options: RunPiFileSearchAgentOptions,
  ) => ReturnType<typeof runPiFileSearchAgent>;
  screen: FindFilesScreenState;
}): () => void {
  let cancelled = false;
  const state = getState();
  const { contextItems, focusedContextItemId } = assembleLlmContextInput({
    automaticContextItems: state.workspace.automaticContextItems,
    contextItems: state.workspace.contextItems,
    focusedContextItemId: state.workspace.focusedContextItemId,
  });
  const abortHandle = createAbortHandle();
  recordFindFilesStartedRuntimeEvent({
    contextItems,
    focusedContextItemId,
    goal: screen.goal,
    hints: screen.hints,
  });
  void runSearch({
    contextItems,
    focusedContextItemId,
    goal: screen.goal,
    hints: screen.hints,
    onAgentOutput: (update) => {
      if (!cancelled) {
        actions.recordAgentOutput({ update });
      }
    },
    signal: abortHandle.signal,
  }).then(
    (candidates) => {
      abortHandle.dispose();
      if (!cancelled) {
        recordFindFilesFinishedRuntimeEvent({
          candidates,
          goal: screen.goal,
        });
        actions.finish({ candidates });
      }
    },
    (error: unknown) => {
      abortHandle.dispose();
      if (!cancelled) {
        recordFindFilesFailedRuntimeEvent({
          error,
          goal: screen.goal,
        });
        actions.fail({
          errorMessage: error instanceof Error ? error.message : String(error),
        });
      }
    },
  );

  return () => {
    cancelled = true;
    abortHandle.abort();
  };
}
