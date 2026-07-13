import { fetchClutchProviderModels } from "../../lib/config/providerModels";
import type { AppActions } from "../../app/appTypes";
import { getModelEntrySelection } from "./configHelpers";
import { useAppStore } from "../../store/appStore";

export function startConfigModelFetch({
  actions,
  getState = useAppStore.getState,
  fetchModels = fetchClutchProviderModels,
  requestId,
}: {
  actions: Pick<
    AppActions["config"],
    "failModelLoad" | "finishModelLoad" | "startModelLoad"
  >;
  fetchModels?: typeof fetchClutchProviderModels;
  getState?: typeof useAppStore.getState;
  requestId: number;
}): () => void {
  const state = getState();
  if (state.activeTask?.kind !== "config") {
    return () => {};
  }

  const task = state.activeTask;
  if (task.stage !== "model-model" || task.modelLoadRequestId !== requestId) {
    return () => {};
  }

  const selection = getModelEntrySelection({
    agent: task.agent,
    entry: task.activeModelEntry,
    primary: task.primary,
    summarization: task.summarization,
  });
  const provider = selection.provider;
  const controller = new AbortController();
  let cancelled = false;

  actions.startModelLoad({ requestId });

  void fetchModels({ provider, signal: controller.signal })
    .then((models) => {
      if (cancelled || !isActiveModelRequest(getState(), requestId)) {
        return;
      }
      actions.finishModelLoad({ models, requestId });
    })
    .catch((error: unknown) => {
      if (controller.signal.aborted || cancelled) {
        return;
      }
      if (!isActiveModelRequest(getState(), requestId)) {
        return;
      }
      actions.failModelLoad({
        errorMessage: error instanceof Error ? error.message : String(error),
        requestId,
      });
    });

  return () => {
    cancelled = true;
    controller.abort();
  };
}

function isActiveModelRequest(
  state: ReturnType<typeof useAppStore.getState>,
  requestId: number,
): boolean {
  return (
    state.activeTask?.kind === "config" &&
    state.activeTask.stage === "model-model" &&
    state.activeTask.modelLoadRequestId === requestId
  );
}
