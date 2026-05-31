import {
  decodePasteBytes,
  stripAnsiSequences,
  type KeyEvent,
} from "@opentui/core";
import { useKeyboard, usePaste } from "@opentui/react";
import type { Api, Model } from "@earendil-works/pi-ai";
import { useEffect, useState } from "react";
import type { ConfigTaskState } from "../../app/appTypes";
import {
  getSupportedClutchProviderLabel,
  saveClutchApiKey,
  saveClutchModelConfiguration,
  SUPPORTED_CLUTCH_LLM_PROVIDERS,
  type ClutchModelSelection,
  type SupportedClutchLlmProvider,
} from "../../lib/config/clutchConfig";
import { fetchClutchProviderModels } from "../../lib/config/providerModels";
import { useAppStore } from "../../store/appStore";

type ConfigScreenProps = {
  task: ConfigTaskState;
};

type ConfigStage =
  | "model-model"
  | "model-provider"
  | "model-settings"
  | "providers"
  | "token";
type ModelEntry = "primary" | "summarization";
type ModelSettingsRow = ModelEntry | "done";
type ModelLoadState =
  | {
      models: Model<Api>[];
      provider: SupportedClutchLlmProvider;
      status: "loaded";
    }
  | {
      errorMessage: string;
      models: [];
      provider: SupportedClutchLlmProvider;
      status: "error";
    }
  | { models: []; provider: SupportedClutchLlmProvider; status: "loading" }
  | { models: []; provider: null; status: "idle" };

type AppActions = ReturnType<typeof useAppStore.getState>["actions"];

const MODEL_SETTINGS_ROWS: ModelSettingsRow[] = [
  "primary",
  "summarization",
  "done",
];
const VISIBLE_MODEL_COUNT = 10;

export function ConfigScreen({ task }: ConfigScreenProps) {
  const actions = useAppStore((state) => state.actions);
  const [stage, setStage] = useState<ConfigStage>("providers");
  const [providerIndex, setProviderIndex] = useState(0);
  const [tokenProvider, setTokenProvider] =
    useState<SupportedClutchLlmProvider>(SUPPORTED_CLUTCH_LLM_PROVIDERS[0].id);
  const [token, setToken] = useState("");
  const [modelSettingsIndex, setModelSettingsIndex] = useState(0);
  const [activeModelEntry, setActiveModelEntry] =
    useState<ModelEntry>("primary");
  const [modelProviderIndex, setModelProviderIndex] = useState(0);
  const [modelIndex, setModelIndex] = useState(0);
  const [modelFilter, setModelFilter] = useState("");
  const [primary, setPrimary] = useState(task.primary);
  const [summarization, setSummarization] = useState(task.summarization);
  const [message, setMessage] = useState<string | null>(null);
  const [configuredProviders, setConfiguredProviders] = useState(
    task.configuredProviders,
  );
  const [modelLoad, setModelLoad] = useState<ModelLoadState>({
    models: [],
    provider: null,
    status: "idle",
  });

  const activeSelection =
    activeModelEntry === "primary" ? primary : summarization;

  useEffect(() => {
    if (stage !== "model-model") {
      return;
    }

    const controller = new AbortController();
    const provider = activeSelection.provider;
    setModelLoad({ models: [], provider, status: "loading" });
    fetchClutchProviderModels({ provider, signal: controller.signal })
      .then((models) => {
        if (controller.signal.aborted) {
          return;
        }
        setModelLoad({ models, provider, status: "loaded" });
        setModelIndex(indexOfModel(activeSelection, models));
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }
        setModelLoad({
          errorMessage: error instanceof Error ? error.message : String(error),
          models: [],
          provider,
          status: "error",
        });
      });

    return () => controller.abort();
  }, [activeSelection.model, activeSelection.provider, stage]);

  usePaste((event) => {
    if (stage !== "token") {
      return;
    }

    const pastedToken = sanitizeTokenInput(decodePasteBytes(event.bytes));
    if (pastedToken.length === 0) {
      return;
    }

    setToken((currentToken) => `${currentToken}${pastedToken}`);
    setMessage(null);
    event.preventDefault();
    event.stopPropagation();
  });

  useKeyboard((event) => {
    if (stage === "providers") {
      handleProvidersKey({
        actions,
        event,
        providerIndex,
        setMessage,
        setProviderIndex,
        setStage,
        setToken,
        setTokenProvider,
        task,
      });
      return;
    }

    if (stage === "token") {
      handleTokenKey({
        configuredProviders,
        event,
        setConfiguredProviders,
        setMessage,
        setStage,
        setToken,
        token,
        tokenProvider,
      });
      return;
    }

    if (stage === "model-settings") {
      handleModelSettingsKey({
        actions,
        event,
        modelSettingsIndex,
        primary,
        setActiveModelEntry,
        setMessage,
        setModelProviderIndex,
        setModelSettingsIndex,
        setStage,
        summarization,
      });
      return;
    }

    if (stage === "model-provider") {
      handleModelProviderKey({
        activeModelEntry,
        event,
        modelProviderIndex,
        primary,
        setMessage,
        setModelFilter,
        setModelIndex,
        setModelProviderIndex,
        setPrimary,
        setStage,
        setSummarization,
        summarization,
      });
      return;
    }

    handleModelChoiceKey({
      activeModelEntry,
      event,
      modelFilter,
      modelIndex,
      modelLoad,
      primary,
      setMessage,
      setModelFilter,
      setModelIndex,
      setPrimary,
      setStage,
      setSummarization,
      summarization,
    });
  });

  return (
    <box
      style={{
        alignItems: "center",
        flexGrow: 1,
        height: "100%",
        justifyContent: "center",
        width: "100%",
      }}
    >
      <box
        title={stageTitle({ activeModelEntry, stage, task })}
        bottomTitle={hotkeysForStage(stage, task)}
        bottomTitleAlignment="right"
        borderStyle="rounded"
        style={{
          border: true,
          flexDirection: "column",
          gap: 1,
          padding: 1,
          width: "80%",
        }}
      >
        {stage === "providers" ? (
          <ProvidersStep
            configuredProviders={configuredProviders}
            message={message}
            providerIndex={providerIndex}
            task={task}
          />
        ) : null}
        {stage === "token" ? (
          <TokenStep message={message} token={token} provider={tokenProvider} />
        ) : null}
        {stage === "model-settings" ? (
          <ModelSettingsStep
            message={message}
            primary={primary}
            rowIndex={modelSettingsIndex}
            summarization={summarization}
          />
        ) : null}
        {stage === "model-provider" ? (
          <ModelProviderStep
            activeModelEntry={activeModelEntry}
            message={message}
            providerIndex={modelProviderIndex}
          />
        ) : null}
        {stage === "model-model" ? (
          <ModelChoiceStep
            activeModelEntry={activeModelEntry}
            filter={modelFilter}
            message={message}
            modelIndex={modelIndex}
            modelLoad={modelLoad}
            primary={primary}
            summarization={summarization}
          />
        ) : null}
      </box>
    </box>
  );
}

function ProvidersStep({
  configuredProviders,
  message,
  providerIndex,
  task,
}: {
  configuredProviders: readonly SupportedClutchLlmProvider[];
  message: string | null;
  providerIndex: number;
  task: ConfigTaskState;
}) {
  return (
    <>
      <text>
        {task.mode === "first-run"
          ? "Add provider credentials, then configure models."
          : "Provider credentials"}
      </text>
      {providerRows(configuredProviders).map((row, index) => (
        <text
          key={row.key}
          style={index === providerIndex ? selectedStyle : undefined}
        >
          {`${index === providerIndex ? ">" : " "} ${row.label}`}
        </text>
      ))}
      {message === null ? null : (
        <text style={{ fg: "yellow" }}>{message}</text>
      )}
    </>
  );
}

function TokenStep({
  message,
  provider,
  token,
}: {
  message: string | null;
  provider: SupportedClutchLlmProvider;
  token: string;
}) {
  return (
    <>
      <text>{`Provider: ${getSupportedClutchProviderLabel(provider)}`}</text>
      <text>{`Token: ${token.length === 0 ? "" : "*".repeat(token.length)}`}</text>
      <text style={{ fg: "gray" }}>Paste or type the API token.</text>
      {message === null ? null : <text style={{ fg: "red" }}>{message}</text>}
    </>
  );
}

function ModelSettingsStep({
  message,
  primary,
  rowIndex,
  summarization,
}: {
  message: string | null;
  primary: ClutchModelSelection;
  rowIndex: number;
  summarization: ClutchModelSelection;
}) {
  return (
    <>
      <text>Model settings</text>
      {MODEL_SETTINGS_ROWS.map((row, index) => (
        <text key={row} style={index === rowIndex ? selectedStyle : undefined}>
          {`${index === rowIndex ? ">" : " "} ${modelSettingsRowLabel({ primary, row, summarization })}`}
        </text>
      ))}
      {message === null ? null : (
        <text style={{ fg: "yellow" }}>{message}</text>
      )}
    </>
  );
}

function ModelProviderStep({
  activeModelEntry,
  message,
  providerIndex,
}: {
  activeModelEntry: ModelEntry;
  message: string | null;
  providerIndex: number;
}) {
  return (
    <>
      <text>{`Choose provider for ${entryLabel(activeModelEntry)}.`}</text>
      {SUPPORTED_CLUTCH_LLM_PROVIDERS.map((provider, index) => (
        <text
          key={provider.id}
          style={index === providerIndex ? selectedStyle : undefined}
        >
          {`${index === providerIndex ? ">" : " "} ${provider.label}`}
        </text>
      ))}
      {message === null ? null : (
        <text style={{ fg: "yellow" }}>{message}</text>
      )}
    </>
  );
}

function ModelChoiceStep({
  activeModelEntry,
  filter,
  message,
  modelIndex,
  modelLoad,
  primary,
  summarization,
}: {
  activeModelEntry: ModelEntry;
  filter: string;
  message: string | null;
  modelIndex: number;
  modelLoad: ModelLoadState;
  primary: ClutchModelSelection;
  summarization: ClutchModelSelection;
}) {
  const selection = activeModelEntry === "primary" ? primary : summarization;
  const matches = matchingModels({ filter, models: modelLoad.models });
  const visibleModels = getVisibleModels({ modelIndex, models: matches });

  return (
    <>
      <text>{`Choose model for ${entryLabel(activeModelEntry)}.`}</text>
      <text style={{ fg: "gray" }}>
        {modelChoiceStatusLabel({
          filter,
          modelLoad,
          provider: selection.provider,
        })}
      </text>
      {modelLoad.status === "loading" ? <text>Loading models…</text> : null}
      {modelLoad.status === "error" ? (
        <text style={{ fg: "red" }}>{modelLoad.errorMessage}</text>
      ) : null}
      {visibleModels.map(({ index, model }) => (
        <text
          key={model.id}
          style={index === modelIndex ? selectedStyle : undefined}
        >
          {`${index === modelIndex ? ">" : " "} ${model.id} — ${model.name}`}
        </text>
      ))}
      {modelLoad.status === "loaded" && matches.length === 0 ? (
        <text>No matching models.</text>
      ) : null}
      {message === null ? null : <text style={{ fg: "red" }}>{message}</text>}
    </>
  );
}

function handleProvidersKey({
  actions,
  event,
  providerIndex,
  setMessage,
  setProviderIndex,
  setStage,
  setToken,
  setTokenProvider,
  task,
}: {
  actions: AppActions;
  event: KeyEvent;
  providerIndex: number;
  setMessage: (message: string | null) => void;
  setProviderIndex: (index: number) => void;
  setStage: (stage: ConfigStage) => void;
  setToken: (token: string) => void;
  setTokenProvider: (provider: SupportedClutchLlmProvider) => void;
  task: ConfigTaskState;
}) {
  if (event.name === "escape" && task.mode === "settings") {
    actions.navigation.showComposer();
    prevent(event);
    return;
  }

  const rows = providerRows([]);
  if (event.name === "up" || event.name === "down") {
    setProviderIndex(
      cycleIndex(providerIndex, rows.length, event.name === "down" ? 1 : -1),
    );
    setMessage(null);
    prevent(event);
    return;
  }

  if (event.name !== "return") {
    return;
  }

  const row = rows[providerIndex];
  if (row === undefined) {
    throw new Error(`Invalid provider row index: ${providerIndex}`);
  }

  if (row.kind === "models") {
    setStage("model-settings");
    setMessage(null);
    prevent(event);
    return;
  }

  setTokenProvider(row.provider);
  setToken("");
  setStage("token");
  setMessage(null);
  prevent(event);
}

function handleTokenKey({
  configuredProviders,
  event,
  setConfiguredProviders,
  setMessage,
  setStage,
  setToken,
  token,
  tokenProvider,
}: {
  configuredProviders: readonly SupportedClutchLlmProvider[];
  event: KeyEvent;
  setConfiguredProviders: (providers: SupportedClutchLlmProvider[]) => void;
  setMessage: (message: string | null) => void;
  setStage: (stage: ConfigStage) => void;
  setToken: (token: string) => void;
  token: string;
  tokenProvider: SupportedClutchLlmProvider;
}) {
  if (event.name === "escape") {
    setStage("providers");
    setMessage(null);
    prevent(event);
    return;
  }

  if (event.name === "return" || (event.ctrl && event.name === "s")) {
    try {
      saveClutchApiKey({ apiKey: token, provider: tokenProvider });
      setConfiguredProviders(
        Array.from(new Set([...configuredProviders, tokenProvider])),
      );
      setToken("");
      setStage("providers");
      setMessage(
        `Saved token for ${getSupportedClutchProviderLabel(tokenProvider)}.`,
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
    prevent(event);
    return;
  }

  if (event.ctrl && event.name === "u") {
    setToken("");
    prevent(event);
    return;
  }

  if (event.name === "backspace") {
    setToken(token.slice(0, -1));
    prevent(event);
    return;
  }

  const tokenInput = getPrintableInput(event);
  if (tokenInput !== null) {
    setToken(`${token}${sanitizeTokenInput(tokenInput)}`);
    setMessage(null);
    prevent(event);
  }
}

function handleModelSettingsKey({
  actions,
  event,
  modelSettingsIndex,
  primary,
  setActiveModelEntry,
  setMessage,
  setModelProviderIndex,
  setModelSettingsIndex,
  setStage,
  summarization,
}: {
  actions: AppActions;
  event: KeyEvent;
  modelSettingsIndex: number;
  primary: ClutchModelSelection;
  setActiveModelEntry: (entry: ModelEntry) => void;
  setMessage: (message: string | null) => void;
  setModelProviderIndex: (index: number) => void;
  setModelSettingsIndex: (index: number) => void;
  setStage: (stage: ConfigStage) => void;
  summarization: ClutchModelSelection;
}) {
  if (event.name === "escape") {
    setStage("providers");
    setMessage(null);
    prevent(event);
    return;
  }

  if (event.name === "up" || event.name === "down") {
    setModelSettingsIndex(
      cycleIndex(
        modelSettingsIndex,
        MODEL_SETTINGS_ROWS.length,
        event.name === "down" ? 1 : -1,
      ),
    );
    setMessage(null);
    prevent(event);
    return;
  }

  if (event.name !== "return") {
    return;
  }

  const row = MODEL_SETTINGS_ROWS[modelSettingsIndex];
  if (row === undefined) {
    throw new Error(`Invalid model settings row index: ${modelSettingsIndex}`);
  }

  if (row === "done") {
    try {
      saveClutchModelConfiguration({ primary, summarization });
      actions.config.closeAfterSave();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
    prevent(event);
    return;
  }

  const selection = row === "primary" ? primary : summarization;
  setActiveModelEntry(row);
  setModelProviderIndex(providerIndexFor(selection.provider));
  setStage("model-provider");
  setMessage(null);
  prevent(event);
}

function handleModelProviderKey({
  activeModelEntry,
  event,
  modelProviderIndex,
  primary,
  setMessage,
  setModelFilter,
  setModelIndex,
  setModelProviderIndex,
  setPrimary,
  setStage,
  setSummarization,
  summarization,
}: {
  activeModelEntry: ModelEntry;
  event: KeyEvent;
  modelProviderIndex: number;
  primary: ClutchModelSelection;
  setMessage: (message: string | null) => void;
  setModelFilter: (filter: string) => void;
  setModelIndex: (index: number) => void;
  setModelProviderIndex: (index: number) => void;
  setPrimary: (selection: ClutchModelSelection) => void;
  setStage: (stage: ConfigStage) => void;
  setSummarization: (selection: ClutchModelSelection) => void;
  summarization: ClutchModelSelection;
}) {
  if (event.name === "escape") {
    setStage("model-settings");
    setMessage(null);
    prevent(event);
    return;
  }

  if (event.name === "up" || event.name === "down") {
    setModelProviderIndex(
      cycleIndex(
        modelProviderIndex,
        SUPPORTED_CLUTCH_LLM_PROVIDERS.length,
        event.name === "down" ? 1 : -1,
      ),
    );
    setMessage(null);
    prevent(event);
    return;
  }

  if (event.name !== "return") {
    return;
  }

  const provider = SUPPORTED_CLUTCH_LLM_PROVIDERS[modelProviderIndex]?.id;
  if (provider === undefined) {
    throw new Error(`Invalid model provider row index: ${modelProviderIndex}`);
  }

  const currentSelection =
    activeModelEntry === "primary" ? primary : summarization;
  const selection =
    currentSelection.provider === provider
      ? currentSelection
      : { model: "", provider };
  setActiveSelection({
    activeModelEntry,
    selection,
    setPrimary,
    setSummarization,
  });
  setModelIndex(0);
  setModelFilter("");
  setStage("model-model");
  setMessage(null);
  prevent(event);
}

function handleModelChoiceKey({
  activeModelEntry,
  event,
  modelFilter,
  modelIndex,
  modelLoad,
  primary,
  setMessage,
  setModelFilter,
  setModelIndex,
  setPrimary,
  setStage,
  setSummarization,
  summarization,
}: {
  activeModelEntry: ModelEntry;
  event: KeyEvent;
  modelFilter: string;
  modelIndex: number;
  modelLoad: ModelLoadState;
  primary: ClutchModelSelection;
  setMessage: (message: string | null) => void;
  setModelFilter: (filter: string) => void;
  setModelIndex: (index: number) => void;
  setPrimary: (selection: ClutchModelSelection) => void;
  setStage: (stage: ConfigStage) => void;
  setSummarization: (selection: ClutchModelSelection) => void;
  summarization: ClutchModelSelection;
}) {
  const selection = activeModelEntry === "primary" ? primary : summarization;
  const matches = matchingModels({
    filter: modelFilter,
    models: modelLoad.models,
  });

  if (event.name === "escape") {
    setStage("model-provider");
    setMessage(null);
    prevent(event);
    return;
  }

  if (event.name === "up" || event.name === "down") {
    if (matches.length > 0) {
      setModelIndex(
        cycleIndex(modelIndex, matches.length, event.name === "down" ? 1 : -1),
      );
    }
    setMessage(null);
    prevent(event);
    return;
  }

  if (event.name === "return") {
    if (modelLoad.status !== "loaded") {
      setMessage("Models are not loaded yet.");
      prevent(event);
      return;
    }

    const model = matches[modelIndex];
    if (model === undefined) {
      setMessage("Choose a model before continuing.");
      prevent(event);
      return;
    }

    setActiveSelection({
      activeModelEntry,
      selection: { ...selection, metadata: model, model: model.id },
      setPrimary,
      setSummarization,
    });
    setModelFilter("");
    setStage("model-settings");
    setMessage(
      `${entryLabel(activeModelEntry)} model updated. Choose Done to save.`,
    );
    prevent(event);
    return;
  }

  if (event.ctrl && event.name === "u") {
    setModelFilter("");
    setModelIndex(indexOfModel(selection, modelLoad.models));
    setMessage(null);
    prevent(event);
    return;
  }

  if (event.name === "backspace") {
    const nextFilter = modelFilter.slice(0, -1);
    setModelFilter(nextFilter);
    setModelIndex(0);
    setMessage(null);
    prevent(event);
    return;
  }

  const filterInput = getPrintableInput(event);
  if (filterInput !== null) {
    setModelFilter(`${modelFilter}${filterInput}`);
    setModelIndex(0);
    setMessage(null);
    prevent(event);
  }
}

function modelSettingsRowLabel({
  primary,
  row,
  summarization,
}: {
  primary: ClutchModelSelection;
  row: ModelSettingsRow;
  summarization: ClutchModelSelection;
}): string {
  if (row === "done") {
    return "Done";
  }

  const selection = row === "primary" ? primary : summarization;
  return `${entryLabel(row)}: ${getSupportedClutchProviderLabel(selection.provider)} / ${selection.model.length === 0 ? "(choose model)" : selection.model}`;
}

function providerRows(
  configuredProviders: readonly SupportedClutchLlmProvider[],
) {
  return [
    ...SUPPORTED_CLUTCH_LLM_PROVIDERS.map((provider) => ({
      key: provider.id,
      kind: "provider" as const,
      label: `${provider.label}${configuredProviders.includes(provider.id) ? " ✓" : ""}`,
      provider: provider.id,
    })),
    {
      key: "models",
      kind: "models" as const,
      label: "Configure models",
    },
  ];
}

function modelChoiceStatusLabel({
  filter,
  modelLoad,
  provider,
}: {
  filter: string;
  modelLoad: ModelLoadState;
  provider: SupportedClutchLlmProvider;
}): string {
  const base = `Provider: ${getSupportedClutchProviderLabel(provider)}`;
  const loadedCount =
    modelLoad.status === "loaded" ? ` · ${modelLoad.models.length} models` : "";
  return `${base}${loadedCount}${filter.length === 0 ? "" : ` · filter: ${filter}`}`;
}

function setActiveSelection({
  activeModelEntry,
  selection,
  setPrimary,
  setSummarization,
}: {
  activeModelEntry: ModelEntry;
  selection: ClutchModelSelection;
  setPrimary: (selection: ClutchModelSelection) => void;
  setSummarization: (selection: ClutchModelSelection) => void;
}) {
  if (activeModelEntry === "primary") {
    setPrimary(selection);
    return;
  }

  setSummarization(selection);
}

function matchingModels({
  filter,
  models,
}: {
  filter: string;
  models: readonly Model<Api>[];
}) {
  const normalizedFilter = filter.trim().toLowerCase();
  if (normalizedFilter.length === 0) {
    return models;
  }

  return models.filter(
    (model) =>
      model.id.toLowerCase().includes(normalizedFilter) ||
      model.name.toLowerCase().includes(normalizedFilter),
  );
}

function getVisibleModels<T>({
  modelIndex,
  models,
}: {
  modelIndex: number;
  models: readonly T[];
}): { index: number; model: T }[] {
  const start = Math.max(0, modelIndex - Math.floor(VISIBLE_MODEL_COUNT / 2));
  return models
    .slice(start, start + VISIBLE_MODEL_COUNT)
    .map((model, index) => ({
      index: start + index,
      model,
    }));
}

function indexOfModel(
  selection: ClutchModelSelection,
  models: readonly Model<Api>[],
): number {
  return Math.max(
    0,
    models.findIndex((model) => model.id === selection.model),
  );
}

function providerIndexFor(provider: SupportedClutchLlmProvider): number {
  const index = SUPPORTED_CLUTCH_LLM_PROVIDERS.findIndex(
    (candidate) => candidate.id === provider,
  );
  if (index === -1) {
    throw new Error(`Unknown config provider: ${provider}`);
  }
  return index;
}

function cycleIndex(index: number, length: number, direction: 1 | -1): number {
  return (index + direction + length) % length;
}

function stageTitle({
  activeModelEntry,
  stage,
  task,
}: {
  activeModelEntry: ModelEntry;
  stage: ConfigStage;
  task: ConfigTaskState;
}): string {
  switch (stage) {
    case "providers":
      return task.mode === "first-run" ? "Setup providers" : "Providers";
    case "token":
      return "Provider token";
    case "model-settings":
      return "Model settings";
    case "model-provider":
      return `${entryLabel(activeModelEntry)} provider`;
    case "model-model":
      return `${entryLabel(activeModelEntry)} model`;
  }
}

function hotkeysForStage(stage: ConfigStage, task: ConfigTaskState): string {
  switch (stage) {
    case "providers":
      return `${task.mode === "settings" ? "Esc return · " : ""}↑/↓ select · Enter open`;
    case "token":
      return "Esc back · paste/type token · Ctrl+u clear · Enter save";
    case "model-settings":
      return "Esc providers · ↑/↓ select · Enter edit/done";
    case "model-provider":
      return "Esc back · ↑/↓ choose provider · Enter next";
    case "model-model":
      return "Esc back · ↑/↓ choose model · type filter · Ctrl+u clear · Enter choose";
  }
}

function entryLabel(entry: ModelEntry): string {
  return entry === "primary" ? "Primary" : "Summarization";
}

function getPrintableInput(event: KeyEvent): string | null {
  if (event.ctrl || event.meta || event.option || event.sequence.length === 0) {
    return null;
  }

  const sanitized = stripAnsiSequences(event.sequence).replace(/[\n\r]/g, "");
  if (sanitized.length === 0 || sanitized[0] < " ") {
    return null;
  }

  return sanitized;
}

function sanitizeTokenInput(input: string): string {
  return stripAnsiSequences(input)
    .replace(/[\n\r]/g, "")
    .trim();
}

function prevent(event: KeyEvent) {
  event.preventDefault();
  event.stopPropagation();
}

const selectedStyle = { bg: "blue", fg: "white" } as const;
