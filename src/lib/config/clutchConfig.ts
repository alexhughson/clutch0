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

export const CLUTCH_CONFIG_DIR_ENV = "CLUTCH_CONFIG_DIR";

export const SUPPORTED_CLUTCH_LLM_PROVIDERS = [
  { id: "cerebras", label: "Cerebras" },
  { id: "google", label: "Google Gemini" },
  { id: "openai", label: "OpenAI" },
  { id: "openai-codex", label: "OpenAI subscription" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "opencode", label: "OpenCode Zen" },
  { id: "opencode-go", label: "OpenCode Go" },
  { id: "sambanova", label: "SambaNova" },
] as const;

export type SupportedClutchLlmProvider =
  (typeof SUPPORTED_CLUTCH_LLM_PROVIDERS)[number]["id"];

export type ClutchModelRole = "agent" | "primary" | "summarization";

export const CLUTCH_MODEL_EFFORT_LEVELS = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
] as const;

export type ClutchModelEffortLevel =
  (typeof CLUTCH_MODEL_EFFORT_LEVELS)[number];

export const DEFAULT_CLUTCH_MODEL_EFFORT_LEVEL: ClutchModelEffortLevel = "low";

export const CLUTCH_MODEL_SERVICE_TIERS = ["default", "priority"] as const;

export type ClutchModelServiceTier =
  (typeof CLUTCH_MODEL_SERVICE_TIERS)[number];

export const DEFAULT_CLUTCH_MODEL_SERVICE_TIER: ClutchModelServiceTier =
  "default";

export type ClutchModelSelection = {
  effortLevel?: ClutchModelEffortLevel;
  metadata?: Model<Api>;
  model: string;
  provider: SupportedClutchLlmProvider;
  serviceTier?: ClutchModelServiceTier;
};

export type ClutchSettings = {
  agentBackend?: ClutchAgentBackendConfig;
  models?: Partial<Record<ClutchModelRole, ClutchModelSelection>>;
};

export type ClutchAgentBackendConfig = {
  args?: string[];
  command: string;
  env?: Record<string, string>;
};

export type ClutchApiKeyCredential = {
  key: string;
  type: "api_key";
};

export type ClutchOAuthCredential = OAuthCredentials & {
  type: "oauth";
};

export type ClutchCredential = ClutchApiKeyCredential | ClutchOAuthCredential;

export type ClutchAuth = Partial<
  Record<SupportedClutchLlmProvider, ClutchCredential>
>;

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

export function isSupportedClutchProvider(
  provider: string,
): provider is SupportedClutchLlmProvider {
  return SUPPORTED_CLUTCH_LLM_PROVIDERS.some(
    (candidate) => candidate.id === provider,
  );
}

export function loadClutchSettings(
  paths = getClutchConfigPaths(),
): ClutchSettings {
  if (!existsSync(paths.settingsPath)) {
    return {};
  }

  return parseClutchSettings(
    readJsonObject(paths.settingsPath, "Clutch settings"),
  );
}

export function loadClutchAuth(paths = getClutchConfigPaths()): ClutchAuth {
  if (!existsSync(paths.authPath)) {
    return {};
  }

  return parseClutchAuth(readJsonObject(paths.authPath, "Clutch auth"));
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

function parseClutchSettings(raw: Record<string, unknown>): ClutchSettings {
  const models = raw.models;
  if (
    models !== undefined &&
    (models === null || typeof models !== "object" || Array.isArray(models))
  ) {
    throw new Error("Clutch settings field models must be an object.");
  }

  return {
    agentBackend: parseAgentBackendConfig(raw.agentBackend),
    ...(models === undefined
      ? {}
      : { models: parseModelSelections(models as Record<string, unknown>) }),
  };
}

function parseAgentBackendConfig(
  raw: unknown,
): ClutchAgentBackendConfig | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("Clutch settings field agentBackend must be an object.");
  }

  return normalizeAgentBackendConfig(raw as Record<string, unknown>);
}

function normalizeAgentBackendConfig(
  raw: ClutchAgentBackendConfig | Record<string, unknown>,
): ClutchAgentBackendConfig {
  const command = raw.command;
  if (typeof command !== "string" || command.trim().length === 0) {
    throw new Error("Clutch agentBackend.command must be a non-empty string.");
  }

  const args = raw.args;
  if (args !== undefined && !isStringArray(args)) {
    throw new Error("Clutch agentBackend.args must be a string array.");
  }

  const env = raw.env;
  if (env !== undefined && !isStringRecord(env)) {
    throw new Error("Clutch agentBackend.env must be an object of strings.");
  }

  return {
    ...(args === undefined ? {} : { args }),
    command,
    ...(env === undefined ? {} : { env }),
  };
}

function parseModelSelections(
  rawModels: Record<string, unknown>,
): Partial<Record<ClutchModelRole, ClutchModelSelection>> {
  return {
    agent: parseModelSelection(rawModels.agent, "agent"),
    primary: parseModelSelection(rawModels.primary, "primary"),
    summarization: parseModelSelection(
      rawModels.summarization,
      "summarization",
    ),
  };
}

function parseModelSelection(
  raw: unknown,
  role: ClutchModelRole,
): ClutchModelSelection | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Clutch ${role} model config must be an object.`);
  }

  const provider = (raw as Record<string, unknown>).provider;
  const model = (raw as Record<string, unknown>).model;
  const metadata = (raw as Record<string, unknown>).metadata;
  const effortLevel = parseModelEffortLevel({
    raw: (raw as Record<string, unknown>).effortLevel,
    role,
  });
  const serviceTier = parseModelServiceTier({
    raw: (raw as Record<string, unknown>).serviceTier,
    role,
  });
  if (typeof provider !== "string" || typeof model !== "string") {
    throw new Error(
      `Clutch ${role} model config must include provider and model strings.`,
    );
  }
  if (!isSupportedClutchProvider(provider)) {
    throw new Error(`Unsupported Clutch LLM provider: ${provider}`);
  }

  if (metadata === undefined) {
    return { effortLevel, model, provider, serviceTier };
  }

  return {
    effortLevel,
    metadata: parseModelMetadata({ metadata, modelId: model, provider, role }),
    model,
    provider,
    serviceTier,
  };
}

function parseClutchAuth(raw: Record<string, unknown>): ClutchAuth {
  const auth: ClutchAuth = {};
  for (const [provider, credential] of Object.entries(raw)) {
    if (!isSupportedClutchProvider(provider)) {
      continue;
    }
    if (
      credential === null ||
      typeof credential !== "object" ||
      Array.isArray(credential)
    ) {
      throw new Error(
        `Clutch auth credential for ${provider} must be an object.`,
      );
    }

    const type = (credential as Record<string, unknown>).type;
    if (type === "api_key") {
      const key = (credential as Record<string, unknown>).key;
      if (typeof key !== "string") {
        throw new Error(
          `Clutch auth credential for ${provider} with type "api_key" must include key string.`,
        );
      }
      auth[provider] = { key, type };
      continue;
    }
    if (type === "oauth") {
      auth[provider] = parseOAuthCredential(provider, credential);
      continue;
    }
    throw new Error(
      `Clutch auth credential for ${provider} must include type "api_key" or "oauth".`,
    );
  }

  return auth;
}

function readJsonObject(path: string, label: string): Record<string, unknown> {
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
  return parsed as Record<string, unknown>;
}

function writeJsonFile(path: string, value: unknown) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function writeClutchAuth(paths: ClutchConfigPaths, auth: ClutchAuth) {
  writeJsonFile(paths.authPath, auth);
  chmodSync(paths.authPath, 0o600);
}

function parseModelMetadata({
  metadata,
  modelId,
  provider,
  role,
}: {
  metadata: unknown;
  modelId: string;
  provider: SupportedClutchLlmProvider;
  role: ClutchModelRole;
}): Model<Api> {
  if (
    metadata === null ||
    typeof metadata !== "object" ||
    Array.isArray(metadata)
  ) {
    throw new Error(`Clutch ${role} model metadata must be an object.`);
  }

  const candidate = metadata as Record<string, unknown>;
  if (candidate.id !== modelId) {
    throw new Error(`Clutch ${role} model metadata id must match model.`);
  }
  if (candidate.provider !== provider) {
    throw new Error(
      `Clutch ${role} model metadata provider must match provider.`,
    );
  }
  if (typeof candidate.name !== "string" || candidate.name.length === 0) {
    throw new Error(`Clutch ${role} model metadata name must be a string.`);
  }
  if (typeof candidate.api !== "string" || candidate.api.length === 0) {
    throw new Error(`Clutch ${role} model metadata api must be a string.`);
  }
  if (typeof candidate.baseUrl !== "string" || candidate.baseUrl.length === 0) {
    throw new Error(`Clutch ${role} model metadata baseUrl must be a string.`);
  }
  if (typeof candidate.reasoning !== "boolean") {
    throw new Error(
      `Clutch ${role} model metadata reasoning must be a boolean.`,
    );
  }
  if (!isStringArray(candidate.input)) {
    throw new Error(
      `Clutch ${role} model metadata input must be a string array.`,
    );
  }
  if (!isPositiveNumber(candidate.contextWindow)) {
    throw new Error(
      `Clutch ${role} model metadata contextWindow must be a positive number.`,
    );
  }
  if (!isPositiveNumber(candidate.maxTokens)) {
    throw new Error(
      `Clutch ${role} model metadata maxTokens must be a positive number.`,
    );
  }
  if (!isCostObject(candidate.cost)) {
    throw new Error(
      `Clutch ${role} model metadata cost must include numeric token costs.`,
    );
  }

  return candidate as unknown as Model<Api>;
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

function parseModelEffortLevel({
  raw,
  role,
}: {
  raw: unknown;
  role: ClutchModelRole;
}): ClutchModelEffortLevel {
  if (raw === undefined) {
    return DEFAULT_CLUTCH_MODEL_EFFORT_LEVEL;
  }
  if (typeof raw !== "string" || !isClutchModelEffortLevel(raw)) {
    throw new Error(
      `Clutch ${role} model effortLevel must be one of: ${CLUTCH_MODEL_EFFORT_LEVELS.join(", ")}.`,
    );
  }
  return raw;
}

function isClutchModelEffortLevel(
  value: string,
): value is ClutchModelEffortLevel {
  return CLUTCH_MODEL_EFFORT_LEVELS.some((level) => level === value);
}

function parseModelServiceTier({
  raw,
  role,
}: {
  raw: unknown;
  role: ClutchModelRole;
}): ClutchModelServiceTier {
  if (raw === undefined) {
    return DEFAULT_CLUTCH_MODEL_SERVICE_TIER;
  }
  if (typeof raw !== "string" || !isClutchModelServiceTier(raw)) {
    throw new Error(
      `Clutch ${role} model serviceTier must be one of: ${CLUTCH_MODEL_SERVICE_TIERS.join(", ")}.`,
    );
  }
  return raw;
}

function isClutchModelServiceTier(
  value: string,
): value is ClutchModelServiceTier {
  return CLUTCH_MODEL_SERVICE_TIERS.some((tier) => tier === value);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value).every((item) => typeof item === "string")
  );
}

function isPositiveNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isCostObject(value: unknown): boolean {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  const cost = value as Record<string, unknown>;
  return (
    typeof cost.input === "number" &&
    typeof cost.output === "number" &&
    typeof cost.cacheRead === "number" &&
    typeof cost.cacheWrite === "number"
  );
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

function parseOAuthCredential(
  provider: string,
  credential: object,
): ClutchOAuthCredential {
  assertOAuthProvider(provider);

  const raw = credential as Record<string, unknown>;
  if (
    typeof raw.access !== "string" ||
    typeof raw.refresh !== "string" ||
    typeof raw.expires !== "number" ||
    !Number.isFinite(raw.expires)
  ) {
    throw new Error(
      `Clutch auth credential for ${provider} with type "oauth" must include access, refresh, and expires.`,
    );
  }

  return {
    ...(raw as OAuthCredentials),
    access: raw.access,
    expires: raw.expires,
    refresh: raw.refresh,
    type: "oauth",
  };
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
