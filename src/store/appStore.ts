import { create } from "zustand";
import { createAppActions } from "../app/appActions";
import { createInitialAppState } from "../app/appInitialState";
import type { AppState } from "../app/appTypes";

export type {
  AppActions,
  AppScreen,
  AppState,
  ComposerState,
  ComposeScreenState,
  LlmRequestState,
  LlmRequestStatus,
} from "../app/appTypes";

/**
 * Global Zustand store for the Clutch app state and actions.
 */
export const useAppStore = create<AppState>((set, get) => ({
  ...createInitialAppState(),
  actions: createAppActions({ set, get }),
}));
