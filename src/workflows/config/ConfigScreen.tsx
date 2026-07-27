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
  CLUTCH_MODEL_SERVICE_TIERS,
  getClutchModelEffortLevel,
  getClutchOpenRouterServiceTier,
  getClutchProviderLabel,
  OPENROUTER_PROVIDER_ID,
  saveClutchAgentBackendConfiguration,
  saveClutchApiKey,
  saveClutchModelConfiguration,
  type ClutchAgentBackendConfig,
  type ClutchEndpoint,
  type ClutchModelEffortLevel,
  type ClutchModelSelection,
  type ClutchModelServiceTier,
} from "../../lib/config/clutchConfig";
import {
  fetchClutchProviderModels,
  type ClutchProviderModel,
} from "../../lib/config/providerModels";
import { useAppStore } from "../../store/appStore";

type ConfigScreenProps = {
  task: ConfigTaskState;
};

type ConfigStage =
  | "agent-backend"
  | "model-effort"
  | "model-model"
  | "model-provider"
  | "model-service-tier"
  | "model-settings"
  | "providers"
  | "token";
type ModelEntry = "agent" | "primary" | "summarization";
type ModelSettingsRow =
  | { entry: ModelEntry; kind: "effort" | "model" | "service-tier" }
  | { kind: "done" };
type AgentBackendField = "args" | "command" | "env";
type AgentBackendRow = AgentBackendField | "save";
type AgentBackendForm = {
  argsJson: string;
  command: string;
  envJson: string;
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

const MODEL_SETTINGS_ROWS: ModelSettingsRow[] = [
  { entry: "primary", kind: "model" },
  { entry: "primary", kind: "effort" },
  { entry: "primary", kind: "service-tier" },
  { entry: "agent", kind: "model" },
  { entry: "agent", kind: "effort" },
  { entry: "agent", kind: "service-tier" },
  { entry: "summarization", kind: "model" },
  { entry: "summarization", kind: "effort" },
  { entry: "summarization", kind: "service-tier" },
  { kind: "done" },
];
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
  const [modelEffortIndex, setModelEffortIndex] = useState(0);
  const [modelServiceTierIndex, setModelServiceTierIndex] = useState(0);
  const [modelIndex, setModelIndex] = useState(0);
  const [modelFilter, setModelFilter] = useState("");
  const [agentBackendForm, setAgentBackendForm] = useState(
    agentBackendFormFromConfig(task.agentBackend),
  );
  const [agentBackendRowIndex, setAgentBackendRowIndex] = useState(0);
  const [agent, setAgent] = useState(task.agent);
  const [primary, setPrimary] = useState(task.primary);
  const [summarization, setSummarization] = useState(task.summarization);
  const [message, setMessage] = useState<string | null>(null);
  const [configuredProviders, setConfiguredProviders] = useState(
    task.configuredProviders,
  );
  const [endpoints] = useState(task.endpoints);
  const [modelLoad, setModelLoad] = useState<ModelLoadState>({
    models: [],
    provider: null,
    status: "idle",
  });

  const activeSelection = getModelEntrySelection({
    agent,
    entry: activeModelEntry,
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
    if (stage !== "token" && stage !== "agent-backend") {
      return;
    }

    const pastedToken = sanitizeLineInput(decodePasteBytes(event.bytes));
    if (pastedToken.length === 0) {
      return;
    }

    if (stage === "token") {
      setToken((currentToken) => `${currentToken}${pastedToken}`);
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
        setMessage,
        setProviderIndex,
        setStage,
        setToken,
        setTokenProvider,
        task,
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
        agent,
        event,
        modelSettingsIndex,
        primary,
        setActiveModelEntry,
        setMessage,
        setModelEffortIndex,
        setModelProviderIndex,
        setModelServiceTierIndex,
        setModelSettingsIndex,
        setStage,
        summarization,
        endpoints,
      });
      return;
    }

    if (stage === "model-provider") {
      handleModelProviderKey({
        activeModelEntry,
        agent,
        event,
        modelProviderIndex,
        primary,
        setAgent,
        setMessage,
        setModelFilter,
        setModelIndex,
        setModelProviderIndex,
        setPrimary,
        setStage,
        setSummarization,
        summarization,
        endpoints,
      });
      return;
    }

    if (stage === "model-effort") {
      handleModelEffortKey({
        activeModelEntry,
        agent,
        event,
        modelEffortIndex,
        primary,
        setAgent,
        setMessage,
        setModelEffortIndex,
        setStage,
        setSummarization,
        setPrimary,
        summarization,
      });
      return;
    }

    if (stage === "model-service-tier") {
      handleModelServiceTierKey({
        activeModelEntry,
        agent,
        event,
        modelServiceTierIndex,
        primary,
        setAgent,
        setMessage,
        setModelServiceTierIndex,
        setStage,
        setSummarization,
        setPrimary,
        summarization,
      });
      return;
    }

    handleModelChoiceKey({
      activeModelEntry,
      agent,
      event,
      modelFilter,
      modelIndex,
      modelLoad,
      primary,
      setAgent,
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
            agentBackendConfigured={agentBackendForm.command.trim().length > 0}
            configuredProviders={configuredProviders}
            endpoints={endpoints}
            message={message}
            providerIndex={providerIndex}
            task={task}
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
            agent={agent}
            endpoints={endpoints}
            message={message}
            primary={primary}
            rowIndex={modelSettingsIndex}
            summarization={summarization}
          />
        ) : null}
        {stage === "model-provider" ? (
          <ModelProviderStep
            activeModelEntry={activeModelEntry}
            endpoints={endpoints}
            message={message}
            providerIndex={modelProviderIndex}
          />
        ) : null}
        {stage === "model-model" ? (
          <ModelChoiceStep
            activeModelEntry={activeModelEntry}
            agent={agent}
            endpoints={endpoints}
            filter={modelFilter}
            message={message}
            modelIndex={modelIndex}
            modelLoad={modelLoad}
            primary={primary}
            summarization={summarization}
          />
        ) : null}
        {stage === "model-effort" ? (
          <ModelEffortStep
            activeModelEntry={activeModelEntry}
            effortIndex={modelEffortIndex}
            message={message}
          />
        ) : null}
        {stage === "model-service-tier" ? (
          <ModelServiceTierStep
            activeModelEntry={activeModelEntry}
            message={message}
            serviceTierIndex={modelServiceTierIndex}
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
  agent,
  endpoints,
  message,
  primary,
  rowIndex,
  summarization,
}: {
  agent: ClutchModelSelection;
  endpoints: readonly ClutchEndpoint[];
  message: string | null;
  primary: ClutchModelSelection;
  rowIndex: number;
  summarization: ClutchModelSelection;
}) {
  return (
    <>
      <text>Model settings</text>
      {MODEL_SETTINGS_ROWS.map((row, index) => (
        <text
          key={modelSettingsRowKey(row)}
          style={index === rowIndex ? selectedStyle : undefined}
        >
          {`${index === rowIndex ? ">" : " "} ${modelSettingsRowLabel({ agent, endpoints, primary, row, summarization })}`}
        </text>
      ))}
      {message === null ? null : (
        <text style={{ fg: "yellow" }}>{message}</text>
      )}
    </>
  );
}

function ModelEffortStep({
  activeModelEntry,
  effortIndex,
  message,
}: {
  activeModelEntry: ModelEntry;
  effortIndex: number;
  message: string | null;
}) {
  return (
    <>
      <text>{`Choose effort for ${entryLabel(activeModelEntry)}.`}</text>
      {CLUTCH_MODEL_EFFORT_LEVELS.map((effortLevel, index) => (
        <text
          key={effortLevel}
          style={index === effortIndex ? selectedStyle : undefined}
        >
          {`${index === effortIndex ? ">" : " "} ${effortLevel}`}
        </text>
      ))}
      {message === null ? null : (
        <text style={{ fg: "yellow" }}>{message}</text>
      )}
    </>
  );
}

function ModelServiceTierStep({
  activeModelEntry,
  message,
  serviceTierIndex,
}: {
  activeModelEntry: ModelEntry;
  message: string | null;
  serviceTierIndex: number;
}) {
  return (
    <>
      <text>{`Choose service tier for ${entryLabel(activeModelEntry)}.`}</text>
      {CLUTCH_MODEL_SERVICE_TIERS.map((serviceTier, index) => (
        <text
          key={serviceTier}
          style={index === serviceTierIndex ? selectedStyle : undefined}
        >
          {`${index === serviceTierIndex ? ">" : " "} ${serviceTier}`}
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
  endpoints,
  message,
  providerIndex,
}: {
  activeModelEntry: ModelEntry;
  endpoints: readonly ClutchEndpoint[];
  message: string | null;
  providerIndex: number;
}) {
  return (
    <>
      <text>{`Choose provider for ${entryLabel(activeModelEntry)}.`}</text>
      {modelProvidersForEntry(endpoints).map((provider, index) => (
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
  agent,
  endpoints,
  filter,
  message,
  modelIndex,
  modelLoad,
  primary,
  summarization,
}: {
  activeModelEntry: ModelEntry;
  agent: ClutchModelSelection;
  endpoints: readonly ClutchEndpoint[];
  filter: string;
  message: string | null;
  modelIndex: number;
  modelLoad: ModelLoadState;
  primary: ClutchModelSelection;
  summarization: ClutchModelSelection;
}) {
  const selection = getModelEntrySelection({
    agent,
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
  agent,
  endpoints,
  event,
  modelSettingsIndex,
  primary,
  setActiveModelEntry,
  setMessage,
  setModelEffortIndex,
  setModelProviderIndex,
  setModelServiceTierIndex,
  setModelSettingsIndex,
  setStage,
  summarization,
}: {
  actions: AppActions;
  agent: ClutchModelSelection;
  endpoints: readonly ClutchEndpoint[];
  event: KeyEvent;
  modelSettingsIndex: number;
  primary: ClutchModelSelection;
  setActiveModelEntry: (entry: ModelEntry) => void;
  setMessage: (message: string | null) => void;
  setModelEffortIndex: (index: number) => void;
  setModelProviderIndex: (index: number) => void;
  setModelServiceTierIndex: (index: number) => void;
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

  if (row.kind === "done") {
    try {
      saveClutchModelConfiguration({ agent, primary, summarization });
      actions.config.closeAfterSave();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    }
    prevent(event);
    return;
  }

  const selection = getModelEntrySelection({
    agent,
    entry: row.entry,
    primary,
    summarization,
  });
  setActiveModelEntry(row.entry);
  if (row.kind === "effort") {
    setModelEffortIndex(effortIndexFor(getClutchModelEffortLevel(selection)));
    setStage("model-effort");
  } else if (row.kind === "service-tier") {
    setModelServiceTierIndex(
      serviceTierIndexFor(getClutchOpenRouterServiceTier(selection)),
    );
    setStage("model-service-tier");
  } else {
    setModelProviderIndex(
      providerIndexFor(selection.provider, endpoints),
    );
    setStage("model-provider");
  }
  setMessage(null);
  prevent(event);
}

function handleModelProviderKey({
  activeModelEntry,
  agent,
  endpoints,
  event,
  modelProviderIndex,
  primary,
  setAgent,
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
  agent: ClutchModelSelection;
  endpoints: readonly ClutchEndpoint[];
  event: KeyEvent;
  modelProviderIndex: number;
  primary: ClutchModelSelection;
  setAgent: (selection: ClutchModelSelection) => void;
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
    const providers = modelProvidersForEntry(endpoints);
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

  const provider =
    modelProvidersForEntry(endpoints)[modelProviderIndex]?.id;
  if (provider === undefined) {
    throw new Error(`Invalid model provider row index: ${modelProviderIndex}`);
  }

  const currentSelection = getModelEntrySelection({
    agent,
    entry: activeModelEntry,
    primary,
    summarization,
  });
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
    setAgent,
    setPrimary,
    setSummarization,
  });
  setModelIndex(0);
  setModelFilter("");
  setStage("model-model");
  setMessage(null);
  prevent(event);
}

function handleModelEffortKey({
  activeModelEntry,
  agent,
  event,
  modelEffortIndex,
  primary,
  setAgent,
  setMessage,
  setModelEffortIndex,
  setPrimary,
  setStage,
  setSummarization,
  summarization,
}: {
  activeModelEntry: ModelEntry;
  agent: ClutchModelSelection;
  event: KeyEvent;
  modelEffortIndex: number;
  primary: ClutchModelSelection;
  setAgent: (selection: ClutchModelSelection) => void;
  setMessage: (message: string | null) => void;
  setModelEffortIndex: (index: number) => void;
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
    setModelEffortIndex(
      cycleIndex(
        modelEffortIndex,
        CLUTCH_MODEL_EFFORT_LEVELS.length,
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

  const effortLevel = CLUTCH_MODEL_EFFORT_LEVELS[modelEffortIndex];
  if (effortLevel === undefined) {
    throw new Error(`Invalid model effort row index: ${modelEffortIndex}`);
  }

  const selection = getModelEntrySelection({
    agent,
    entry: activeModelEntry,
    primary,
    summarization,
  });
  setActiveSelection({
    activeModelEntry,
    selection: { ...selection, effortLevel },
    setAgent,
    setPrimary,
    setSummarization,
  });
  setStage("model-settings");
  setMessage(
    `${entryLabel(activeModelEntry)} effort updated. Choose Done to save.`,
  );
  prevent(event);
}

function handleModelServiceTierKey({
  activeModelEntry,
  agent,
  event,
  modelServiceTierIndex,
  primary,
  setAgent,
  setMessage,
  setModelServiceTierIndex,
  setPrimary,
  setStage,
  setSummarization,
  summarization,
}: {
  activeModelEntry: ModelEntry;
  agent: ClutchModelSelection;
  event: KeyEvent;
  modelServiceTierIndex: number;
  primary: ClutchModelSelection;
  setAgent: (selection: ClutchModelSelection) => void;
  setMessage: (message: string | null) => void;
  setModelServiceTierIndex: (index: number) => void;
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
    setModelServiceTierIndex(
      cycleIndex(
        modelServiceTierIndex,
        CLUTCH_MODEL_SERVICE_TIERS.length,
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

  const serviceTier = CLUTCH_MODEL_SERVICE_TIERS[modelServiceTierIndex];
  if (serviceTier === undefined) {
    throw new Error(
      `Invalid model service tier row index: ${modelServiceTierIndex}`,
    );
  }

  const selection = getModelEntrySelection({
    agent,
    entry: activeModelEntry,
    primary,
    summarization,
  });
  setActiveSelection({
    activeModelEntry,
    selection: {
      ...selection,
      openRouter: {
        ...(selection.openRouter ?? {}),
        serviceTier,
      },
    },
    setAgent,
    setPrimary,
    setSummarization,
  });
  setStage("model-settings");
  setMessage(
    `${entryLabel(activeModelEntry)} service tier updated. Choose Done to save.`,
  );
  prevent(event);
}

function handleModelChoiceKey({
  activeModelEntry,
  agent,
  event,
  modelFilter,
  modelIndex,
  modelLoad,
  primary,
  setAgent,
  setMessage,
  setModelFilter,
  setModelIndex,
  setPrimary,
  setStage,
  setSummarization,
  summarization,
}: {
  activeModelEntry: ModelEntry;
  agent: ClutchModelSelection;
  event: KeyEvent;
  modelFilter: string;
  modelIndex: number;
  modelLoad: ModelLoadState;
  primary: ClutchModelSelection;
  setAgent: (selection: ClutchModelSelection) => void;
  setMessage: (message: string | null) => void;
  setModelFilter: (filter: string) => void;
  setModelIndex: (index: number) => void;
  setPrimary: (selection: ClutchModelSelection) => void;
  setStage: (stage: ConfigStage) => void;
  setSummarization: (selection: ClutchModelSelection) => void;
  summarization: ClutchModelSelection;
}) {
  const selection = getModelEntrySelection({
    agent,
    entry: activeModelEntry,
    primary,
    summarization,
  });
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
      selection: { ...selection, model: model.id },
      setAgent,
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
  agent,
  endpoints,
  primary,
  row,
  summarization,
}: {
  agent: ClutchModelSelection;
  endpoints: readonly ClutchEndpoint[];
  primary: ClutchModelSelection;
  row: ModelSettingsRow;
  summarization: ClutchModelSelection;
}): string {
  if (row.kind === "done") {
    return "Done";
  }

  const selection = getModelEntrySelection({
    agent,
    entry: row.entry,
    primary,
    summarization,
  });
  if (row.kind === "effort") {
    return `${entryLabel(row.entry)} effort: ${getClutchModelEffortLevel(selection)}`;
  }
  if (row.kind === "service-tier") {
    return `${entryLabel(row.entry)} service tier: ${getClutchOpenRouterServiceTier(selection)}`;
  }

  return `${entryLabel(row.entry)} model: ${getClutchProviderLabel(selection.provider, { endpoints: [...endpoints] })} / ${selection.model.length === 0 ? "(choose model)" : selection.model}`;
}

function modelSettingsRowKey(row: ModelSettingsRow): string {
  return row.kind === "done" ? "done" : `${row.entry}-${row.kind}`;
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
      kind: "provider" as const,
      label: `${endpoint.label}${configuredProviders.includes(endpoint.id) ? " ✓" : ""}`,
      provider: endpoint.id,
    })),
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

function parseJsonStringArray(value: string, message: string): string[] {
  const parsed = parseJsonValue(value.length === 0 ? "[]" : value, message);
  if (
    !Array.isArray(parsed) ||
    !parsed.every((item) => typeof item === "string")
  ) {
    throw new Error(message);
  }
  return parsed;
}

function parseJsonStringRecord(
  value: string,
  message: string,
): Record<string, string> {
  const parsed = parseJsonValue(value.length === 0 ? "{}" : value, message);
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    Array.isArray(parsed) ||
    !Object.values(parsed).every((item) => typeof item === "string")
  ) {
    throw new Error(message);
  }
  return parsed as Record<string, string>;
}

function parseJsonValue(value: string, message: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(message);
  }
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

function modelProvidersForEntry(endpoints: readonly ClutchEndpoint[]) {
  return [
    { id: OPENROUTER_PROVIDER_ID, label: "OpenRouter" },
    ...endpoints.map((endpoint) => ({
      id: endpoint.id,
      label: endpoint.label,
    })),
  ];
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
  setAgent,
  setPrimary,
  setSummarization,
}: {
  activeModelEntry: ModelEntry;
  selection: ClutchModelSelection;
  setAgent: (selection: ClutchModelSelection) => void;
  setPrimary: (selection: ClutchModelSelection) => void;
  setSummarization: (selection: ClutchModelSelection) => void;
}) {
  if (activeModelEntry === "agent") {
    setAgent(selection);
    return;
  }

  if (activeModelEntry === "primary") {
    setPrimary(selection);
    return;
  }

  setSummarization(selection);
}

function getModelEntrySelection({
  agent,
  entry,
  primary,
  summarization,
}: {
  agent: ClutchModelSelection;
  entry: ModelEntry;
  primary: ClutchModelSelection;
  summarization: ClutchModelSelection;
}): ClutchModelSelection {
  switch (entry) {
    case "agent":
      return agent;
    case "primary":
      return primary;
    case "summarization":
      return summarization;
  }
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
  endpoints: readonly ClutchEndpoint[],
): number {
  const index = modelProvidersForEntry(endpoints).findIndex(
    (candidate) => candidate.id === provider,
  );
  if (index === -1) {
    throw new Error(`Provider ${provider} is not configured.`);
  }
  return index;
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

function serviceTierIndexFor(serviceTier: ClutchModelServiceTier): number {
  const index = CLUTCH_MODEL_SERVICE_TIERS.findIndex(
    (candidate) => candidate === serviceTier,
  );
  if (index === -1) {
    throw new Error(`Unknown model service tier: ${serviceTier}`);
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
    case "agent-backend":
      return "ACP backend";
    case "providers":
      return task.mode === "first-run" ? "Setup providers" : "Providers";
    case "token":
      return "Provider token";
    case "model-settings":
      return "Model settings";
    case "model-effort":
      return `${entryLabel(activeModelEntry)} effort`;
    case "model-service-tier":
      return `${entryLabel(activeModelEntry)} service tier`;
    case "model-provider":
      return `${entryLabel(activeModelEntry)} provider`;
    case "model-model":
      return `${entryLabel(activeModelEntry)} model`;
  }
}

function hotkeysForStage(stage: ConfigStage, task: ConfigTaskState): string {
  switch (stage) {
    case "agent-backend":
      return "Esc providers · ↑/↓ field · type edit · Ctrl+u clear · Ctrl+s save";
    case "providers":
      return `${task.mode === "settings" ? "Esc return · " : ""}↑/↓ select · Enter open`;
    case "token":
      return "Esc back · paste/type token · Ctrl+u clear · Enter save";
    case "model-settings":
      return "Esc providers · ↑/↓ select · Enter edit/done";
    case "model-effort":
      return "Esc back · ↑/↓ choose effort · Enter choose";
    case "model-service-tier":
      return "Esc back · ↑/↓ choose tier · Enter choose";
    case "model-provider":
      return "Esc back · ↑/↓ choose provider · Enter next";
    case "model-model":
      return "Esc back · ↑/↓ choose model · type filter · Ctrl+u clear · Enter choose";
  }
}

function entryLabel(entry: ModelEntry): string {
  switch (entry) {
    case "agent":
      return "Agent";
    case "primary":
      return "Primary";
    case "summarization":
      return "Summarization";
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
