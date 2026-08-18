import { create, type StoreApi, type UseBoundStore } from "zustand";
import { createAppActions } from "../app/appActions";
import { createInitialAppState } from "../app/appInitialState";
import type { AppActions, AppState } from "../app/appTypes";
import type { SessionRecorder } from "../lib/session/sessionRecorder";

export type {
  AppActions,
  AppTask,
  AppState,
  ComposerState,
  ComposeScreenState,
  LlmRequestState,
  LlmRequestStatus,
  WorkspaceState,
} from "../app/appTypes";

type StoreSet = (
  partial:
    | AppState
    | Partial<AppState>
    | ((state: AppState) => AppState | Partial<AppState>),
  replace?: boolean,
) => void;

let sessionRecorder: SessionRecorder | null = null;
let workspaceEditListener:
  | ((event: Record<string, unknown>) => void)
  | null = null;

type AppStore = UseBoundStore<StoreApi<AppState>>;
type AppStoreRuntime = {
  getSessionRecorder?: () => SessionRecorder | null;
};
const storeInstrumentations = new WeakMap<AppStore, ActionInstrumentation>();

export function createAppStore(
  initialState: Omit<AppState, "actions"> = createInitialAppState(),
  runtime: AppStoreRuntime = {},
) : AppStore {
  return createAppStoreWithRuntime(initialState, runtime);
}

export function createAppStoreWithRuntime(
  initialState: Omit<AppState, "actions"> = createInitialAppState(),
  runtime: AppStoreRuntime = {},
): AppStore {
  let activeActionName: string | undefined;
  const instrumentation: ActionInstrumentation = {
    getActiveActionName: () => activeActionName,
    setActiveActionName: (actionName) => {
      activeActionName = actionName;
    },
  };
  const store = create<AppState>((set, get) => ({
    ...initialState,
    actions: instrumentActions(createAppActions({ set, get }), instrumentation),
  }));
  storeInstrumentations.set(store, instrumentation);
  attachAppStoreSideEffects({
    getActiveActionName: instrumentation.getActiveActionName,
    getSessionRecorder: runtime.getSessionRecorder ?? (() => null),
    store,
  });

  return store;
}

/**
 * Global Zustand store for the Clutch app state and actions.
 */
export const useAppStore = createAppStoreWithRuntime(createInitialAppState(), {
  getSessionRecorder: () => sessionRecorder,
});

export function hydrateAppStore(initialState: Omit<AppState, "actions">) {
  useAppStore.setState(
    {
      ...initialState,
      actions: instrumentActions(
        createAppActions({
          get: useAppStore.getState,
          set: useAppStore.setState as unknown as StoreSet,
        }),
        getStoreInstrumentation(useAppStore),
      ),
    },
    true,
  );
}

export function setSessionRecorder(recorder: SessionRecorder | null) {
  sessionRecorder = recorder;
}

export function setWorkspaceEditListener(
  listener: ((event: Record<string, unknown>) => void) | null,
) {
  workspaceEditListener = listener;
}

export function recordSessionRuntimeEvent(event: Record<string, unknown>) {
  sessionRecorder?.recordRuntimeEvent(event);
  try {
    workspaceEditListener?.(event);
  } catch (error) {
    sessionRecorder?.recordRuntimeEvent({
      errorMessage: error instanceof Error ? error.message : String(error),
      kind: "auto-regen.listener-failed",
    });
    if (sessionRecorder === null) {
      queueMicrotask(() => {
        throw error;
      });
    }
  }
}

function attachAppStoreSideEffects({
  getActiveActionName,
  getSessionRecorder,
  store,
}: {
  getActiveActionName: () => string | undefined;
  getSessionRecorder: () => SessionRecorder | null;
  store: AppStore;
}) {
  store.subscribe((state, previousState) => {
    getSessionRecorder()?.recordStateChange({
      actionName: getActiveActionName(),
      previousState,
      state,
    });

    if (
      state.workspace.contextItems !== previousState.workspace.contextItems ||
      state.workspace.automaticContextItems !==
        previousState.workspace.automaticContextItems
    ) {
      state.actions.contextSummaries.ensureWorkspaceSummaries();
    }
  });
}

function getStoreInstrumentation(store: AppStore): ActionInstrumentation {
  const instrumentation = storeInstrumentations.get(store);
  if (instrumentation === undefined) {
    throw new Error("App store instrumentation is missing.");
  }

  return instrumentation;
}

type ActionInstrumentation = {
  getActiveActionName: () => string | undefined;
  setActiveActionName: (actionName: string | undefined) => void;
};

function instrumentActions(
  actions: AppActions,
  instrumentation: ActionInstrumentation,
): AppActions {
  return instrumentActionObject(actions, [], instrumentation) as AppActions;
}

function instrumentActionObject(
  value: unknown,
  path: readonly string[],
  instrumentation: ActionInstrumentation,
): unknown {
  if (typeof value === "function") {
    return (...args: unknown[]) => {
      const previousActionName = instrumentation.getActiveActionName();
      instrumentation.setActiveActionName(path.join("."));
      try {
        return value(...args);
      } finally {
        instrumentation.setActiveActionName(previousActionName);
      }
    };
  }

  if (value === null || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, child]) => [
      key,
      instrumentActionObject(child, [...path, key], instrumentation),
    ]),
  );
}
