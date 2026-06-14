import {
  decodePasteBytes,
  stripAnsiSequences,
  type KeyEvent,
} from "@opentui/core";
import { useKeyboard, usePaste } from "@opentui/react";
import type { Api, Model } from "@earendil-works/pi-ai";
import { useEffect, useRef, useState } from "react";
import type { ConfigTaskState } from "../../app/appTypes";
import {
  CLUTCH_MODEL_EFFORT_LEVELS,
  CLUTCH_MODEL_SERVICE_TIERS,
  getSupportedClutchProviderLabel,
  getClutchModelEffortLevel,
  getClutchModelServiceTier,
  saveClutchApiKey,
  saveClutchModelConfiguration,
  SUPPORTED_CLUTCH_LLM_PROVIDERS,
  type ClutchModelEffortLevel,
  type ClutchModelSelection,
  type ClutchModelServiceTier,
  type SupportedClutchLlmProvider,
} from "../../lib/config/clutchConfig";
import {
  loginClutchOpenAiSubscription,
  type OpenAiSubscriptionDeviceCode,
} from "../../lib/config/openAiSubscriptionAuth";
import { fetchClutchProviderModels } from "../../lib/config/providerModels";
import { useAppStore } from "../../store/appStore";

type ConfigScreenProps = {
  task: ConfigTaskState;
};

type ConfigStage =
  | "model-effort"
  | "model-model"
  | "model-provider"
  | "model-service-tier"
  | "model-settings"
  | "providers"
  | "subscription-login"
  | "token";
type ModelEntry = "agent" | "primary" | "summarization";
type ModelSettingsRow =
  | { entry: ModelEntry; kind: "effort" | "model" | "service-tier" }
  | { kind: "done" };
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
type SubscriptionLoginState =
  | { status: "idle" }
  | { status: "waiting-for-device"; info: OpenAiSubscriptionDeviceCode }
  | { status: "working"; message: string }
  | { status: "error"; message: string };

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
const VISIBLE_MODEL_COUNT = 10;

export function ConfigScreen({ task }: ConfigScreenProps) {
  const actions = useAppStore((state) => state.actions);
  const [stage, setStage] = useState<ConfigStage>("providers");
  const [providerIndex, setProviderIndex] = useState(0);
  const [tokenProvider, setTokenProvider] =
    useState<SupportedClutchLlmProvider>(SUPPORTED_CLUTCH_LLM_PROVIDERS[0].id);
  const [subscriptionLogin, setSubscriptionLogin] =
    useState<SubscriptionLoginState>({
      status: "idle",
    });
  const loginAbortController = useRef<AbortController | null>(null);
  const [token, setToken] = useState("");
  const [modelSettingsIndex, setModelSettingsIndex] = useState(0);
  const [activeModelEntry, setActiveModelEntry] =
    useState<ModelEntry>("primary");
  const [modelProviderIndex, setModelProviderIndex] = useState(0);
  const [modelEffortIndex, setModelEffortIndex] = useState(0);
  const [modelServiceTierIndex, setModelServiceTierIndex] = useState(0);
  const [modelIndex, setModelIndex] = useState(0);
  const [modelFilter, setModelFilter] = useState("");
  const [agent, setAgent] = useState(task.agent);
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

  useEffect(() => {
    return () => loginAbortController.current?.abort();
  }, []);

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
        setSubscriptionLogin,
        setStage,
        setToken,
        setTokenProvider,
        task,
      });
      return;
    }

    if (stage === "subscription-login") {
      handleSubscriptionLoginKey({
        configuredProviders,
        event,
        loginAbortController,
        setConfiguredProviders,
        setMessage,
        setStage,
        setSubscriptionLogin,
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
            configuredProviders={configuredProviders}
            message={message}
            providerIndex={providerIndex}
            task={task}
          />
        ) : null}
        {stage === "token" ? (
          <TokenStep message={message} token={token} provider={tokenProvider} />
        ) : null}
        {stage === "subscription-login" ? (
          <SubscriptionLoginStep login={subscriptionLogin} />
        ) : null}
        {stage === "model-settings" ? (
          <ModelSettingsStep
            agent={agent}
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
            agent={agent}
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

function SubscriptionLoginStep({ login }: { login: SubscriptionLoginState }) {
  return (
    <>
      <text>{`Provider: ${getSupportedClutchProviderLabel("openai-codex")}`}</text>
      <text>Use your ChatGPT Plus or Pro subscription.</text>
      {login.status === "idle" ? (
        <text style={{ fg: "gray" }}>
          Press Enter to start device-code login.
        </text>
      ) : null}
      {login.status === "working" ? <text>{login.message}</text> : null}
      {login.status === "waiting-for-device" ? (
        <>
          <text>{`Open: ${login.info.verificationUri}`}</text>
          <text>{`Code: ${login.info.userCode}`}</text>
          <text style={{ fg: "gray" }}>Waiting for browser approval…</text>
        </>
      ) : null}
      {login.status === "error" ? (
        <text style={{ fg: "red" }}>{login.message}</text>
      ) : null}
    </>
  );
}

function ModelSettingsStep({
  agent,
  message,
  primary,
  rowIndex,
  summarization,
}: {
  agent: ClutchModelSelection;
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
          {`${index === rowIndex ? ">" : " "} ${modelSettingsRowLabel({ agent, primary, row, summarization })}`}
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
      {modelProvidersForEntry(activeModelEntry).map((provider, index) => (
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
  filter,
  message,
  modelIndex,
  modelLoad,
  primary,
  summarization,
}: {
  activeModelEntry: ModelEntry;
  agent: ClutchModelSelection;
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
  setSubscriptionLogin,
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
  setSubscriptionLogin: (login: SubscriptionLoginState) => void;
  setStage: (stage: ConfigStage) => void;
  setToken: (token: string) => void;
  setTokenProvider: (provider: SupportedClutchLlmProvider) => void;
  task: ConfigTaskState;
}) {
  if (event.name === "escape" && task.mode === "settings") {
    actions.navigation.dismissPane();
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

  if (row.kind === "subscription-provider") {
    setSubscriptionLogin({ status: "idle" });
    setStage("subscription-login");
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

function handleSubscriptionLoginKey({
  configuredProviders,
  event,
  loginAbortController,
  setConfiguredProviders,
  setMessage,
  setStage,
  setSubscriptionLogin,
}: {
  configuredProviders: readonly SupportedClutchLlmProvider[];
  event: KeyEvent;
  loginAbortController: { current: AbortController | null };
  setConfiguredProviders: (providers: SupportedClutchLlmProvider[]) => void;
  setMessage: (message: string | null) => void;
  setStage: (stage: ConfigStage) => void;
  setSubscriptionLogin: (login: SubscriptionLoginState) => void;
}) {
  if (event.name === "escape") {
    loginAbortController.current?.abort();
    loginAbortController.current = null;
    setSubscriptionLogin({ status: "idle" });
    setStage("providers");
    setMessage(null);
    prevent(event);
    return;
  }

  if (event.name !== "return") {
    return;
  }

  if (loginAbortController.current !== null) {
    setMessage("OpenAI subscription login is already running.");
    prevent(event);
    return;
  }

  const controller = new AbortController();
  loginAbortController.current = controller;
  setMessage(null);
  setSubscriptionLogin({
    message: "Starting OpenAI subscription login...",
    status: "working",
  });
  void loginClutchOpenAiSubscription({
    onDeviceCode: (info) =>
      setSubscriptionLogin({ info, status: "waiting-for-device" }),
    signal: controller.signal,
  })
    .then(() => {
      if (
        controller.signal.aborted ||
        loginAbortController.current !== controller
      ) {
        return;
      }
      loginAbortController.current = null;
      setConfiguredProviders(
        Array.from(new Set([...configuredProviders, "openai-codex"])),
      );
      setSubscriptionLogin({ status: "idle" });
      setStage("providers");
      setMessage("Saved OpenAI subscription login.");
    })
    .catch((error) => {
      if (controller.signal.aborted) {
        if (loginAbortController.current === controller) {
          loginAbortController.current = null;
          setSubscriptionLogin({ status: "idle" });
        }
        return;
      }
      if (loginAbortController.current !== controller) {
        return;
      }
      loginAbortController.current = null;
      setSubscriptionLogin({
        message: error instanceof Error ? error.message : String(error),
        status: "error",
      });
    });
  prevent(event);
}

function handleModelSettingsKey({
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
}: {
  actions: AppActions;
  agent: ClutchModelSelection;
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
      serviceTierIndexFor(getClutchModelServiceTier(selection)),
    );
    setStage("model-service-tier");
  } else {
    setModelProviderIndex(providerIndexFor(selection.provider, row.entry));
    setStage("model-provider");
  }
  setMessage(null);
  prevent(event);
}

function handleModelProviderKey({
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
}: {
  activeModelEntry: ModelEntry;
  agent: ClutchModelSelection;
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
    const providers = modelProvidersForEntry(activeModelEntry);
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
    modelProvidersForEntry(activeModelEntry)[modelProviderIndex]?.id;
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
          serviceTier: getClutchModelServiceTier(currentSelection),
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
    selection: { ...selection, serviceTier },
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
      selection: { ...selection, metadata: model, model: model.id },
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
  primary,
  row,
  summarization,
}: {
  agent: ClutchModelSelection;
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
    return `${entryLabel(row.entry)} service tier: ${getClutchModelServiceTier(selection)}`;
  }

  return `${entryLabel(row.entry)} model: ${getSupportedClutchProviderLabel(selection.provider)} / ${selection.model.length === 0 ? "(choose model)" : selection.model}`;
}

function modelSettingsRowKey(row: ModelSettingsRow): string {
  return row.kind === "done" ? "done" : `${row.entry}-${row.kind}`;
}

function providerRows(
  configuredProviders: readonly SupportedClutchLlmProvider[],
) {
  return [
    ...SUPPORTED_CLUTCH_LLM_PROVIDERS.map((provider) => {
      const configured = configuredProviders.includes(provider.id);
      return {
        key: provider.id,
        kind: isSubscriptionProvider(provider.id)
          ? ("subscription-provider" as const)
          : ("provider" as const),
        label: `${provider.label}${configured ? " ✓" : ""}`,
        provider: provider.id,
      };
    }),
    {
      key: "models",
      kind: "models" as const,
      label: "Configure models",
    },
  ];
}

function isSubscriptionProvider(provider: SupportedClutchLlmProvider): boolean {
  return provider === "openai-codex";
}

function modelProvidersForEntry(entry: ModelEntry) {
  return SUPPORTED_CLUTCH_LLM_PROVIDERS.filter((provider) =>
    isProviderSupportedForModelEntry({ entry, provider: provider.id }),
  );
}

function isProviderSupportedForModelEntry({
  entry,
  provider,
}: {
  entry: ModelEntry;
  provider: SupportedClutchLlmProvider;
}): boolean {
  return provider !== "cursor" || entry === "primary";
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

function providerIndexFor(
  provider: SupportedClutchLlmProvider,
  entry: ModelEntry,
): number {
  const index = modelProvidersForEntry(entry).findIndex(
    (candidate) => candidate.id === provider,
  );
  if (index === -1) {
    throw new Error(
      `Provider ${provider} is not supported for ${entryLabel(entry)} models.`,
    );
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
    case "providers":
      return task.mode === "first-run" ? "Setup providers" : "Providers";
    case "token":
      return "Provider token";
    case "subscription-login":
      return "OpenAI subscription";
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
    case "providers":
      return `${task.mode === "settings" ? "Esc return · " : ""}↑/↓ select · Enter open`;
    case "token":
      return "Esc back · paste/type token · Ctrl+u clear · Enter save";
    case "subscription-login":
      return "Esc back · Enter start";
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
