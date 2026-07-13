import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { homedir } from "os";
import { join } from "path";
import type { Api, Model } from "@earendil-works/pi-ai";
import {
  getOAuthApiKey,
  type OAuthCredentials,
} from "@earendil-works/pi-ai/oauth";
import { normalizeClutchModelMetadata } from "./modelMetadata";
import {
  CLUTCH_MODEL_EFFORT_LEVELS,
  CLUTCH_MODEL_SERVICE_TIERS,
  DEFAULT_CLUTCH_MODEL_EFFORT_LEVEL,
  DEFAULT_CLUTCH_MODEL_SERVICE_TIER,
  SUPPORTED_CLUTCH_LLM_PROVIDERS,
  decodeClutchAuth,
  decodeClutchSettings,
  isSupportedClutchProvider,
  normalizeAgentBackendConfig,
  type ClutchAgentBackendConfig,
  type ClutchApiKeyCredential,
  type ClutchAuth,
  type ClutchCredential,
  type ClutchModelEffortLevel,
  type ClutchModelRole,
  type ClutchModelSelection,
  type ClutchModelServiceTier,
  type ClutchOAuthCredential,
  type ClutchSettings,
  type SupportedClutchLlmProvider,
} from "./clutchConfigSchemas";

export const CLUTCH_CONFIG_DIR_ENV = "CLUTCH_CONFIG_DIR";

export type ClutchConfigPaths = {
  authPath: string;
  configDir: string;
  settingsPath: string;
};

export type ResolvedConfiguredLlmModel = {
  credential: ClutchCredential;
  effortLevel: ClutchModelEffortLevel;
  model: Model<Api>;
  serviceTier: ClutchModelServiceTier;
};

export type ResolvedConfiguredLlmRequest = {
  apiKey: string;
  effortLevel: ClutchModelEffortLevel;
  headers?: Record<string, string>;
  model: Model<Api>;
  serviceTier: ClutchModelServiceTier;
};

const DEFAULT_AGENT_BACKEND: ClutchAgentBackendConfig = {
  args: ["acp"],
  command: "cursor-agent",
};

const DEFAULT_PROVIDER: SupportedClutchLlmProvider = "openai";

export function getClutchConfigPaths(
  configDir = process.env[CLUTCH_CONFIG_DIR_ENV] ?? join(homedir(), ".clutch"),
): ClutchConfigPaths {
  return {
    authPath: join(configDir, "auth.json"),
    configDir,
    settingsPath: join(configDir, "settings.json"),
  };
}

export function getSupportedClutchProviderLabel(
  provider: SupportedClutchLlmProvider,
): string {
  return getSupportedProviderMetadata(provider).label;
}

export function loadClutchSettings(
  paths = getClutchConfigPaths(),
): ClutchSettings {
  if (!existsSync(paths.settingsPath)) {
    return {};
  }

  return decodeClutchSettings(
    readJsonObject(paths.settingsPath, "Clutch settings"),
  );
}

export function loadClutchAuth(paths = getClutchConfigPaths()): ClutchAuth {
  if (!existsSync(paths.authPath)) {
    return {};
  }

  return decodeClutchAuth(readJsonObject(paths.authPath, "Clutch auth"));
}

export function isClutchConfigured(paths = getClutchConfigPaths()): boolean {
  const settings = loadClutchSettings(paths);
  const auth = loadClutchAuth(paths);

  return (
    hasUsableModelSelection(settings.models?.primary) &&
    hasUsableModelSelection(settings.models?.summarization) &&
    hasUsableModelMetadata(settings.models.primary) &&
    hasUsableModelMetadata(settings.models.summarization) &&
    isConfiguredAgentModel(settings, auth) &&
    hasUsableCredential(auth[settings.models.primary.provider]) &&
    hasUsableCredential(auth[settings.models.summarization.provider])
  );
}

function isConfiguredAgentModel(
  settings: ClutchSettings,
  auth: ClutchAuth,
): boolean {
  const agent = getModelSelectionForRole(settings, "agent");
  return (
    hasUsableModelSelection(agent) &&
    hasUsableModelMetadata(agent) &&
    hasUsableCredential(auth[agent.provider])
  );
}

export function resolveConfiguredLlmModel(
  role: ClutchModelRole,
  paths = getClutchConfigPaths(),
): ResolvedConfiguredLlmModel {
  const settings = loadClutchSettings(paths);
  const auth = loadClutchAuth(paths);
  const selection = getModelSelectionForRole(settings, role);

  if (!hasUsableModelSelection(selection)) {
    throw new Error(
      `Clutch ${role} model is not configured. Run /config to set up models and API keys.`,
    );
  }

  if (!hasUsableModelMetadata(selection)) {
    throw new Error(
      `Clutch ${role} model "${selection.model}" for provider "${selection.provider}" is missing dynamic model metadata. Run /config to re-select it.`,
    );
  }
  const credential = auth[selection.provider];
  if (!hasUsableCredential(credential)) {
    throw new Error(
      `Missing Clutch credentials for provider "${selection.provider}". Run /config to configure credentials.`,
    );
  }

  return {
    credential,
    effortLevel: getClutchModelEffortLevel(selection),
    model: normalizeClutchModelMetadata(selection.metadata),
    serviceTier: getClutchModelServiceTier(selection),
  };
}

export function resolveConfiguredAgentBackend(
  paths = getClutchConfigPaths(),
): ClutchAgentBackendConfig {
  return normalizeAgentBackendConfig(
    loadClutchSettings(paths).agentBackend ?? DEFAULT_AGENT_BACKEND,
  );
}

export async function resolveConfiguredLlmRequest(
  role: ClutchModelRole,
  paths = getClutchConfigPaths(),
): Promise<ResolvedConfiguredLlmRequest> {
  const { credential, effortLevel, model, serviceTier } =
    resolveConfiguredLlmModel(role, paths);

  if (credential.type === "api_key") {
    return {
      apiKey: credential.key,
      effortLevel,
      model,
      serviceTier,
    };
  }

  const provider = model.provider;
  assertOAuthProvider(provider);
  const result = await getOAuthApiKey(provider, {
    [provider]: credential,
  });
  if (result === null) {
    throw new Error(
      `Missing Clutch OAuth credentials for provider "${provider}". Run /config to log in.`,
    );
  }

  if (oauthCredentialChanged(credential, result.newCredentials)) {
    saveClutchOAuthCredential({
      credential: result.newCredentials,
      paths,
      provider,
    });
  }

  return {
    apiKey: result.apiKey,
    effortLevel,
    model,
    serviceTier,
  };
}

function getModelSelectionForRole(
  settings: ClutchSettings,
  role: ClutchModelRole,
): ClutchModelSelection | undefined {
  if (role === "agent") {
    return settings.models?.agent ?? settings.models?.primary;
  }

  return settings.models?.[role];
}

export function saveClutchConfiguration({
  agent,
  apiKey,
  paths = getClutchConfigPaths(),
  primary,
  summarization,
}: {
  agent?: ClutchModelSelection;
  apiKey?: string;
  paths?: ClutchConfigPaths;
  primary: ClutchModelSelection;
  summarization: ClutchModelSelection;
}) {
  if (apiKey !== undefined) {
    saveClutchApiKey({ apiKey, paths, provider: primary.provider });
  }
  saveClutchModelConfiguration({
    agent,
    paths,
    primary,
    summarization,
  });
}

export function saveClutchApiKey({
  apiKey,
  paths = getClutchConfigPaths(),
  provider,
}: {
  apiKey: string;
  paths?: ClutchConfigPaths;
  provider: SupportedClutchLlmProvider;
}) {
  const normalizedApiKey = apiKey.trim();
  if (normalizedApiKey.length === 0) {
    throw new Error(`Missing Clutch API key for provider "${provider}".`);
  }

  const existingAuth = loadClutchAuth(paths);
  mkdirSync(paths.configDir, { recursive: true });
  writeClutchAuth(paths, {
    ...existingAuth,
    [provider]: {
      key: normalizedApiKey,
      type: "api_key",
    },
  });
}

export function saveClutchOAuthCredential({
  credential,
  paths = getClutchConfigPaths(),
  provider,
}: {
  credential: OAuthCredentials;
  paths?: ClutchConfigPaths;
  provider: SupportedClutchLlmProvider;
}) {
  assertOAuthProvider(provider);

  const existingAuth = loadClutchAuth(paths);
  mkdirSync(paths.configDir, { recursive: true });
  writeClutchAuth(paths, {
    ...existingAuth,
    [provider]: {
      ...credential,
      type: "oauth",
    },
  });
}

export function saveClutchModelConfiguration({
  agent,
  paths = getClutchConfigPaths(),
  primary,
  summarization,
}: {
  agent?: ClutchModelSelection;
  paths?: ClutchConfigPaths;
  primary: ClutchModelSelection;
  summarization: ClutchModelSelection;
}) {
  const agentSelection = normalizeModelSelectionForSave(agent ?? primary);
  const primarySelection = normalizeModelSelectionForSave(primary);
  const summarizationSelection = normalizeModelSelectionForSave(summarization);
  assertUsableModelSelection(agentSelection, "agent");
  assertUsableModelSelection(primarySelection, "primary");
  assertUsableModelSelection(summarizationSelection, "summarization");

  const auth = loadClutchAuth(paths);
  assertConfiguredProviderCredential(auth, agentSelection.provider);
  assertConfiguredProviderCredential(auth, primarySelection.provider);
  assertConfiguredProviderCredential(auth, summarizationSelection.provider);

  mkdirSync(paths.configDir, { recursive: true });
  const existingSettings = loadClutchSettings(paths);
  writeJsonFile(paths.settingsPath, {
    ...(existingSettings.agentBackend === undefined
      ? {}
      : { agentBackend: existingSettings.agentBackend }),
    models: {
      agent: agentSelection,
      primary: primarySelection,
      summarization: summarizationSelection,
    },
  } satisfies ClutchSettings);
}

export function saveClutchAgentBackendConfiguration({
  backend,
  paths = getClutchConfigPaths(),
}: {
  backend: ClutchAgentBackendConfig;
  paths?: ClutchConfigPaths;
}) {
  const agentBackend = normalizeAgentBackendConfig(backend);
  const existingSettings = loadClutchSettings(paths);
  mkdirSync(paths.configDir, { recursive: true });
  writeJsonFile(paths.settingsPath, {
    ...existingSettings,
    agentBackend,
  } satisfies ClutchSettings);
}

export function createDefaultClutchConfigDraft(
  paths = getClutchConfigPaths(),
): {
  agentBackend?: ClutchAgentBackendConfig;
  agent: ClutchModelSelection;
  configuredProviders: SupportedClutchLlmProvider[];
  primary: ClutchModelSelection;
  summarization: ClutchModelSelection;
} {
  const settings = loadClutchSettings(paths);
  const auth = loadClutchAuth(paths);
  const primaryProvider =
    settings.models?.primary?.provider ?? DEFAULT_PROVIDER;
  const summarizationProvider =
    settings.models?.summarization?.provider ?? primaryProvider;
  const agentProvider = settings.models?.agent?.provider ?? primaryProvider;

  return {
    agentBackend: settings.agentBackend ?? DEFAULT_AGENT_BACKEND,
    agent: getExistingOrEmptyModelSelection({
      model: settings.models?.agent ?? settings.models?.primary,
      provider: agentProvider,
    }),
    configuredProviders: SUPPORTED_CLUTCH_LLM_PROVIDERS.map(
      (candidate) => candidate.id,
    ).filter((candidate) => hasUsableCredential(auth[candidate])),
    primary: getExistingOrEmptyModelSelection({
      model: settings.models?.primary,
      provider: primaryProvider,
    }),
    summarization: getExistingOrEmptyModelSelection({
      model: settings.models?.summarization,
      provider: summarizationProvider,
    }),
  };
}

function getExistingOrEmptyModelSelection({
  model,
  provider,
}: {
  model?: ClutchModelSelection;
  provider: SupportedClutchLlmProvider;
}): ClutchModelSelection {
  if (model?.provider === provider) {
    return normalizeModelSelectionForSave(model);
  }

  return {
    effortLevel: DEFAULT_CLUTCH_MODEL_EFFORT_LEVEL,
    model: "",
    provider,
    serviceTier: DEFAULT_CLUTCH_MODEL_SERVICE_TIER,
  };
}

function readJsonObject(path: string, label: string): unknown {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf-8"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${label} file could not be read: ${message}`);
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} file must contain a JSON object.`);
  }
  return parsed;
}

function writeJsonFile(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function writeClutchAuth(paths: ClutchConfigPaths, auth: ClutchAuth) {
  writeJsonFile(paths.authPath, auth);
  chmodSync(paths.authPath, 0o600);
}

function assertUsableModelSelection(
  selection: ClutchModelSelection,
  role: ClutchModelRole,
) {
  if (!hasUsableModelSelection(selection)) {
    throw new Error(`Clutch ${role} model is not configured.`);
  }
  if (!hasUsableModelMetadata(selection)) {
    throw new Error(
      `Clutch ${role} model "${selection.model}" for provider "${selection.provider}" is missing dynamic model metadata.`,
    );
  }
}

function assertConfiguredProviderCredential(
  auth: ClutchAuth,
  provider: SupportedClutchLlmProvider,
) {
  if (!hasUsableCredential(auth[provider])) {
    throw new Error(`Missing Clutch credentials for provider "${provider}".`);
  }
}

function hasUsableModelSelection(
  selection: ClutchModelSelection | undefined,
): selection is ClutchModelSelection {
  return (
    selection !== undefined &&
    isSupportedClutchProvider(selection.provider) &&
    selection.model.length > 0
  );
}

function hasUsableModelMetadata(
  selection: ClutchModelSelection,
): selection is ClutchModelSelection & { metadata: Model<Api> } {
  return selection.metadata !== undefined;
}

export function getClutchModelEffortLevel(
  selection: ClutchModelSelection,
): ClutchModelEffortLevel {
  return selection.effortLevel ?? DEFAULT_CLUTCH_MODEL_EFFORT_LEVEL;
}

export function getClutchModelServiceTier(
  selection: ClutchModelSelection,
): ClutchModelServiceTier {
  return selection.serviceTier ?? DEFAULT_CLUTCH_MODEL_SERVICE_TIER;
}

function normalizeModelSelectionForSave(
  selection: ClutchModelSelection,
): ClutchModelSelection {
  return {
    ...selection,
    effortLevel: getClutchModelEffortLevel(selection),
    serviceTier: getClutchModelServiceTier(selection),
  };
}

export function hasUsableApiKey(
  credential: ClutchApiKeyCredential | undefined,
): credential is ClutchApiKeyCredential {
  return credential?.type === "api_key" && credential.key.trim().length > 0;
}

export function hasUsableCredential(
  credential: ClutchCredential | undefined,
): credential is ClutchCredential {
  if (credential === undefined) {
    return false;
  }
  if (credential.type === "api_key") {
    return hasUsableApiKey(credential);
  }
  return (
    credential.access.trim().length > 0 &&
    credential.refresh.trim().length > 0 &&
    Number.isFinite(credential.expires)
  );
}

function assertOAuthProvider(
  provider: string,
): asserts provider is "openai-codex" {
  if (provider !== "openai-codex") {
    throw new Error(
      `Provider "${provider}" does not support Clutch OAuth login.`,
    );
  }
}

function oauthCredentialChanged(
  current: ClutchOAuthCredential,
  next: OAuthCredentials,
): boolean {
  return (
    current.access !== next.access ||
    current.refresh !== next.refresh ||
    current.expires !== next.expires
  );
}

function getSupportedProviderMetadata(provider: SupportedClutchLlmProvider) {
  const metadata = SUPPORTED_CLUTCH_LLM_PROVIDERS.find(
    (candidate) => candidate.id === provider,
  );
  if (metadata === undefined) {
    throw new Error(`Unsupported Clutch LLM provider: ${provider}`);
  }
  return metadata;
}
