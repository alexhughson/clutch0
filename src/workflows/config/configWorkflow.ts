import type { Api, Model } from "@earendil-works/pi-ai";
import type { AppActions, AppState, ConfigTaskState } from "../../app/appTypes";
import type { OpenAiSubscriptionDeviceCode } from "../../lib/config/openAiSubscriptionAuth";
import { createConfigTask } from "./configInitialState";
import { indexOfModel, getModelEntrySelection } from "./configHelpers";
import {
  reduceConfigKey,
  reduceConfigPaste,
  type ConfigKeyEffect,
} from "./configKeyHandling";
import { runConfigSubscriptionLogin, abortActiveConfigSubscriptionLogin } from "./configSubscriptionLoginController";

type SetAppState = (
  partial:
    | Partial<AppState>
    | AppState
    | ((state: AppState) => Partial<AppState> | AppState),
) => void;

type GetAppState = () => AppState;

export type ConfigActions = AppActions["config"];

export function createConfigActions({
  get,
  set,
}: {
  get: GetAppState;
  set: SetAppState;
}): ConfigActions {
  const configActions: ConfigActions = {
    appendPaste: ({ text }) =>
      set((state) =>
        applyConfigEffect(state, reduceConfigPaste(getConfigTask(state), text)),
      ),
    cancelSubscriptionLogin: () => {
      abortActiveConfigSubscriptionLogin();
      set((state) => {
        const task = getConfigTaskOrNull(state);
        if (task === null) {
          return state;
        }

        return {
          activeTask: {
            ...task,
            subscriptionLogin: { status: "idle" },
            subscriptionLoginRequestId: task.subscriptionLoginRequestId + 1,
          },
        };
      });
    },
    closeAfterSave: () => set({ activeTask: null }),
    failModelLoad: ({ errorMessage, requestId }) =>
      set((state) => failModelLoad(state, requestId, errorMessage)),
    finishModelLoad: ({ models, requestId }) =>
      set((state) => finishModelLoad(state, requestId, models)),
    handleKey: ({ key }) => {
      const state = get();
      const task = getConfigTaskOrNull(state);
      if (task === null) {
        return;
      }

      const effect = reduceConfigKey(task, key);
      if (
        effect.kind === "update" &&
        task.stage === "subscription-login" &&
        key.name === "escape"
      ) {
        abortActiveConfigSubscriptionLogin();
      }
      if (effect.kind === "start-subscription-login") {
        set({ activeTask: effect.task });
        runConfigSubscriptionLogin({
          actions: configActions,
          getState: get,
          requestId: effect.requestId,
        });
        return;
      }

      set((state) => applyConfigEffect(state, effect));
    },
    openSettings: () => set({ activeTask: createConfigTask("settings") }),
    openSetup: () => set({ activeTask: createConfigTask("first-run") }),
    startModelLoad: ({ requestId }) =>
      set((state) => startModelLoad(state, requestId)),
    subscriptionLoginDeviceCode: ({ info, requestId }) =>
      set((state) => subscriptionLoginDeviceCode(state, requestId, info)),
    subscriptionLoginFail: ({ errorMessage, requestId }) =>
      set((state) => subscriptionLoginFail(state, requestId, errorMessage)),
    subscriptionLoginFinish: ({ requestId }) =>
      set((state) => subscriptionLoginFinish(state, requestId)),
  };

  return configActions;
}

function applyConfigEffect(
  state: AppState,
  effect: ConfigKeyEffect,
): Partial<AppState> | AppState {
  switch (effect.kind) {
    case "none":
    case "consume":
      return state;
    case "dismiss":
      return { activeTask: null };
    case "close-after-save":
      return { activeTask: null };
    case "update":
      return state.activeTask?.kind === "config"
        ? { activeTask: effect.task }
        : state;
    case "start-subscription-login":
      return state.activeTask?.kind === "config"
        ? { activeTask: effect.task }
        : state;
  }
}

function getConfigTaskOrNull(state: AppState): ConfigTaskState | null {
  return state.activeTask?.kind === "config" ? state.activeTask : null;
}

function getConfigTask(state: AppState): ConfigTaskState {
  const task = getConfigTaskOrNull(state);
  if (task === null) {
    throw new Error("Expected active config task.");
  }
  return task;
}

function startModelLoad(
  state: AppState,
  requestId: number,
): Partial<AppState> | AppState {
  const task = getConfigTaskOrNull(state);
  if (task === null || task.modelLoadRequestId !== requestId) {
    return state;
  }

  const selection = getModelEntrySelection({
    agent: task.agent,
    entry: task.activeModelEntry,
    primary: task.primary,
    summarization: task.summarization,
  });

  return {
    activeTask: {
      ...task,
      modelLoad: {
        models: [],
        provider: selection.provider,
        status: "loading",
      },
    },
  };
}

function finishModelLoad(
  state: AppState,
  requestId: number,
  models: Model<Api>[],
): Partial<AppState> | AppState {
  const task = getConfigTaskOrNull(state);
  if (
    task === null ||
    task.modelLoadRequestId !== requestId ||
    task.stage !== "model-model"
  ) {
    return state;
  }

  const selection = getModelEntrySelection({
    agent: task.agent,
    entry: task.activeModelEntry,
    primary: task.primary,
    summarization: task.summarization,
  });

  return {
    activeTask: {
      ...task,
      modelIndex: indexOfModel(selection, models),
      modelLoad: {
        models,
        provider: selection.provider,
        status: "loaded",
      },
    },
  };
}

function failModelLoad(
  state: AppState,
  requestId: number,
  errorMessage: string,
): Partial<AppState> | AppState {
  const task = getConfigTaskOrNull(state);
  if (
    task === null ||
    task.modelLoadRequestId !== requestId ||
    task.stage !== "model-model"
  ) {
    return state;
  }

  const selection = getModelEntrySelection({
    agent: task.agent,
    entry: task.activeModelEntry,
    primary: task.primary,
    summarization: task.summarization,
  });

  return {
    activeTask: {
      ...task,
      modelLoad: {
        errorMessage,
        models: [],
        provider: selection.provider,
        status: "error",
      },
    },
  };
}

function subscriptionLoginDeviceCode(
  state: AppState,
  requestId: number,
  info: OpenAiSubscriptionDeviceCode,
): Partial<AppState> | AppState {
  const task = getConfigTaskOrNull(state);
  if (task === null || task.subscriptionLoginRequestId !== requestId) {
    return state;
  }

  return {
    activeTask: {
      ...task,
      subscriptionLogin: { info, status: "waiting-for-device" },
    },
  };
}

function subscriptionLoginFinish(
  state: AppState,
  requestId: number,
): Partial<AppState> | AppState {
  const task = getConfigTaskOrNull(state);
  if (task === null || task.subscriptionLoginRequestId !== requestId) {
    return state;
  }

  return {
    activeTask: {
      ...task,
      configuredProviders: Array.from(
        new Set([...task.configuredProviders, "openai-codex"]),
      ),
      message: "Saved OpenAI subscription login.",
      stage: "providers",
      subscriptionLogin: { status: "idle" },
    },
  };
}

function subscriptionLoginFail(
  state: AppState,
  requestId: number,
  errorMessage: string,
): Partial<AppState> | AppState {
  const task = getConfigTaskOrNull(state);
  if (task === null || task.subscriptionLoginRequestId !== requestId) {
    return state;
  }

  return {
    activeTask: {
      ...task,
      subscriptionLogin: {
        message: errorMessage,
        status: "error",
      },
    },
  };
}
