import {
  decodePasteBytes,
  stripAnsiSequences,
  type KeyEvent,
} from "@opentui/core";
import { useKeyboard, usePaste } from "@opentui/react";
import { useEffect, useState } from "react";
import type { ConfigTaskState } from "../../app/appTypes";
import {
  CLUTCH_MODEL_EFFORT_LEVELS,
  getClutchModelEffortLevel,
  getClutchOpenRouterServiceTier,
  getClutchProviderLabel,
  loadClutchAuth,
  loadClutchSettings,
  OPENROUTER_PROVIDER_ID,
  saveClutchAgentBackendConfiguration,
  saveClutchApiKey,
  saveClutchEndpointConfiguration,
  deleteClutchEndpointConfiguration,
  saveClutchModelConfiguration,
  type ClutchAgentBackendConfig,
  type ClutchEndpoint,
  type ClutchModelEffortLevel,
  type ClutchModelSelection,
} from "../../lib/config/clutchConfig";
import {
  fetchClutchProviderModels,
  type ClutchProviderModel,
} from "../../lib/config/providerModels";
import { useAppStore } from "../../store/appStore";
import {
  buildModelSettingsRows,
  commitOpenRouterModelSelection,
  entryLabel,
  getModelEntrySelection,
  modelSettingsRowKey,
  modelSettingsRowLabel,
  OPENROUTER_SORT_OPTIONS,
  openRouterServiceTierIndex,
  openRouterServiceTierOptions,
  openRouterSortIndex,
  openRouterVendorIndex,
  openRouterVendorOptions,
  providerExtrasJson,
  selectionWithOpenRouterSort,
  selectionWithOpenRouterVendor,
  selectionWithProviderExtrasJson,
  parseJsonObject,
  parseJsonStringArray,
  parseJsonStringRecord,
  type ModelEntry,
  type ModelSettingsRow,
} from "./configScreenHelpers";

type ConfigScreenProps = {
  task: ConfigTaskState;
};

type ConfigStage =
  | "agent-backend"
  | "endpoint-form"
  | "model-model"
  | "model-option"
  | "model-provider"
  | "model-settings"
  | "providers"
  | "token";
type ModelOptionKey =
  | "effort"
  | "providerExtras"
  | "serviceTier"
  | "sort"
  | "vendor";
type AgentBackendField = "args" | "command" | "env";
type AgentBackendRow = AgentBackendField | "save";
type AgentBackendForm = {
  argsJson: string;
  command: string;
  envJson: string;
};
type EndpointFormField =
  | "apiKey"
  | "baseUrl"
  | "headersJson"
  | "id"
  | "label"
  | "requestDefaultsJson";
type EndpointFormRow = EndpointFormField | "delete" | "save";
type EndpointFormMode = "add" | "edit";
type EndpointForm = {
  apiKey: string;
  baseUrl: string;
  headersJson: string;
  id: string;
  label: string;
  requestDefaultsJson: string;
};
type ModelLoadState =
  | {
      models: ClutchProviderModel[];
      provider: string;
      status: "loaded";
    }
  | {
      errorMessage: string;
      models: [];
      provider: string;
      status: "error";
    }
  | { models: []; provider: string; status: "loading" }
  | { models: []; provider: null; status: "idle" };

type AppActions = ReturnType<typeof useAppStore.getState>["actions"];

const AGENT_BACKEND_ROWS: AgentBackendRow[] = [
  "command",
  "args",
  "env",
  "save",
];
const VISIBLE_MODEL_COUNT = 10;

export function ConfigScreen({ task }: ConfigScreenProps) {
  const actions = useAppStore((state) => state.actions);
  const [stage, setStage] = useState<ConfigStage>("providers");
  const [providerIndex, setProviderIndex] = useState(0);
  const [tokenProvider, setTokenProvider] = useState(OPENROUTER_PROVIDER_ID);
  const [token, setToken] = useState("");
  const [modelSettingsIndex, setModelSettingsIndex] = useState(0);
  const [activeModelEntry, setActiveModelEntry] =
    useState<ModelEntry>("primary");
  const [modelProviderIndex, setModelProviderIndex] = useState(0);
  const [modelOptionKey, setModelOptionKey] = useState<ModelOptionKey>("sort");
  const [modelOptionIndex, setModelOptionIndex] = useState(0);
  const [modelIndex, setModelIndex] = useState(0);
  const [modelFilter, setModelFilter] = useState("");
  const [agentBackendForm, setAgentBackendForm] = useState(
    agentBackendFormFromConfig(task.agentBackend),
  );
  const [agentBackendRowIndex, setAgentBackendRowIndex] = useState(0);
  const [primary, setPrimary] = useState(task.primary);
  const [summarization, setSummarization] = useState(task.summarization);
  const [message, setMessage] = useState<string | null>(null);
  const [configuredProviders, setConfiguredProviders] = useState(
    task.configuredProviders,
  );
  const [endpoints, setEndpoints] = useState(task.endpoints);
  const [endpointForm, setEndpointForm] = useState<EndpointForm | null>(null);
  const [endpointFormMode, setEndpointFormMode] =
    useState<EndpointFormMode>("add");
  const [endpointFormRowIndex, setEndpointFormRowIndex] = useState(0);
  const [providerExtrasDraft, setProviderExtrasDraft] = useState("{}");
  const [modelCommitPending, setModelCommitPending] = useState(false);
  const [modelLoad, setModelLoad] = useState<ModelLoadState>({
    models: [],
    provider: null,
    status: "idle",
  });

  const activeSelection = getModelEntrySelection({
    entry: activeModelEntry,
    primary,
    summarization,
  });
  const modelSettingsRows = buildModelSettingsRows({
    primary,
    summarization,
  });

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
    if (
      stage !== "token" &&
      stage !== "agent-backend" &&
      stage !== "endpoint-form" &&
      !(stage === "model-option" && modelOptionKey === "providerExtras")
    ) {
      return;
    }

    const pastedToken = sanitizeLineInput(decodePasteBytes(event.bytes));
    if (pastedToken.length === 0) {
      return;
    }

    if (stage === "token") {
      setToken((currentToken) => `${currentToken}${pastedToken}`);
    } else if (stage === "model-option") {
      setProviderExtrasDraft((current) => `${current}${pastedToken}`);
    } else if (stage === "endpoint-form") {
      const row = endpointFormRows(endpointFormMode)[endpointFormRowIndex];
      if (row !== undefined && isEndpointFormField(row)) {
        setEndpointForm((form) =>
          updateEndpointFormField(
            form ?? emptyEndpointForm(),
            row,
            (value) => `${value}${pastedToken}`,
          ),
        );
      }
    } else {
      const row = AGENT_BACKEND_ROWS[agentBackendRowIndex];
      if (row !== undefined && row !== "save") {
        setAgentBackendForm((form) =>
          updateAgentBackendField(
            form,
            row,
            (value) => `${value}${pastedToken}`,
          ),
        );
      }
    }
    setMessage(null);
    event.preventDefault();
    event.stopPropagation();
  });

  useKeyboard((event) => {
    if (stage === "providers") {
      handleProvidersKey({
        actions,
        configuredProviders,
        endpoints,
        event,
        providerIndex,
        agentBackendConfigured: agentBackendForm.command.trim().length > 0,
        setEndpointForm,
        setEndpointFormMode,
        setEndpointFormRowIndex,
        setMessage,
        setProviderIndex,
        setStage,
        setToken,
        setTokenProvider,
        task,
      });
      return;
    }

    if (stage === "endpoint-form") {
      handleEndpointFormKey({
        endpointForm,
        endpointFormMode,
        endpointFormRowIndex,
        event,
        setConfiguredProviders,
        setEndpointForm,
        setEndpointFormRowIndex,
        setEndpoints,
        setMessage,
        setStage,
      });
      return;
    }

    if (stage === "agent-backend") {
      handleAgentBackendKey({
        agentBackendForm,
        agentBackendRowIndex,
        event,
        setAgentBackendForm,
        setAgentBackendRowIndex,
        setMessage,
        setStage,
      });
      return;
    }

    if (stage === "token") {
      handleTokenKey({
        configuredProviders,
        endpoints,
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
        configuredProviders,
        endpoints,
        event,
        modelSettingsIndex,
        modelSettingsRows,
        primary,
        setActiveModelEntry,
        setMessage,
        setModelFilter,
        setModelIndex,
        setModelOptionIndex,
        setModelOptionKey,
        setModelProviderIndex,
        setModelSettingsIndex,
        setPrimary,
        setProviderExtrasDraft,
        setStage,
        setSummarization,
        summarization,
      });
      return;
    }

    if (stage === "model-option") {
      handleModelOptionKey({
        activeModelEntry,
        event,
        modelOptionIndex,
        modelOptionKey,
        primary,
        providerExtrasDraft,
        setMessage,
        setModelOptionIndex,
        setPrimary,
        setProviderExtrasDraft,
        setStage,
        setSummarization,
        summarization,
      });
      return;
    }

    if (stage === "model-provider") {
      handleModelProviderKey({
        activeModelEntry,
        configuredProviders,
        endpoints,
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
      configuredProviders,
      endpoints,
      event,
      modelCommitPending,
      modelFilter,
      modelIndex,
      modelLoad,
      primary,
      setMessage,
      setModelCommitPending,
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
        title={stageTitle({ activeModelEntry, modelOptionKey, stage, task })}
        bottomTitle={hotkeysForStage(stage, task, modelOptionKey)}
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
            agentBackendConfigured={agentBackendForm.command.trim().length > 0}
            configuredProviders={configuredProviders}
            endpoints={endpoints}
            message={message}
            providerIndex={providerIndex}
            task={task}
          />
        ) : null}
        {stage === "endpoint-form" ? (
          <EndpointFormStep
            form={endpointForm ?? emptyEndpointForm()}
            message={message}
            mode={endpointFormMode}
            rowIndex={endpointFormRowIndex}
          />
        ) : null}
        {stage === "token" ? (
          <TokenStep
            endpoints={endpoints}
            message={message}
            token={token}
            provider={tokenProvider}
          />
        ) : null}
        {stage === "agent-backend" ? (
          <AgentBackendStep
            form={agentBackendForm}
            message={message}
            rowIndex={agentBackendRowIndex}
          />
        ) : null}
        {stage === "model-settings" ? (
          <ModelSettingsStep
            endpoints={endpoints}
            message={message}
            primary={primary}
            rowIndex={modelSettingsIndex}
            rows={modelSettingsRows}
            summarization={summarization}
          />
        ) : null}
        {stage === "model-provider" ? (
          <ModelProviderStep
            activeModelEntry={activeModelEntry}
            configuredProviders={configuredProviders}
            endpoints={endpoints}
            message={message}
            providerIndex={modelProviderIndex}
          />
        ) : null}
        {stage === "model-model" ? (
          <ModelChoiceStep
            activeModelEntry={activeModelEntry}
            endpoints={endpoints}
            filter={modelFilter}
            message={message}
            modelIndex={modelIndex}
            modelLoad={modelLoad}
            primary={primary}
            summarization={summarization}
          />
        ) : null}
        {stage === "model-option" ? (
          <ModelOptionStep
            activeModelEntry={activeModelEntry}
            message={message}
            optionIndex={modelOptionIndex}
            optionKey={modelOptionKey}
            primary={primary}
            providerExtrasDraft={providerExtrasDraft}
            summarization={summarization}
          />
        ) : null}
      </box>
    </box>
  );
}

function ProvidersStep({
  agentBackendConfigured,
  configuredProviders,
  endpoints,
  message,
  providerIndex,
  task,
}: {
  agentBackendConfigured: boolean;
  configuredProviders: readonly string[];
  endpoints: readonly ClutchEndpoint[];
  message: string | null;
  providerIndex: number;
  task: ConfigTaskState;
}) {
  return (
    <>
      <text>
        {task.mode === "first-run"
          ? "Add provider credentials, then configure models and ACP."
          : "Provider credentials"}
      </text>
      {providerRows({
        agentBackendConfigured,
        configuredProviders,
        endpoints,
      }).map((row, index) => (
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

function AgentBackendStep({
  form,
  message,
  rowIndex,
}: {
  form: AgentBackendForm;
  message: string | null;
  rowIndex: number;
}) {
  return (
    <>
      <text>ACP backend</text>
      {AGENT_BACKEND_ROWS.map((row, index) => (
        <text key={row} style={index === rowIndex ? selectedStyle : undefined}>
          {`${index === rowIndex ? ">" : " "} ${agentBackendRowLabel({ form, row })}`}
        </text>
      ))}
      {message === null ? null : <text style={{ fg: "red" }}>{message}</text>}
    </>
  );
}

function TokenStep({
  endpoints,
  message,
  provider,
  token,
}: {
  endpoints: readonly ClutchEndpoint[];
  message: string | null;
  provider: string;
  token: string;
}) {
  return (
    <>
      <text>{`Provider: ${getClutchProviderLabel(provider, { endpoints: [...endpoints] })}`}</text>
      <text>{`Token: ${token.length === 0 ? "" : "*".repeat(token.length)}`}</text>
      <text style={{ fg: "gray" }}>Paste or type the API token.</text>
      {message === null ? null : <text style={{ fg: "red" }}>{message}</text>}
    </>
  );
}

function ModelSettingsStep({
  endpoints,
  message,
  primary,
  rowIndex,
  rows,
  summarization,
}: {
  endpoints: readonly ClutchEndpoint[];
  message: string | null;
  primary: ClutchModelSelection;
  rowIndex: number;
  rows: ModelSettingsRow[];
  summarization: ClutchModelSelection;
}) {
  return (
    <>
      <text>Model settings</text>
      {rows.map((row, index) => (
        <text
          key={modelSettingsRowKey(row)}
          style={index === rowIndex ? selectedStyle : undefined}
        >
          {`${index === rowIndex ? ">" : " "} ${modelSettingsRowLabel({ endpoints, primary, row, summarization })}`}
        </text>
      ))}
      {message === null ? null : (
        <text style={{ fg: "yellow" }}>{message}</text>
      )}
    </>
  );
}

function ModelOptionStep({
  activeModelEntry,
  message,
  optionIndex,
  optionKey,
  primary,
  providerExtrasDraft,
  summarization,
}: {
  activeModelEntry: ModelEntry;
  message: string | null;
  optionIndex: number;
  optionKey: ModelOptionKey;
  primary: ClutchModelSelection;
  providerExtrasDraft: string;
  summarization: ClutchModelSelection;
}) {
  if (optionKey === "providerExtras") {
    return (
      <>
        <text>{`Provider extras JSON for ${entryLabel(activeModelEntry)}.`}</text>
        <text>{providerExtrasDraft}</text>
        {message === null ? null : <text style={{ fg: "red" }}>{message}</text>}
      </>
    );
  }

  const selection = getModelEntrySelection({
    entry: activeModelEntry,
    primary,
    summarization,
  });
  const prompt = modelOptionPrompt(optionKey, activeModelEntry);
  const options = modelOptionLabels(optionKey, selection);

  return (
    <>
      <text>{prompt}</text>
      {options.map((label, index) => (
        <text
          key={label}
          style={index === optionIndex ? selectedStyle : undefined}
        >
          {`${index === optionIndex ? ">" : " "} ${label}`}
        </text>
      ))}
      {message === null ? null : (
        <text style={{ fg: "yellow" }}>{message}</text>
      )}
    </>
  );
}

function EndpointFormStep({
  form,
  message,
  mode,
  rowIndex,
}: {
  form: EndpointForm;
  message: string | null;
  mode: EndpointFormMode;
  rowIndex: number;
}) {
  return (
    <>
      <text>{mode === "add" ? "Add endpoint" : "Edit endpoint"}</text>
      {endpointFormRows(mode).map((row, index) => (
        <text key={row} style={index === rowIndex ? selectedStyle : undefined}>
          {`${index === rowIndex ? ">" : " "} ${endpointFormRowLabel({ form, mode, row })}`}
        </text>
      ))}
      {message === null ? null : <text style={{ fg: "red" }}>{message}</text>}
    </>
  );
}

function ModelProviderStep({
  activeModelEntry,
  configuredProviders,
  endpoints,
  message,
  providerIndex,
}: {
  activeModelEntry: ModelEntry;
  configuredProviders: readonly string[];
  endpoints: readonly ClutchEndpoint[];
  message: string | null;
  providerIndex: number;
}) {
  return (
    <>
      <text>{`Choose provider for ${entryLabel(activeModelEntry)}.`}</text>
      {modelProvidersForEntry({ configuredProviders, endpoints }).map(
        (provider, index) => (
          <text
            key={provider.id}
            style={index === providerIndex ? selectedStyle : undefined}
          >
            {`${index === providerIndex ? ">" : " "} ${provider.label}`}
          </text>
        ),
      )}
      {message === null ? null : (
        <text style={{ fg: "yellow" }}>{message}</text>
      )}
    </>
  );
}

function ModelChoiceStep({
  activeModelEntry,
  endpoints,
  filter,
  message,
  modelIndex,
  modelLoad,
  primary,
  summarization,
}: {
  activeModelEntry: ModelEntry;
  endpoints: readonly ClutchEndpoint[];
  filter: string;
  message: string | null;
  modelIndex: number;
  modelLoad: ModelLoadState;
  primary: ClutchModelSelection;
  summarization: ClutchModelSelection;
}) {
  const selection = getModelEntrySelection({
    entry: activeModelEntry,
    primary,
    summarization,
  });
  const matches = matchingModels({ filter, models: modelLoad.models });
  const visibleModels = getVisibleModels({ modelIndex, models: matches });

  return (
    <>
      <text>{`Choose model for ${entryLabel(activeModelEntry)}.`}</text>
      <text style={{ fg: "gray" }}>
        {modelChoiceStatusLabel({
          endpoints,
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
  agentBackendConfigured,
  configuredProviders,
  endpoints,
  event,
  providerIndex,
  setEndpointForm,
  setEndpointFormMode,
  setEndpointFormRowIndex,
  setMessage,
  setProviderIndex,
  setStage,
  setToken,
  setTokenProvider,
  task,
}: {
  actions: AppActions;
  agentBackendConfigured: boolean;
  configuredProviders: readonly string[];
  endpoints: readonly ClutchEndpoint[];
  event: KeyEvent;
  providerIndex: number;
  setEndpointForm: (form: EndpointForm | null) => void;
  setEndpointFormMode: (mode: EndpointFormMode) => void;
  setEndpointFormRowIndex: (index: number) => void;
  setMessage: (message: string | null) => void;
  setProviderIndex: (index: number) => void;
  setStage: (stage: ConfigStage) => void;
  setToken: (token: string) => void;
  setTokenProvider: (provider: string) => void;
  task: ConfigTaskState;
}) {
  if (event.name === "escape" && task.mode === "settings") {
    actions.navigation.dismissPane();
    prevent(event);
    return;
  }

  const rows = providerRows({
    agentBackendConfigured,
    configuredProviders,
    endpoints,
  });
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

  if (row.kind === "agent-backend") {
    setStage("agent-backend");
    setMessage(null);
    prevent(event);
    return;
  }

  if (row.kind === "add-endpoint") {
    setEndpointFormMode("add");
    setEndpointForm(emptyEndpointForm());
    setEndpointFormRowIndex(0);
    setStage("endpoint-form");
    setMessage(null);
    prevent(event);
    return;
  }

  if (row.kind === "endpoint") {
    const endpoint = endpoints.find((candidate) => candidate.id === row.endpointId);
    if (endpoint === undefined) {
      throw new Error(`Unknown endpoint id: ${row.endpointId}`);
    }
    setEndpointFormMode("edit");
    setEndpointForm(endpointFormFromEndpoint(endpoint));
    setEndpointFormRowIndex(0);
    setStage("endpoint-form");
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

function handleAgentBackendKey({
  agentBackendForm,
  agentBackendRowIndex,
  event,
  setAgentBackendForm,
  setAgentBackendRowIndex,
  setMessage,
  setStage,
}: {
  agentBackendForm: AgentBackendForm;
  agentBackendRowIndex: number;
  event: KeyEvent;
  setAgentBackendForm: (form: AgentBackendForm) => void;
  setAgentBackendRowIndex: (index: number) => void;
  setMessage: (message: string | null) => void;
  setStage: (stage: ConfigStage) => void;
}) {
  if (event.name === "escape") {
    setStage("providers");
    setMessage(null);
    prevent(event);
    return;
  }

  if (event.name === "up" || event.name === "down") {
    setAgentBackendRowIndex(
      cycleIndex(
        agentBackendRowIndex,
        AGENT_BACKEND_ROWS.length,
        event.name === "down" ? 1 : -1,
      ),
    );
    setMessage(null);
    prevent(event);
    return;
  }

  const row = AGENT_BACKEND_ROWS[agentBackendRowIndex];
  if (row === undefined) {
    throw new Error(`Invalid ACP backend row index: ${agentBackendRowIndex}`);
  }

  if (event.name === "return" || (event.ctrl && event.name === "s")) {
    if (row === "save" || event.ctrl) {
      try {
        const backend = agentBackendFromForm(agentBackendForm);
        saveClutchAgentBackendConfiguration({
          backend,
        });
        setAgentBackendForm(agentBackendFormFromConfig(backend));
        setStage("providers");
        setMessage("Saved ACP backend.");
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    }
    prevent(event);
    return;
  }

  if (row === "save") {
    return;
  }

  if (event.ctrl && event.name === "u") {
    setAgentBackendForm(
      updateAgentBackendField(agentBackendForm, row, () => ""),
    );
    setMessage(null);
    prevent(event);
    return;
  }

  if (event.name === "backspace") {
    setAgentBackendForm(
      updateAgentBackendField(agentBackendForm, row, (value) =>
        value.slice(0, -1),
      ),
    );
    setMessage(null);
    prevent(event);
    return;
  }

  const input = getPrintableInput(event);
  if (input !== null) {
    setAgentBackendForm(
      updateAgentBackendField(agentBackendForm, row, (value) => value + input),
    );
    setMessage(null);
    prevent(event);
  }
}

function handleTokenKey({
  configuredProviders,
  endpoints,
  event,
  setConfiguredProviders,
  setMessage,
  setStage,
  setToken,
  token,
  tokenProvider,
}: {
  configuredProviders: readonly string[];
  endpoints: readonly ClutchEndpoint[];
  event: KeyEvent;
  setConfiguredProviders: (providers: string[]) => void;
  setMessage: (message: string | null) => void;
  setStage: (stage: ConfigStage) => void;
  setToken: (token: string) => void;
  token: string;
  tokenProvider: string;
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
        `Saved token for ${getClutchProviderLabel(tokenProvider, { endpoints: [...endpoints] })}.`,
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
    setToken(`${token}${sanitizeLineInput(tokenInput).trim()}`);
    setMessage(null);
    prevent(event);
  }
}

function handleModelSettingsKey({
  actions,
  configuredProviders,
  endpoints,
  event,
  modelSettingsIndex,
  modelSettingsRows,
  primary,
  setActiveModelEntry,
  setMessage,
  setModelFilter,
  setModelIndex,
  setModelOptionIndex,
  setModelOptionKey,
  setModelProviderIndex,
  setModelSettingsIndex,
  setPrimary,
  setProviderExtrasDraft,
  setStage,
  setSummarization,
  summarization,
}: {
  actions: AppActions;
  configuredProviders: readonly string[];
  endpoints: readonly ClutchEndpoint[];
  event: KeyEvent;
  modelSettingsIndex: number;
  modelSettingsRows: ModelSettingsRow[];
  primary: ClutchModelSelection;
  setActiveModelEntry: (entry: ModelEntry) => void;
  setMessage: (message: string | null) => void;
  setModelFilter: (filter: string) => void;
  setModelIndex: (index: number) => void;
  setModelOptionIndex: (index: number) => void;
  setModelOptionKey: (key: ModelOptionKey) => void;
  setModelProviderIndex: (index: number) => void;
  setModelSettingsIndex: (index: number) => void;
  setPrimary: (selection: ClutchModelSelection) => void;
  setProviderExtrasDraft: (draft: string) => void;
  setStage: (stage: ConfigStage) => void;
  setSummarization: (selection: ClutchModelSelection) => void;
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
        modelSettingsRows.length,
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

  const row = modelSettingsRows[modelSettingsIndex];
  if (row === undefined) {
    throw new Error(`Invalid model settings row index: ${modelSettingsIndex}`);
  }

  if (row.kind === "done") {
    try {
      saveClutchModelConfiguration({ primary, summarization });
      actions.config.closeAfterSave();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
    prevent(event);
    return;
  }

  const selection = getModelEntrySelection({
    entry: row.entry,
    primary,
    summarization,
  });
  setActiveModelEntry(row.entry);
  if (row.kind === "model") {
    const providers = modelProvidersForEntry({ configuredProviders, endpoints });
    if (providers.length === 0) {
      setMessage("Configure a provider API key before choosing a model.");
      prevent(event);
      return;
    }
    if (providers.length === 1) {
      openModelChoiceForProvider({
        activeModelEntry: row.entry,
        currentSelection: selection,
        provider: providers[0]!.id,
        setMessage,
        setModelFilter,
        setModelIndex,
        setPrimary,
        setStage,
        setSummarization,
      });
      prevent(event);
      return;
    }
    setModelProviderIndex(
      providerIndexFor(selection.provider, { configuredProviders, endpoints }),
    );
    setStage("model-provider");
  } else {
    const optionKey = modelSettingsKindToOptionKey(row.kind);
    setModelOptionKey(optionKey);
    if (optionKey === "providerExtras") {
      setProviderExtrasDraft(providerExtrasJson(selection));
    } else {
      setModelOptionIndex(modelOptionIndexFor(optionKey, selection));
    }
    setStage("model-option");
  }
  setMessage(null);
  prevent(event);
}

function handleModelProviderKey({
  activeModelEntry,
  configuredProviders,
  endpoints,
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
  configuredProviders: readonly string[];
  endpoints: readonly ClutchEndpoint[];
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

  const providers = modelProvidersForEntry({ configuredProviders, endpoints });

  if (event.name === "up" || event.name === "down") {
    setModelProviderIndex(
      cycleIndex(
        modelProviderIndex,
        providers.length,
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

  const provider = providers[modelProviderIndex]?.id;
  if (provider === undefined) {
    throw new Error(`Invalid model provider row index: ${modelProviderIndex}`);
  }

  openModelChoiceForProvider({
    activeModelEntry,
    currentSelection: getModelEntrySelection({
      entry: activeModelEntry,
      primary,
      summarization,
    }),
    provider,
    setMessage,
    setModelFilter,
    setModelIndex,
    setPrimary,
    setStage,
    setSummarization,
  });
  prevent(event);
}

function openModelChoiceForProvider({
  activeModelEntry,
  currentSelection,
  provider,
  setMessage,
  setModelFilter,
  setModelIndex,
  setPrimary,
  setStage,
  setSummarization,
}: {
  activeModelEntry: ModelEntry;
  currentSelection: ClutchModelSelection;
  provider: string;
  setMessage: (message: string | null) => void;
  setModelFilter: (filter: string) => void;
  setModelIndex: (index: number) => void;
  setPrimary: (selection: ClutchModelSelection) => void;
  setStage: (stage: ConfigStage) => void;
  setSummarization: (selection: ClutchModelSelection) => void;
}) {
  const selection =
    currentSelection.provider === provider
      ? currentSelection
      : {
          effortLevel: getClutchModelEffortLevel(currentSelection),
          model: "",
          provider,
          ...(provider === OPENROUTER_PROVIDER_ID
            ? {
                openRouter: {
                  serviceTier: getClutchOpenRouterServiceTier(currentSelection),
                },
              }
            : {}),
        };
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
}

function handleModelOptionKey({
  activeModelEntry,
  event,
  modelOptionIndex,
  modelOptionKey,
  primary,
  providerExtrasDraft,
  setMessage,
  setModelOptionIndex,
  setPrimary,
  setProviderExtrasDraft,
  setStage,
  setSummarization,
  summarization,
}: {
  activeModelEntry: ModelEntry;
  event: KeyEvent;
  modelOptionIndex: number;
  modelOptionKey: ModelOptionKey;
  primary: ClutchModelSelection;
  providerExtrasDraft: string;
  setMessage: (message: string | null) => void;
  setModelOptionIndex: (index: number) => void;
  setPrimary: (selection: ClutchModelSelection) => void;
  setProviderExtrasDraft: (draft: string) => void;
  setStage: (stage: ConfigStage) => void;
  setSummarization: (selection: ClutchModelSelection) => void;
  summarization: ClutchModelSelection;
}) {
  const selection = getModelEntrySelection({
    entry: activeModelEntry,
    primary,
    summarization,
  });

  if (event.name === "escape") {
    setStage("model-settings");
    setMessage(null);
    prevent(event);
    return;
  }

  if (modelOptionKey === "providerExtras") {
    if (event.name === "return" || (event.ctrl && event.name === "s")) {
      try {
        setActiveSelection({
          activeModelEntry,
          selection: selectionWithProviderExtrasJson(
            selection,
            providerExtrasDraft,
          ),
          setPrimary,
          setSummarization,
        });
        setStage("model-settings");
        setMessage(
          `${entryLabel(activeModelEntry)} provider extras updated. Choose Done to save.`,
        );
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
      prevent(event);
      return;
    }

    if (event.ctrl && event.name === "u") {
      setProviderExtrasDraft("{}");
      setMessage(null);
      prevent(event);
      return;
    }

    if (event.name === "backspace") {
      setProviderExtrasDraft(providerExtrasDraft.slice(0, -1));
      setMessage(null);
      prevent(event);
      return;
    }

    const input = getPrintableInput(event);
    if (input !== null) {
      setProviderExtrasDraft(`${providerExtrasDraft}${input}`);
      setMessage(null);
      prevent(event);
    }
    return;
  }

  const optionCount = modelOptionLabels(modelOptionKey, selection).length;

  if (event.name === "up" || event.name === "down") {
    setModelOptionIndex(
      cycleIndex(
        modelOptionIndex,
        optionCount,
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

  const nextSelection = selectionWithModelOption(
    modelOptionKey,
    selection,
    modelOptionIndex,
  );
  setActiveSelection({
    activeModelEntry,
    selection: nextSelection,
    setPrimary,
    setSummarization,
  });
  setStage("model-settings");
  setMessage(
    `${entryLabel(activeModelEntry)} ${modelOptionTitle(modelOptionKey)} updated. Choose Done to save.`,
  );
  prevent(event);
}

function handleModelChoiceKey({
  activeModelEntry,
  configuredProviders,
  endpoints,
  event,
  modelCommitPending,
  modelFilter,
  modelIndex,
  modelLoad,
  primary,
  setMessage,
  setModelCommitPending,
  setModelFilter,
  setModelIndex,
  setPrimary,
  setStage,
  setSummarization,
  summarization,
}: {
  activeModelEntry: ModelEntry;
  configuredProviders: readonly string[];
  endpoints: readonly ClutchEndpoint[];
  event: KeyEvent;
  modelCommitPending: boolean;
  modelFilter: string;
  modelIndex: number;
  modelLoad: ModelLoadState;
  primary: ClutchModelSelection;
  setMessage: (message: string | null) => void;
  setModelCommitPending: (pending: boolean) => void;
  setModelFilter: (filter: string) => void;
  setModelIndex: (index: number) => void;
  setPrimary: (selection: ClutchModelSelection) => void;
  setStage: (stage: ConfigStage) => void;
  setSummarization: (selection: ClutchModelSelection) => void;
  summarization: ClutchModelSelection;
}) {
  const selection = getModelEntrySelection({
    entry: activeModelEntry,
    primary,
    summarization,
  });
  const matches = matchingModels({
    filter: modelFilter,
    models: modelLoad.models,
  });

  if (event.name === "escape") {
    const providers = modelProvidersForEntry({ configuredProviders, endpoints });
    setStage(providers.length <= 1 ? "model-settings" : "model-provider");
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
    if (modelCommitPending) {
      prevent(event);
      return;
    }

    const modelId = resolveCommittedModelId({
      filter: modelFilter,
      matches,
      modelIndex,
    });
    if (modelId === undefined) {
      setMessage("Choose a model before continuing.");
      prevent(event);
      return;
    }

    if (selection.provider === OPENROUTER_PROVIDER_ID) {
      const apiKey = loadClutchAuth()[OPENROUTER_PROVIDER_ID]?.key;
      if (apiKey === undefined || apiKey.trim().length === 0) {
        setMessage("Configure OpenRouter API key before choosing a model.");
        prevent(event);
        return;
      }

      setModelCommitPending(true);
      setMessage("Loading model capabilities…");
      prevent(event);
      void commitOpenRouterModelSelection({
        apiKey,
        modelId,
        selection,
      })
        .then((nextSelection) => {
          setActiveSelection({
            activeModelEntry,
            selection: nextSelection,
            setPrimary,
            setSummarization,
          });
          setModelFilter("");
          setStage("model-settings");
          setMessage(
            `${entryLabel(activeModelEntry)} model updated. Choose Done to save.`,
          );
        })
        .catch((error) => {
          setMessage(error instanceof Error ? error.message : String(error));
        })
        .finally(() => {
          setModelCommitPending(false);
        });
      return;
    }

    if (modelLoad.status !== "loaded" && modelFilter.trim().length === 0) {
      setMessage("Models are not loaded yet.");
      prevent(event);
      return;
    }

    setActiveSelection({
      activeModelEntry,
      selection: { ...selection, model: modelId },
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

function handleEndpointFormKey({
  endpointForm,
  endpointFormMode,
  endpointFormRowIndex,
  event,
  setConfiguredProviders,
  setEndpointForm,
  setEndpointFormRowIndex,
  setEndpoints,
  setMessage,
  setStage,
}: {
  endpointForm: EndpointForm | null;
  endpointFormMode: EndpointFormMode;
  event: KeyEvent;
  endpointFormRowIndex: number;
  setConfiguredProviders: (
    providers: string[] | ((current: string[]) => string[]),
  ) => void;
  setEndpointForm: (form: EndpointForm | null) => void;
  setEndpointFormRowIndex: (index: number) => void;
  setEndpoints: (endpoints: ClutchEndpoint[]) => void;
  setMessage: (message: string | null) => void;
  setStage: (stage: ConfigStage) => void;
}) {
  const rows = endpointFormRows(endpointFormMode);
  const form = endpointForm ?? emptyEndpointForm();

  if (event.name === "escape") {
    setStage("providers");
    setMessage(null);
    prevent(event);
    return;
  }

  if (event.name === "up" || event.name === "down") {
    setEndpointFormRowIndex(
      cycleIndex(
        endpointFormRowIndex,
        rows.length,
        event.name === "down" ? 1 : -1,
      ),
    );
    setMessage(null);
    prevent(event);
    return;
  }

  const row = rows[endpointFormRowIndex];
  if (row === undefined) {
    throw new Error(`Invalid endpoint form row index: ${endpointFormRowIndex}`);
  }

  if (row === "delete" && event.name === "return") {
    try {
      deleteClutchEndpointConfiguration({ endpointId: form.id });
      setEndpoints(loadClutchSettings().endpoints ?? []);
      setEndpointForm(null);
      setStage("providers");
      setMessage(`Deleted endpoint ${form.label}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
    prevent(event);
    return;
  }

  if (event.name === "return" || (event.ctrl && event.name === "s")) {
    if (row === "save" || event.ctrl) {
      try {
        const endpoint = endpointFromForm(form, endpointFormMode);
        saveClutchEndpointConfiguration({
          apiKey: form.apiKey.trim().length === 0 ? undefined : form.apiKey,
          endpoint,
        });
        setEndpoints(loadClutchSettings().endpoints ?? []);
        if (form.apiKey.trim().length > 0) {
          setConfiguredProviders((current) =>
            Array.from(new Set([...current, endpoint.id])),
          );
        }
        setEndpointForm(null);
        setStage("providers");
        setMessage(`Saved endpoint ${endpoint.label}.`);
      } catch (error) {
        setMessage(error instanceof Error ? error.message : String(error));
      }
    }
    prevent(event);
    return;
  }

  if (row === "save" || row === "delete") {
    return;
  }

  if (endpointFormMode === "edit" && row === "id") {
    return;
  }

  if (event.ctrl && event.name === "u") {
    setEndpointForm(updateEndpointFormField(form, row, () => ""));
    setMessage(null);
    prevent(event);
    return;
  }

  if (event.name === "backspace") {
    setEndpointForm(
      updateEndpointFormField(form, row, (value) => value.slice(0, -1)),
    );
    setMessage(null);
    prevent(event);
    return;
  }

  const input = getPrintableInput(event);
  if (input !== null) {
    setEndpointForm(
      updateEndpointFormField(form, row, (value) => value + input),
    );
    setMessage(null);
    prevent(event);
  }
}

function providerRows({
  agentBackendConfigured,
  configuredProviders,
  endpoints,
}: {
  agentBackendConfigured: boolean;
  configuredProviders: readonly string[];
  endpoints: readonly ClutchEndpoint[];
}) {
  return [
    {
      key: OPENROUTER_PROVIDER_ID,
      kind: "provider" as const,
      label: `OpenRouter${configuredProviders.includes(OPENROUTER_PROVIDER_ID) ? " ✓" : ""}`,
      provider: OPENROUTER_PROVIDER_ID,
    },
    ...endpoints.map((endpoint) => ({
      key: endpoint.id,
      kind: "endpoint" as const,
      endpointId: endpoint.id,
      label: `${endpoint.label}${configuredProviders.includes(endpoint.id) ? " ✓" : ""}`,
    })),
    {
      key: "add-endpoint",
      kind: "add-endpoint" as const,
      label: "Add endpoint",
    },
    {
      key: "models",
      kind: "models" as const,
      label: "Configure models",
    },
    {
      key: "agent-backend",
      kind: "agent-backend" as const,
      label: `Configure ACP backend${agentBackendConfigured ? " ✓" : ""}`,
    },
  ];
}

function agentBackendFormFromConfig(
  backend: ClutchAgentBackendConfig | undefined,
): AgentBackendForm {
  return {
    argsJson: JSON.stringify(backend?.args ?? []),
    command: backend?.command ?? "",
    envJson: JSON.stringify(backend?.env ?? {}),
  };
}

function agentBackendFromForm(
  form: AgentBackendForm,
): ClutchAgentBackendConfig {
  const args = parseJsonStringArray(
    form.argsJson,
    'ACP backend args must be a JSON string array, for example ["acp"].',
  );
  const env = parseJsonStringRecord(
    form.envJson,
    'ACP backend env must be a JSON object of strings, for example {"KEY":"VALUE"}.',
  );

  return {
    ...(args.length === 0 ? {} : { args }),
    command: form.command.trim(),
    ...(Object.keys(env).length === 0 ? {} : { env }),
  };
}

function agentBackendRowLabel({
  form,
  row,
}: {
  form: AgentBackendForm;
  row: AgentBackendRow;
}): string {
  switch (row) {
    case "command":
      return `Command: ${form.command}`;
    case "args":
      return `Args JSON: ${form.argsJson}`;
    case "env":
      return `Env JSON: ${form.envJson}`;
    case "save":
      return "Save ACP backend";
  }
}

function updateAgentBackendField(
  form: AgentBackendForm,
  field: AgentBackendField,
  update: (value: string) => string,
): AgentBackendForm {
  switch (field) {
    case "command":
      return { ...form, command: update(form.command) };
    case "args":
      return { ...form, argsJson: update(form.argsJson) };
    case "env":
      return { ...form, envJson: update(form.envJson) };
  }
}

function modelProvidersForEntry({
  configuredProviders,
  endpoints,
}: {
  configuredProviders: readonly string[];
  endpoints: readonly ClutchEndpoint[];
}) {
  return configuredProviders.map((id) => ({
    id,
    label: getClutchProviderLabel(id, { endpoints: [...endpoints] }),
  }));
}

function modelChoiceStatusLabel({
  endpoints,
  filter,
  modelLoad,
  provider,
}: {
  endpoints: readonly ClutchEndpoint[];
  filter: string;
  modelLoad: ModelLoadState;
  provider: string;
}): string {
  const base = `Provider: ${getClutchProviderLabel(provider, { endpoints: [...endpoints] })}`;
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

function resolveCommittedModelId({
  filter,
  matches,
  modelIndex,
}: {
  filter: string;
  matches: readonly ClutchProviderModel[];
  modelIndex: number;
}): string | undefined {
  if (matches.length > 0) {
    const index = Math.min(Math.max(modelIndex, 0), matches.length - 1);
    return matches[index]?.id;
  }

  const typed = filter.trim();
  return typed.length > 0 ? typed : undefined;
}

function endpointFormRows(mode: EndpointFormMode): EndpointFormRow[] {
  const fields: EndpointFormField[] = [
    "id",
    "label",
    "baseUrl",
    "apiKey",
    "headersJson",
    "requestDefaultsJson",
  ];
  return mode === "add"
    ? [...fields, "save"]
    : [...fields, "save", "delete"];
}

function emptyEndpointForm(): EndpointForm {
  return {
    apiKey: "",
    baseUrl: "",
    headersJson: "{}",
    id: "",
    label: "",
    requestDefaultsJson: "{}",
  };
}

function endpointFormFromEndpoint(endpoint: ClutchEndpoint): EndpointForm {
  const apiKey = loadClutchAuth()[endpoint.id]?.key ?? "";
  return {
    apiKey,
    baseUrl: endpoint.baseUrl,
    headersJson: JSON.stringify(endpoint.headers ?? {}),
    id: endpoint.id,
    label: endpoint.label,
    requestDefaultsJson: JSON.stringify(endpoint.requestDefaults ?? {}),
  };
}

function endpointFromForm(
  form: EndpointForm,
  mode: EndpointFormMode,
): ClutchEndpoint {
  const headers = parseJsonStringRecord(
    form.headersJson,
    "Endpoint headers must be a JSON object of strings.",
  );
  const requestDefaults = parseJsonObject(
    form.requestDefaultsJson,
    "Endpoint requestDefaults must be a JSON object.",
  );

  return {
    baseUrl: form.baseUrl.trim(),
    id: mode === "add" ? form.id.trim() : form.id,
    label: form.label.trim(),
    ...(Object.keys(headers).length === 0 ? {} : { headers }),
    ...(Object.keys(requestDefaults).length === 0
      ? {}
      : { requestDefaults }),
  };
}

function endpointFormRowLabel({
  form,
  mode,
  row,
}: {
  form: EndpointForm;
  mode: EndpointFormMode;
  row: EndpointFormRow;
}): string {
  switch (row) {
    case "id":
      return `Id: ${form.id}`;
    case "label":
      return `Label: ${form.label}`;
    case "baseUrl":
      return `Base URL: ${form.baseUrl}`;
    case "apiKey":
      return `API key: ${form.apiKey.length === 0 ? "" : "*".repeat(form.apiKey.length)}`;
    case "headersJson":
      return `Headers JSON: ${form.headersJson}`;
    case "requestDefaultsJson":
      return `Request defaults JSON: ${form.requestDefaultsJson}`;
    case "save":
      return "Save endpoint";
    case "delete":
      return "Delete endpoint";
  }
}

function updateEndpointFormField(
  form: EndpointForm,
  field: EndpointFormField,
  update: (value: string) => string,
): EndpointForm {
  switch (field) {
    case "id":
      return { ...form, id: update(form.id) };
    case "label":
      return { ...form, label: update(form.label) };
    case "baseUrl":
      return { ...form, baseUrl: update(form.baseUrl) };
    case "apiKey":
      return { ...form, apiKey: update(form.apiKey) };
    case "headersJson":
      return { ...form, headersJson: update(form.headersJson) };
    case "requestDefaultsJson":
      return { ...form, requestDefaultsJson: update(form.requestDefaultsJson) };
  }
}

function isEndpointFormField(row: EndpointFormRow): row is EndpointFormField {
  return row !== "save" && row !== "delete";
}

function matchingModels({
  filter,
  models,
}: {
  filter: string;
  models: readonly ClutchProviderModel[];
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
  models: readonly ClutchProviderModel[],
): number {
  return Math.max(
    0,
    models.findIndex((model) => model.id === selection.model),
  );
}

function providerIndexFor(
  provider: string,
  {
    configuredProviders,
    endpoints,
  }: {
    configuredProviders: readonly string[];
    endpoints: readonly ClutchEndpoint[];
  },
): number {
  const index = modelProvidersForEntry({
    configuredProviders,
    endpoints,
  }).findIndex((candidate) => candidate.id === provider);
  return index === -1 ? 0 : index;
}

function modelSettingsKindToOptionKey(
  kind: Exclude<ModelSettingsRow["kind"], "done" | "model">,
): ModelOptionKey {
  switch (kind) {
    case "effort":
      return "effort";
    case "service-tier":
      return "serviceTier";
    case "vendor":
      return "vendor";
    case "sort":
      return "sort";
    case "provider-extras":
      return "providerExtras";
  }
}

function modelOptionIndexFor(
  optionKey: ModelOptionKey,
  selection: ClutchModelSelection,
): number {
  switch (optionKey) {
    case "effort":
      return effortIndexFor(getClutchModelEffortLevel(selection));
    case "serviceTier":
      return openRouterServiceTierIndex(
        selection,
        selection.openRouter?.capabilities,
      );
    case "vendor":
      return openRouterVendorIndex(
        selection,
        selection.openRouter?.capabilities,
      );
    case "sort":
      return openRouterSortIndex(selection);
    case "providerExtras":
      return 0;
  }
}

function modelOptionLabels(
  optionKey: ModelOptionKey,
  selection: ClutchModelSelection,
): string[] {
  switch (optionKey) {
    case "effort":
      return [...CLUTCH_MODEL_EFFORT_LEVELS];
    case "serviceTier":
      return openRouterServiceTierOptions(selection.openRouter?.capabilities);
    case "vendor":
      return openRouterVendorOptions(selection.openRouter?.capabilities);
    case "sort":
      return OPENROUTER_SORT_OPTIONS.map((option) => option.label);
    case "providerExtras":
      return [];
  }
}

function modelOptionPrompt(
  optionKey: ModelOptionKey,
  activeModelEntry: ModelEntry,
): string {
  return `Choose ${modelOptionTitle(optionKey)} for ${entryLabel(activeModelEntry)}.`;
}

function modelOptionTitle(optionKey: ModelOptionKey): string {
  switch (optionKey) {
    case "effort":
      return "effort";
    case "serviceTier":
      return "service tier";
    case "vendor":
      return "vendor";
    case "sort":
      return "sort";
    case "providerExtras":
      return "provider extras";
  }
}

function selectionWithModelOption(
  optionKey: ModelOptionKey,
  selection: ClutchModelSelection,
  optionIndex: number,
): ClutchModelSelection {
  switch (optionKey) {
    case "effort": {
      const effortLevel = CLUTCH_MODEL_EFFORT_LEVELS[optionIndex];
      if (effortLevel === undefined) {
        throw new Error(`Invalid model effort row index: ${optionIndex}`);
      }
      return { ...selection, effortLevel };
    }
    case "serviceTier": {
      const options = openRouterServiceTierOptions(
        selection.openRouter?.capabilities,
      );
      const serviceTier = options[optionIndex];
      if (serviceTier === undefined) {
        throw new Error(`Invalid model service tier row index: ${optionIndex}`);
      }
      return {
        ...selection,
        openRouter: {
          ...(selection.openRouter ?? {}),
          serviceTier,
        },
      };
    }
    case "vendor": {
      const vendors = openRouterVendorOptions(
        selection.openRouter?.capabilities,
      );
      const vendor = vendors[optionIndex];
      if (vendor === undefined) {
        throw new Error(`Invalid vendor row index: ${optionIndex}`);
      }
      return selectionWithOpenRouterVendor(selection, vendor);
    }
    case "sort": {
      const option = OPENROUTER_SORT_OPTIONS[optionIndex];
      if (option === undefined) {
        throw new Error(`Invalid sort row index: ${optionIndex}`);
      }
      return selectionWithOpenRouterSort(selection, option.sort);
    }
    case "providerExtras":
      throw new Error("providerExtras is edited as text, not by index.");
  }
}

function effortIndexFor(effortLevel: ClutchModelEffortLevel): number {
  const index = CLUTCH_MODEL_EFFORT_LEVELS.findIndex(
    (candidate) => candidate === effortLevel,
  );
  if (index === -1) {
    throw new Error(`Unknown model effort level: ${effortLevel}`);
  }
  return index;
}

function cycleIndex(index: number, length: number, direction: 1 | -1): number {
  return (index + direction + length) % length;
}

function stageTitle({
  activeModelEntry,
  modelOptionKey,
  stage,
  task,
}: {
  activeModelEntry: ModelEntry;
  modelOptionKey: ModelOptionKey;
  stage: ConfigStage;
  task: ConfigTaskState;
}): string {
  switch (stage) {
    case "agent-backend":
      return "ACP backend";
    case "endpoint-form":
      return "Endpoint";
    case "providers":
      return task.mode === "first-run" ? "Setup providers" : "Providers";
    case "token":
      return "Provider token";
    case "model-settings":
      return "Model settings";
    case "model-option":
      return `${entryLabel(activeModelEntry)} ${modelOptionTitle(modelOptionKey)}`;
    case "model-provider":
      return `${entryLabel(activeModelEntry)} provider`;
    case "model-model":
      return `${entryLabel(activeModelEntry)} model`;
  }
}

function hotkeysForStage(
  stage: ConfigStage,
  task: ConfigTaskState,
  modelOptionKey: ModelOptionKey,
): string {
  switch (stage) {
    case "agent-backend":
      return "Esc providers · ↑/↓ field · type edit · Ctrl+u clear · Ctrl+s save";
    case "endpoint-form":
      return "Esc providers · ↑/↓ field · type edit · Ctrl+u clear · Ctrl+s save";
    case "providers":
      return `${task.mode === "settings" ? "Esc return · " : ""}↑/↓ select · Enter open`;
    case "token":
      return "Esc back · paste/type token · Ctrl+u clear · Enter save";
    case "model-settings":
      return "Esc providers · ↑/↓ select · Enter edit/done";
    case "model-option":
      return modelOptionKey === "providerExtras"
        ? "Esc back · type JSON · Ctrl+u clear · Enter save"
        : "Esc back · ↑/↓ choose · Enter choose";
    case "model-provider":
      return "Esc back · ↑/↓ choose provider · Enter next";
    case "model-model":
      return "Esc back · ↑/↓ choose model · type filter · Ctrl+u clear · Enter choose";
  }
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

function sanitizeLineInput(input: string): string {
  return stripAnsiSequences(input)
    .replace(/[\n\r]/g, "")
    .trim();
}

function prevent(event: KeyEvent) {
  event.preventDefault();
  event.stopPropagation();
}

const selectedStyle = { bg: "blue", fg: "white" } as const;
