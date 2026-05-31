import type { AppActions, AppState, ConfigTaskState } from "../../app/appTypes";
import { createDefaultClutchConfigDraft } from "../../lib/config/clutchConfig";

export type ConfigActions = AppActions["config"];

type SetAppState = (
  partial:
    | Partial<AppState>
    | AppState
    | ((state: AppState) => Partial<AppState> | AppState),
) => void;

export function createConfigActions({
  set,
}: {
  set: SetAppState;
}): ConfigActions {
  return {
    closeAfterSave: () => set({ activeTask: null }),
    openSettings: () => set({ activeTask: createConfigTask("settings") }),
    openSetup: () => set({ activeTask: createConfigTask("first-run") }),
  };
}

function createConfigTask(mode: ConfigTaskState["mode"]): ConfigTaskState {
  const draft = createDefaultClutchConfigDraft();
  return {
    ...draft,
    kind: "config",
    mode,
  };
}
