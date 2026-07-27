import { stripAnsiSequences } from "@opentui/core";
import {
  CLUTCH_MODEL_EFFORT_LEVELS,
  CLUTCH_MODEL_SERVICE_TIERS,
  type ClutchModelEffortLevel,
  type ClutchModelSelection,
  type ClutchModelServiceTier,
} from "../../lib/config/clutchConfigSchemas";
import {
  getClutchModelEffortLevel,
  getClutchModelServiceTier,
  getSupportedClutchProviderLabel,
  saveClutchAgentBackendConfiguration,
  saveClutchApiKey,
  saveClutchModelConfiguration,
} from "../../lib/config/clutchConfig";
import type { ConfigTaskState } from "../../app/appTypes";
import {
  AGENT_BACKEND_ROWS,
  MODEL_SETTINGS_ROWS,
  agentBackendFromForm,
  agentBackendFormFromConfig,
  cycleIndex,
  effortIndexFor,
  entryLabel,
  getModelEntrySelection,
  indexOfModel,
  matchingModels,
  modelProvidersForEntry,
  providerIndexFor,
  providerRows,
  sanitizeLineInput,
  serviceTierIndexFor,
  setActiveSelection,
} from "./configHelpers";
import type { ConfigKeyInput } from "./configTypes";

export type ConfigKeyEffect =
  | { kind: "close-after-save" }
  | { kind: "consume" }
  | { kind: "dismiss" }
  | { kind: "none" }
  | {
      kind: "start-subscription-login";
      requestId: number;
      task: ConfigTaskState;
    }
  | { kind: "update"; task: ConfigTaskState };

type AgentBackendField = Exclude<(typeof AGENT_BACKEND_ROWS)[number], "save">;

export function keyInputFromEvent(event: {
  ctrl?: boolean;
  meta?: boolean;
  name: string;
  option?: boolean;
  sequence?: string;
}): ConfigKeyInput {
  return {
    ctrl: event.ctrl,
    meta: event.meta,
    name: event.name,
    option: event.option,
    sequence: event.sequence ?? "",
  };
}

export function isConfigKeyHandled(
  task: ConfigTaskState,
  key: ConfigKeyInput,
): boolean {
  return reduceConfigKey(task, key).kind !== "none";
}

export function reduceConfigKey(
  task: ConfigTaskState,
  key: ConfigKeyInput,
): ConfigKeyEffect {
  switch (task.stage) {
    case "providers":
      return reduceProvidersKey(task, key);
    case "agent-backend":
      return reduceAgentBackendKey(task, key);
    case "token":
      return reduceTokenKey(task, key);
    case "subscription-login":
      return reduceSubscriptionLoginKey(task, key);
    case "model-settings":
      return reduceModelSettingsKey(task, key);
    case "model-provider":
      return reduceModelProviderKey(task, key);
    case "model-effort":
      return reduceModelEnumChoiceKey({
        task,
        key,
        indexField: "modelEffortIndex",
        label: "effort",
        updateSelection: (selection, effortLevel) => ({
          ...selection,
          effortLevel,
        }),
        values: CLUTCH_MODEL_EFFORT_LEVELS,
      });
    case "model-service-tier":
      return reduceModelEnumChoiceKey({
        task,
        key,
        indexField: "modelServiceTierIndex",
        label: "service tier",
        updateSelection: (selection, serviceTier) => ({
          ...selection,
          serviceTier,
        }),
        values: CLUTCH_MODEL_SERVICE_TIERS,
      });
    case "model-model":
      return reduceModelChoiceKey(task, key);
  }
}

export function reduceConfigPaste(
  task: ConfigTaskState,
  pastedText: string,
): ConfigKeyEffect {
  const sanitized = sanitizeLineInput(pastedText);
  if (sanitized.length === 0) {
    return { kind: "none" };
  }

  if (task.stage === "token") {
    return {
      kind: "update",
      task: { ...task, message: null, token: `${task.token}${sanitized}` },
    };
  }

  if (task.stage === "agent-backend") {
    const row = AGENT_BACKEND_ROWS[task.agentBackendRowIndex];
    if (row === undefined || row === "save") {
      return { kind: "none" };
    }

    return {
      kind: "update",
      task: {
        ...task,
        agentBackendForm: updateAgentBackendField(
          task.agentBackendForm,
          row,
          (value) => `${value}${sanitized}`,
        ),
        message: null,
      },
    };
  }

  return { kind: "none" };
}

type MenuListKeyConfig = {
  getIndex: (task: ConfigTaskState) => number;
  getItemCount: (task: ConfigTaskState) => number;
  onEnter: (task: ConfigTaskState) => ConfigKeyEffect;
  onEscape?: (task: ConfigTaskState) => ConfigKeyEffect;
  setIndex: (task: ConfigTaskState, index: number) => ConfigTaskState;
};

function reduceMenuListNavigation(
  task: ConfigTaskState,
  key: ConfigKeyInput,
  config: Pick<
    MenuListKeyConfig,
    "getIndex" | "getItemCount" | "onEscape" | "setIndex"
  >,
): ConfigKeyEffect | null {
  if (key.name === "escape" && config.onEscape !== undefined) {
    return config.onEscape(task);
  }

  if (key.name === "up" || key.name === "down") {
    return {
      kind: "update",
      task: config.setIndex(
        task,
        cycleIndex(
          config.getIndex(task),
          config.getItemCount(task),
          key.name === "down" ? 1 : -1,
        ),
      ),
    };
  }

  return null;
}

function reduceMenuListKey(
  task: ConfigTaskState,
  key: ConfigKeyInput,
  config: MenuListKeyConfig,
): ConfigKeyEffect {
  const navigation = reduceMenuListNavigation(task, key, config);
  if (navigation !== null) {
    return navigation;
  }

  if (key.name !== "return") {
    return { kind: "none" };
  }

  return config.onEnter(task);
}

function reduceStringFieldKey(
  task: ConfigTaskState,
  key: ConfigKeyInput,
  {
    clearMessageOnPrintable = false,
    getValue,
    onEscape,
    onSubmit,
    setValue,
    trimPrintable = false,
  }: {
    clearMessageOnPrintable?: boolean;
    getValue: (task: ConfigTaskState) => string;
    onEscape: (task: ConfigTaskState) => ConfigKeyEffect;
    onSubmit: (task: ConfigTaskState) => ConfigKeyEffect;
    setValue: (task: ConfigTaskState, value: string) => ConfigTaskState;
    trimPrintable?: boolean;
  },
): ConfigKeyEffect {
  if (key.name === "escape") {
    return onEscape(task);
  }

  if (key.name === "return" || (key.ctrl && key.name === "s")) {
    return onSubmit(task);
  }

  if (key.ctrl && key.name === "u") {
    return { kind: "update", task: setValue(task, "") };
  }

  if (key.name === "backspace") {
    return {
      kind: "update",
      task: setValue(task, getValue(task).slice(0, -1)),
    };
  }

  const input = getPrintableInput(key);
  if (input !== null) {
    const appended = trimPrintable ? sanitizeLineInput(input).trim() : input;
    const nextTask = setValue(task, `${getValue(task)}${appended}`);
    return {
      kind: "update",
      task: clearMessageOnPrintable ? { ...nextTask, message: null } : nextTask,
    };
  }

  return { kind: "none" };
}

function reduceProvidersKey(
  task: ConfigTaskState,
  key: ConfigKeyInput,
): ConfigKeyEffect {
  if (key.name === "escape" && task.mode === "settings") {
    return { kind: "dismiss" };
  }

  const rows = providerRows({
    agentBackendConfigured: task.agentBackendForm.command.trim().length > 0,
    configuredProviders: task.configuredProviders,
  });

  return reduceMenuListKey(task, key, {
    getIndex: (currentTask) => currentTask.providerIndex,
    getItemCount: () => rows.length,
    onEnter: (currentTask) => {
      const row = rows[currentTask.providerIndex];
      if (row === undefined) {
        throw new Error(
          `Invalid provider row index: ${currentTask.providerIndex}`,
        );
      }

      if (row.kind === "models") {
        return {
          kind: "update",
          task: { ...currentTask, message: null, stage: "model-settings" },
        };
      }

      if (row.kind === "agent-backend") {
        return {
          kind: "update",
          task: { ...currentTask, message: null, stage: "agent-backend" },
        };
      }

      if (row.kind === "subscription-provider") {
        return {
          kind: "update",
          task: {
            ...currentTask,
            message: null,
            stage: "subscription-login",
            subscriptionLogin: { status: "idle" },
          },
        };
      }

      if (row.kind !== "provider") {
        throw new Error(`Expected API-key provider row, got ${row.kind}`);
      }

      return {
        kind: "update",
        task: {
          ...currentTask,
          message: null,
          stage: "token",
          token: "",
          tokenProvider: row.provider,
        },
      };
    },
    setIndex: (currentTask, providerIndex) => ({
      ...currentTask,
      message: null,
      providerIndex,
    }),
  });
}

function reduceAgentBackendKey(
  task: ConfigTaskState,
  key: ConfigKeyInput,
): ConfigKeyEffect {
  const navigation = reduceMenuListNavigation(task, key, {
    getIndex: (currentTask) => currentTask.agentBackendRowIndex,
    getItemCount: () => AGENT_BACKEND_ROWS.length,
    onEscape: (currentTask) => ({
      kind: "update",
      task: { ...currentTask, message: null, stage: "providers" },
    }),
    setIndex: (currentTask, agentBackendRowIndex) => ({
      ...currentTask,
      agentBackendRowIndex,
      message: null,
    }),
  });
  if (navigation !== null) {
    return navigation;
  }

  const row = AGENT_BACKEND_ROWS[task.agentBackendRowIndex];
  if (row === undefined) {
    throw new Error(
      `Invalid ACP backend row index: ${task.agentBackendRowIndex}`,
    );
  }

  if (key.name === "return" || (key.ctrl && key.name === "s")) {
    if (row === "save" || key.ctrl) {
      try {
        const backend = agentBackendFromForm(task.agentBackendForm);
        saveClutchAgentBackendConfiguration({ backend });
        return {
          kind: "update",
          task: {
            ...task,
            agentBackend: backend,
            agentBackendForm: agentBackendFormFromConfig(backend),
            message: "Saved ACP backend.",
            stage: "providers",
          },
        };
      } catch (error) {
        return {
          kind: "update",
          task: { ...task, message: configErrorMessage(error) },
        };
      }
    }
    return { kind: "consume" };
  }

  if (row === "save") {
    return { kind: "none" };
  }

  return reduceStringFieldKey(task, key, {
    getValue: (currentTask) =>
      readAgentBackendField(currentTask.agentBackendForm, row),
    onEscape: (currentTask) => ({
      kind: "update",
      task: { ...currentTask, message: null, stage: "providers" },
    }),
    onSubmit: () => ({ kind: "consume" }),
    setValue: (currentTask, value) => ({
      ...currentTask,
      agentBackendForm: updateAgentBackendField(
        currentTask.agentBackendForm,
        row,
        value,
      ),
      message: null,
    }),
  });
}

function reduceTokenKey(
  task: ConfigTaskState,
  key: ConfigKeyInput,
): ConfigKeyEffect {
  return reduceStringFieldKey(task, key, {
    getValue: (currentTask) => currentTask.token,
    onEscape: (currentTask) => ({
      kind: "update",
      task: { ...currentTask, message: null, stage: "providers" },
    }),
    onSubmit: (currentTask) => {
      try {
        saveClutchApiKey({
          apiKey: currentTask.token,
          provider: currentTask.tokenProvider,
        });
        return {
          kind: "update",
          task: {
            ...currentTask,
            configuredProviders: Array.from(
              new Set([
                ...currentTask.configuredProviders,
                currentTask.tokenProvider,
              ]),
            ),
            message: `Saved token for ${getSupportedClutchProviderLabel(currentTask.tokenProvider)}.`,
            stage: "providers",
            token: "",
          },
        };
      } catch (error) {
        return {
          kind: "update",
          task: { ...currentTask, message: configErrorMessage(error) },
        };
      }
    },
    setValue: (currentTask, token) => ({ ...currentTask, token }),
    trimPrintable: true,
    clearMessageOnPrintable: true,
  });
}

function reduceSubscriptionLoginKey(
  task: ConfigTaskState,
  key: ConfigKeyInput,
): ConfigKeyEffect {
  if (key.name === "escape") {
    return {
      kind: "update",
      task: {
        ...task,
        message: null,
        stage: "providers",
        subscriptionLogin: { status: "idle" },
        subscriptionLoginRequestId: task.subscriptionLoginRequestId + 1,
      },
    };
  }

  if (key.name !== "return") {
    return { kind: "none" };
  }

  if (
    task.subscriptionLogin.status !== "idle" &&
    task.subscriptionLogin.status !== "error"
  ) {
    return {
      kind: "update",
      task: {
        ...task,
        message: "OpenAI subscription login is already running.",
      },
    };
  }

  const requestId = task.subscriptionLoginRequestId + 1;
  return {
    kind: "start-subscription-login",
    requestId,
    task: {
      ...task,
      message: null,
      subscriptionLogin: {
        message: "Starting OpenAI subscription login...",
        status: "working",
      },
      subscriptionLoginRequestId: requestId,
    },
  };
}

function reduceModelSettingsKey(
  task: ConfigTaskState,
  key: ConfigKeyInput,
): ConfigKeyEffect {
  return reduceMenuListKey(task, key, {
    getIndex: (currentTask) => currentTask.modelSettingsIndex,
    getItemCount: () => MODEL_SETTINGS_ROWS.length,
    onEnter: (currentTask) => {
      const row = MODEL_SETTINGS_ROWS[currentTask.modelSettingsIndex];
      if (row === undefined) {
        throw new Error(
          `Invalid model settings row index: ${currentTask.modelSettingsIndex}`,
        );
      }

      if (row.kind === "done") {
        try {
          saveClutchModelConfiguration({
            agent: currentTask.agent,
            primary: currentTask.primary,
            summarization: currentTask.summarization,
          });
          return { kind: "close-after-save" };
        } catch (error) {
          return {
            kind: "update",
            task: { ...currentTask, message: configErrorMessage(error) },
          };
        }
      }

      const selection = getModelEntrySelection({
        agent: currentTask.agent,
        entry: row.entry,
        primary: currentTask.primary,
        summarization: currentTask.summarization,
      });

      if (row.kind === "effort") {
        return {
          kind: "update",
          task: {
            ...currentTask,
            activeModelEntry: row.entry,
            message: null,
            modelEffortIndex: effortIndexFor(
              getClutchModelEffortLevel(selection),
            ),
            stage: "model-effort",
          },
        };
      }

      if (row.kind === "service-tier") {
        return {
          kind: "update",
          task: {
            ...currentTask,
            activeModelEntry: row.entry,
            message: null,
            modelServiceTierIndex: serviceTierIndexFor(
              getClutchModelServiceTier(selection),
            ),
            stage: "model-service-tier",
          },
        };
      }

      return {
        kind: "update",
        task: {
          ...currentTask,
          activeModelEntry: row.entry,
          message: null,
          modelProviderIndex: providerIndexFor(selection.provider, row.entry),
          stage: "model-provider",
        },
      };
    },
    onEscape: (currentTask) => ({
      kind: "update",
      task: { ...currentTask, message: null, stage: "providers" },
    }),
    setIndex: (currentTask, modelSettingsIndex) => ({
      ...currentTask,
      message: null,
      modelSettingsIndex,
    }),
  });
}

function reduceModelProviderKey(
  task: ConfigTaskState,
  key: ConfigKeyInput,
): ConfigKeyEffect {
  const providers = modelProvidersForEntry(task.activeModelEntry);

  return reduceMenuListKey(task, key, {
    getIndex: (currentTask) => currentTask.modelProviderIndex,
    getItemCount: () => providers.length,
    onEnter: (currentTask) => {
      const provider = providers[currentTask.modelProviderIndex]?.id;
      if (provider === undefined) {
        throw new Error(
          `Invalid model provider row index: ${currentTask.modelProviderIndex}`,
        );
      }

      const currentSelection = getModelEntrySelection({
        agent: currentTask.agent,
        entry: currentTask.activeModelEntry,
        primary: currentTask.primary,
        summarization: currentTask.summarization,
      });
      const selection =
        currentSelection.provider === provider
          ? currentSelection
          : {
              effortLevel: getClutchModelEffortLevel(currentSelection),
              model: "",
              provider,
              serviceTier: getClutchModelServiceTier(currentSelection),
            };
      const nextSelections = setActiveSelection({
        activeModelEntry: currentTask.activeModelEntry,
        agent: currentTask.agent,
        primary: currentTask.primary,
        selection,
        summarization: currentTask.summarization,
      });

      return {
        kind: "update",
        task: {
          ...currentTask,
          ...nextSelections,
          message: null,
          modelFilter: "",
          modelIndex: 0,
          modelLoad: { models: [], provider, status: "loading" },
          modelLoadRequestId: currentTask.modelLoadRequestId + 1,
          stage: "model-model",
        },
      };
    },
    onEscape: (currentTask) => ({
      kind: "update",
      task: { ...currentTask, message: null, stage: "model-settings" },
    }),
    setIndex: (currentTask, modelProviderIndex) => ({
      ...currentTask,
      message: null,
      modelProviderIndex,
    }),
  });
}

function reduceModelEnumChoiceKey<
  T extends ClutchModelEffortLevel | ClutchModelServiceTier,
>({
  task,
  key,
  indexField,
  label,
  updateSelection,
  values,
}: {
  task: ConfigTaskState;
  key: ConfigKeyInput;
  indexField: "modelEffortIndex" | "modelServiceTierIndex";
  label: string;
  updateSelection: (
    selection: ClutchModelSelection,
    value: T,
  ) => ClutchModelSelection;
  values: readonly T[];
}): ConfigKeyEffect {
  return reduceMenuListKey(task, key, {
    getIndex: (currentTask) => currentTask[indexField],
    getItemCount: () => values.length,
    onEnter: (currentTask) => {
      const value = values[currentTask[indexField]];
      if (value === undefined) {
        throw new Error(
          `Invalid model ${label} row index: ${currentTask[indexField]}`,
        );
      }

      const selection = getModelEntrySelection({
        agent: currentTask.agent,
        entry: currentTask.activeModelEntry,
        primary: currentTask.primary,
        summarization: currentTask.summarization,
      });
      const nextSelections = setActiveSelection({
        activeModelEntry: currentTask.activeModelEntry,
        agent: currentTask.agent,
        primary: currentTask.primary,
        selection: updateSelection(selection, value),
        summarization: currentTask.summarization,
      });

      return {
        kind: "update",
        task: {
          ...currentTask,
          ...nextSelections,
          message: `${entryLabel(currentTask.activeModelEntry)} ${label} updated. Choose Done to save.`,
          stage: "model-settings",
        },
      };
    },
    onEscape: (currentTask) => ({
      kind: "update",
      task: { ...currentTask, message: null, stage: "model-settings" },
    }),
    setIndex: (currentTask, index) => ({
      ...currentTask,
      [indexField]: index,
      message: null,
    }),
  });
}

function reduceModelChoiceKey(
  task: ConfigTaskState,
  key: ConfigKeyInput,
): ConfigKeyEffect {
  const selection = getModelEntrySelection({
    agent: task.agent,
    entry: task.activeModelEntry,
    primary: task.primary,
    summarization: task.summarization,
  });
  const matches = matchingModels({
    filter: task.modelFilter,
    models: task.modelLoad.models,
  });

  if (key.name === "escape") {
    return {
      kind: "update",
      task: { ...task, message: null, stage: "model-provider" },
    };
  }

  if (key.name === "up" || key.name === "down") {
    return {
      kind: "update",
      task: {
        ...task,
        message: null,
        modelIndex:
          matches.length > 0
            ? cycleIndex(
                task.modelIndex,
                matches.length,
                key.name === "down" ? 1 : -1,
              )
            : task.modelIndex,
      },
    };
  }

  if (key.name === "return") {
    if (task.modelLoad.status !== "loaded") {
      return {
        kind: "update",
        task: { ...task, message: "Models are not loaded yet." },
      };
    }

    const model = matches[task.modelIndex];
    if (model === undefined) {
      return {
        kind: "update",
        task: { ...task, message: "Choose a model before continuing." },
      };
    }

    const nextSelections = setActiveSelection({
      activeModelEntry: task.activeModelEntry,
      agent: task.agent,
      primary: task.primary,
      selection: { ...selection, metadata: model, model: model.id },
      summarization: task.summarization,
    });

    return {
      kind: "update",
      task: {
        ...task,
        ...nextSelections,
        message: `${entryLabel(task.activeModelEntry)} model updated. Choose Done to save.`,
        modelFilter: "",
        stage: "model-settings",
      },
    };
  }

  if (key.ctrl && key.name === "u") {
    return {
      kind: "update",
      task: {
        ...task,
        message: null,
        modelFilter: "",
        modelIndex: indexOfModel(selection, task.modelLoad.models),
      },
    };
  }

  if (key.name === "backspace") {
    return {
      kind: "update",
      task: {
        ...task,
        message: null,
        modelFilter: task.modelFilter.slice(0, -1),
        modelIndex: 0,
      },
    };
  }

  const filterInput = getPrintableInput(key);
  if (filterInput !== null) {
    return {
      kind: "update",
      task: {
        ...task,
        message: null,
        modelFilter: `${task.modelFilter}${filterInput}`,
        modelIndex: 0,
      },
    };
  }

  return { kind: "none" };
}

function getPrintableInput(key: ConfigKeyInput): string | null {
  if (key.ctrl || key.meta || key.option || key.sequence.length === 0) {
    return null;
  }

  const sanitized = stripAnsiSequences(key.sequence).replace(/[\n\r]/g, "");
  if (sanitized.length === 0 || sanitized[0] < " ") {
    return null;
  }

  return sanitized;
}

function configErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function readAgentBackendField(
  form: ConfigTaskState["agentBackendForm"],
  field: AgentBackendField,
): string {
  switch (field) {
    case "command":
      return form.command;
    case "args":
      return form.argsJson;
    case "env":
      return form.envJson;
  }
}

function updateAgentBackendField(
  form: ConfigTaskState["agentBackendForm"],
  field: AgentBackendField,
  update: string | ((value: string) => string),
): ConfigTaskState["agentBackendForm"] {
  const nextValue =
    typeof update === "string"
      ? update
      : update(readAgentBackendField(form, field));

  switch (field) {
    case "command":
      return { ...form, command: nextValue };
    case "args":
      return { ...form, argsJson: nextValue };
    case "env":
      return { ...form, envJson: nextValue };
  }
}
