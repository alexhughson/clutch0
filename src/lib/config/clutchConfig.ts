import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { homedir } from "os";
import { join } from "path";
import type { LlmModel } from "../llm/types";
import {
  OPENROUTER_BASE_URL,
  openRouterModelTraits,
} from "./openRouterCapabilities";

export const CLUTCH_CONFIG_DIR_ENV = "CLUTCH_CONFIG_DIR";

export const OPENROUTER_PROVIDER_ID = "openrouter";
export { OPENROUTER_BASE_URL };

const LEGACY_PROVIDER_IDS = new Set([
  "cerebras",
  "google",
  "openai",
  "openai-codex",
  "opencode",
  "opencode-go",
  "sambanova",
]);

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

export const CLUTCH_MODEL_SERVICE_TIERS = [
  "default",
  "flex",
  "priority",
] as const;

export type ClutchModelServiceTier =
  (typeof CLUTCH_MODEL_SERVICE_TIERS)[number];

export const DEFAULT_CLUTCH_MODEL_SERVICE_TIER: ClutchModelServiceTier =
  "default";

export type ClutchEndpoint = {
  baseUrl: string;
  headers?: Record<string, string>;
  id: string;
  label: string;
  requestDefaults?: Record<string, unknown>;
};

export type OpenRouterCapabilities = {
  supportsReasoning: boolean;
  supportsServiceTier: boolean;
  vendors: string[];
};

export type OpenRouterOptions = {
  allowFallbacks?: boolean;
  capabilities?: OpenRouterCapabilities;
  providerExtras?: Record<string, unknown>;
  serviceTier?: ClutchModelServiceTier;
  sort?: "latency" | "price" | "throughput";
  vendor?: string;
};

export type ClutchModelSelection = {
  effortLevel?: ClutchModelEffortLevel;
  model: string;
  openRouter?: OpenRouterOptions;
  provider: string;
};

export type ClutchSettings = {
  agentBackend?: ClutchAgentBackendConfig;
  endpoints?: ClutchEndpoint[];
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

export type ClutchAuth = Partial<Record<string, ClutchApiKeyCredential>>;

export type ClutchConfigPaths = {
  authPath: string;
  configDir: string;
  settingsPath: string;
};

export type ResolvedConfiguredLlmModel = {
  credential: ClutchApiKeyCredential;
  effortLevel: ClutchModelEffortLevel;
  model: LlmModel;
  openRouter?: OpenRouterOptions;
  requestDefaults?: Record<string, unknown>;
};

export type ResolvedConfiguredLlmRequest = {
  apiKey: string;
  effortLevel: ClutchModelEffortLevel;
  headers?: Record<string, string>;
  model: LlmModel;
  openRouter?: OpenRouterOptions;
  requestDefaults?: Record<string, unknown>;
};

const DEFAULT_AGENT_BACKEND: ClutchAgentBackendConfig = {
  args: ["acp"],
  command: "cursor-agent",
};

const DEFAULT_PROVIDER = OPENROUTER_PROVIDER_ID;
const DEFAULT_LLM_COST = {
  cacheRead: 0,
  cacheWrite: 0,
  input: 0,
  output: 0,
} as const;

export function getClutchConfigPaths(
  configDir = process.env[CLUTCH_CONFIG_DIR_ENV] ?? join(homedir(), ".clutch"),
): ClutchConfigPaths {
  return {
    authPath: join(configDir, "auth.json"),
    configDir,
    settingsPath: join(configDir, "settings.json"),
  };
}

export function getClutchProviderLabel(
  provider: string,
  settings: ClutchSettings = {},
): string {
  if (provider === OPENROUTER_PROVIDER_ID) {
    return "OpenRouter";
  }

  const endpoint = settings.endpoints?.find((candidate) => candidate.id === provider);
  return endpoint?.label ?? provider;
}

export function isClutchProviderId(
  provider: string,
  settings: ClutchSettings = {},
): boolean {
  if (provider === OPENROUTER_PROVIDER_ID) {
    return true;
  }
  return settings.endpoints?.some((endpoint) => endpoint.id === provider) ?? false;
}

let clutchConfigRecoveryNotice: string | null = null;

export function peekClutchConfigRecoveryNotice(): string | null {
  return clutchConfigRecoveryNotice;
}

export function loadClutchSettings(
  paths = getClutchConfigPaths(),
): ClutchSettings {
  if (!existsSync(paths.settingsPath)) {
    return {};
  }

  const raw = readJsonObject(paths.settingsPath, "Clutch settings");
  try {
    return parseClutchSettings(raw);
  } catch (error) {
    const recovered = salvageClutchSettings(raw);
    mkdirSync(paths.configDir, { recursive: true });
    writeJsonFile(paths.settingsPath, recovered);
    setClutchConfigRecoveryNotice(error);
    return recovered;
  }
}

export function loadClutchAuth(paths = getClutchConfigPaths()): ClutchAuth {
  if (!existsSync(paths.authPath)) {
    return {};
  }

  const raw = readJsonObject(paths.authPath, "Clutch auth");
  try {
    return parseClutchAuth(raw);
  } catch (error) {
    const recovered = salvageClutchAuth(raw);
    mkdirSync(paths.configDir, { recursive: true });
    writeClutchAuth(paths, recovered);
    setClutchConfigRecoveryNotice(error);
    return recovered;
  }
}

function setClutchConfigRecoveryNotice(error: unknown): void {
  const detail = error instanceof Error ? error.message : String(error);
  clutchConfigRecoveryNotice = `Cleared incompatible config. Run /config. (${detail})`;
}

function salvageClutchSettings(raw: Record<string, unknown>): ClutchSettings {
  const recovered: ClutchSettings = {};

  try {
    if (
      raw.agentBackend !== undefined &&
      raw.agentBackend !== null &&
      typeof raw.agentBackend === "object" &&
      !Array.isArray(raw.agentBackend)
    ) {
      recovered.agentBackend = normalizeAgentBackendConfig(
        raw.agentBackend as Record<string, unknown>,
      );
    }
  } catch {
    // drop invalid agent backend
  }

  try {
    const endpoints = parseEndpoints(raw.endpoints);
    if (endpoints !== undefined) {
      recovered.endpoints = endpoints;
    }
  } catch {
    // drop invalid endpoints
  }

  const modelsRaw = raw.models;
  if (
    modelsRaw !== null &&
    typeof modelsRaw === "object" &&
    !Array.isArray(modelsRaw)
  ) {
    const models: Partial<Record<ClutchModelRole, ClutchModelSelection>> = {};
    for (const role of ["primary", "summarization", "agent"] as const) {
      const selection = (modelsRaw as Record<string, unknown>)[role];
      if (selection === undefined) {
        continue;
      }
      try {
        models[role] = parseModelSelection(
          selection,
          role,
          recovered.endpoints ?? [],
        );
      } catch {
        // drop invalid role
      }
    }
    if (Object.keys(models).length > 0) {
      recovered.models = models;
    }
  }

  return recovered;
}

function salvageClutchAuth(raw: Record<string, unknown>): ClutchAuth {
  const auth: ClutchAuth = {};
  for (const [provider, credential] of Object.entries(raw)) {
    if (LEGACY_PROVIDER_IDS.has(provider)) {
      continue;
    }
    if (
      credential === null ||
      typeof credential !== "object" ||
      Array.isArray(credential)
    ) {
      continue;
    }
    const record = credential as Record<string, unknown>;
    if (record.type !== "api_key" || typeof record.key !== "string") {
      continue;
    }
    if (record.key.trim().length === 0) {
      continue;
    }
    auth[provider] = { key: record.key, type: "api_key" };
  }
  return auth;
}

export function isClutchConfigured(paths = getClutchConfigPaths()): boolean {
  const settings = loadClutchSettings(paths);
  const auth = loadClutchAuth(paths);

  return (
    hasUsableModelSelection(settings, settings.models?.primary) &&
    hasUsableModelSelection(settings, settings.models?.summarization) &&
    isConfiguredAgentModel(settings, auth) &&
    hasUsableApiKey(auth[settings.models!.primary!.provider]) &&
    hasUsableApiKey(auth[settings.models!.summarization!.provider])
  );
}

export function resolveConfiguredLlmModel(
  role: ClutchModelRole,
  paths = getClutchConfigPaths(),
): ResolvedConfiguredLlmModel {
  const settings = loadClutchSettings(paths);
  const auth = loadClutchAuth(paths);
  const selection = getModelSelectionForRole(settings, role);

  if (!hasUsableModelSelection(settings, selection)) {
    throw new Error(
      `Clutch ${role} model is not configured. Run /config to set up models and API keys.`,
    );
  }

  const credential = resolveApiKeyCredential(auth, selection.provider);
  const endpoint = resolveEndpointConfig(selection.provider, settings);
  const traits =
    selection.provider === OPENROUTER_PROVIDER_ID
      ? openRouterModelTraits(selection.model)
      : { reasoning: false as const };

  return {
    credential,
    effortLevel: getClutchModelEffortLevel(selection),
    model: {
      api: "openai-completions",
      baseUrl: endpoint.baseUrl,
      contextWindow: 128_000,
      cost: { ...DEFAULT_LLM_COST },
      headers: endpoint.headers,
      id: selection.model,
      input: ["text"],
      maxTokens: 16_384,
      name: selection.model,
      provider: selection.provider,
      reasoning:
        selection.provider === OPENROUTER_PROVIDER_ID
          ? selection.openRouter?.capabilities?.supportsReasoning === true
          : traits.reasoning,
      ...(traits.thinkingLevelMap === undefined
        ? {}
        : { thinkingLevelMap: traits.thinkingLevelMap }),
    },
    ...(selection.openRouter === undefined
      ? {}
      : { openRouter: selection.openRouter }),
    ...(endpoint.requestDefaults === undefined
      ? {}
      : { requestDefaults: endpoint.requestDefaults }),
  };
}

export function resolveConfiguredAgentBackend(
  paths = getClutchConfigPaths(),
): ClutchAgentBackendConfig {
  return normalizeAgentBackendConfig(
    loadClutchSettings(paths).agentBackend ?? DEFAULT_AGENT_BACKEND,
  );
}

export function resolveConfiguredLlmRequest(
  role: ClutchModelRole,
  paths = getClutchConfigPaths(),
): ResolvedConfiguredLlmRequest {
  const { credential, effortLevel, model, openRouter, requestDefaults } =
    resolveConfiguredLlmModel(role, paths);

  return {
    apiKey: credential.key,
    effortLevel,
    headers: model.headers,
    model,
    ...(openRouter === undefined ? {} : { openRouter }),
    ...(requestDefaults === undefined ? {} : { requestDefaults }),
  };
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
  provider: string;
}) {
  assertClutchProviderId(provider, loadClutchSettings(paths));
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
  const settings = loadClutchSettings(paths);
  const agentSelection = normalizeModelSelectionForSave(agent ?? primary);
  const primarySelection = normalizeModelSelectionForSave(primary);
  const summarizationSelection = normalizeModelSelectionForSave(summarization);
  assertUsableModelSelection(settings, agentSelection, "agent");
  assertUsableModelSelection(settings, primarySelection, "primary");
  assertUsableModelSelection(settings, summarizationSelection, "summarization");

  const auth = loadClutchAuth(paths);
  assertConfiguredProviderCredential(settings, auth, agentSelection.provider);
  assertConfiguredProviderCredential(settings, auth, primarySelection.provider);
  assertConfiguredProviderCredential(
    settings,
    auth,
    summarizationSelection.provider,
  );

  mkdirSync(paths.configDir, { recursive: true });
  const existingSettings = loadClutchSettings(paths);
  writeJsonFile(paths.settingsPath, {
    ...(existingSettings.endpoints === undefined
      ? {}
      : { endpoints: existingSettings.endpoints }),
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

export function findModelRolesUsingProvider(
  models: Partial<Record<ClutchModelRole, ClutchModelSelection>>,
  providerId: string,
): ClutchModelRole[] {
  const roles: ClutchModelRole[] = [];
  if (models.primary?.provider === providerId) {
    roles.push("primary");
  }
  if (models.agent?.provider === providerId) {
    roles.push("agent");
  }
  if (models.summarization?.provider === providerId) {
    roles.push("summarization");
  }
  return roles;
}

export function saveClutchEndpointConfiguration({
  apiKey,
  endpoint,
  paths = getClutchConfigPaths(),
}: {
  apiKey?: string;
  endpoint: ClutchEndpoint;
  paths?: ClutchConfigPaths;
}) {
  assertEndpointSlug(endpoint.id);
  const normalizedEndpoint = normalizeEndpointForSave(endpoint);
  const settings = loadClutchSettings(paths);
  const endpoints = [...(settings.endpoints ?? [])];
  const existingIndex = endpoints.findIndex(
    (candidate) => candidate.id === normalizedEndpoint.id,
  );
  if (existingIndex === -1) {
    endpoints.push(normalizedEndpoint);
  } else {
    endpoints[existingIndex] = normalizedEndpoint;
  }

  mkdirSync(paths.configDir, { recursive: true });
  writeJsonFile(paths.settingsPath, {
    ...settings,
    endpoints,
  } satisfies ClutchSettings);

  if (apiKey !== undefined) {
    saveClutchApiKey({ apiKey, paths, provider: normalizedEndpoint.id });
  }
}

export function deleteClutchEndpointConfiguration({
  endpointId,
  paths = getClutchConfigPaths(),
}: {
  endpointId: string;
  paths?: ClutchConfigPaths;
}) {
  if (endpointId === OPENROUTER_PROVIDER_ID) {
    throw new Error("Cannot delete the built-in OpenRouter provider.");
  }

  const settings = loadClutchSettings(paths);
  const roles = findModelRolesUsingProvider(settings.models ?? {}, endpointId);
  if (roles.length > 0) {
    throw new Error(
      `Cannot delete endpoint "${endpointId}" while ${roles.join(", ")} model(s) still use it. Change those models first.`,
    );
  }

  const endpoints = settings.endpoints ?? [];
  if (!endpoints.some((candidate) => candidate.id === endpointId)) {
    throw new Error(`Endpoint "${endpointId}" was not found.`);
  }

  mkdirSync(paths.configDir, { recursive: true });
  const { endpoints: _endpoints, ...restSettings } = settings;
  const nextEndpoints = endpoints.filter((candidate) => candidate.id !== endpointId);
  writeJsonFile(paths.settingsPath, {
    ...restSettings,
    ...(nextEndpoints.length === 0 ? {} : { endpoints: nextEndpoints }),
  } satisfies ClutchSettings);

  const auth = loadClutchAuth(paths);
  if (auth[endpointId] !== undefined) {
    const { [endpointId]: _removed, ...restAuth } = auth;
    writeClutchAuth(paths, restAuth);
  }
}

export function createDefaultClutchConfigDraft(
  paths = getClutchConfigPaths(),
): {
  agent: ClutchModelSelection;
  agentBackend?: ClutchAgentBackendConfig;
  configuredProviders: string[];
  endpoints: ClutchEndpoint[];
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
    configuredProviders: listConfiguredProviders(settings, auth),
    endpoints: settings.endpoints ?? [],
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

export function getClutchModelEffortLevel(
  selection: ClutchModelSelection,
): ClutchModelEffortLevel {
  return selection.effortLevel ?? DEFAULT_CLUTCH_MODEL_EFFORT_LEVEL;
}

export function getClutchOpenRouterServiceTier(
  selection: ClutchModelSelection,
): ClutchModelServiceTier {
  return selection.openRouter?.serviceTier ?? DEFAULT_CLUTCH_MODEL_SERVICE_TIER;
}

export function hasUsableApiKey(
  credential: ClutchApiKeyCredential | undefined,
): credential is ClutchApiKeyCredential {
  return credential?.type === "api_key" && credential.key.trim().length > 0;
}

export function listConfiguredProviders(
  settings: ClutchSettings,
  auth: ClutchAuth,
): string[] {
  const providers: string[] = [];
  if (hasUsableApiKey(auth[OPENROUTER_PROVIDER_ID])) {
    providers.push(OPENROUTER_PROVIDER_ID);
  }
  for (const endpoint of settings.endpoints ?? []) {
    if (hasUsableApiKey(auth[endpoint.id])) {
      providers.push(endpoint.id);
    }
  }
  return providers;
}

function isConfiguredAgentModel(
  settings: ClutchSettings,
  auth: ClutchAuth,
): boolean {
  const agent = getModelSelectionForRole(settings, "agent");
  return (
    hasUsableModelSelection(settings, agent) &&
    hasUsableApiKey(auth[agent!.provider])
  );
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

function getExistingOrEmptyModelSelection({
  model,
  provider,
}: {
  model?: ClutchModelSelection;
  provider: string;
}): ClutchModelSelection {
  if (model?.provider === provider) {
    return normalizeModelSelectionForSave(model);
  }

  return {
    effortLevel: DEFAULT_CLUTCH_MODEL_EFFORT_LEVEL,
    model: "",
    provider,
    openRouter: { serviceTier: DEFAULT_CLUTCH_MODEL_SERVICE_TIER },
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

  const endpoints = parseEndpoints(raw.endpoints);

  return {
    agentBackend: parseAgentBackendConfig(raw.agentBackend),
    ...(endpoints === undefined ? {} : { endpoints }),
    ...(models === undefined
      ? {}
      : {
          models: parseModelSelections(
            models as Record<string, unknown>,
            endpoints ?? [],
          ),
        }),
  };
}

function parseEndpoints(raw: unknown): ClutchEndpoint[] | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (!Array.isArray(raw)) {
    throw new Error("Clutch settings field endpoints must be an array.");
  }

  const endpoints: ClutchEndpoint[] = [];
  const seenIds = new Set<string>();
  for (const [index, item] of raw.entries()) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`Clutch endpoints[${index}] must be an object.`);
    }
    const record = item as Record<string, unknown>;
    const id = record.id;
    const label = record.label;
    const baseUrl = record.baseUrl;
    if (typeof id !== "string" || id.trim().length === 0) {
      throw new Error(`Clutch endpoints[${index}].id must be a non-empty string.`);
    }
    if (id === OPENROUTER_PROVIDER_ID) {
      throw new Error(
        `Clutch endpoint id "${OPENROUTER_PROVIDER_ID}" is reserved.`,
      );
    }
    if (seenIds.has(id)) {
      throw new Error(`Duplicate Clutch endpoint id "${id}".`);
    }
    seenIds.add(id);
    if (typeof label !== "string" || label.trim().length === 0) {
      throw new Error(
        `Clutch endpoints[${index}].label must be a non-empty string.`,
      );
    }
    if (typeof baseUrl !== "string" || baseUrl.trim().length === 0) {
      throw new Error(
        `Clutch endpoints[${index}].baseUrl must be a non-empty string.`,
      );
    }
    const headers = record.headers;
    if (headers !== undefined && !isStringRecord(headers)) {
      throw new Error(
        `Clutch endpoints[${index}].headers must be an object of strings.`,
      );
    }
    const requestDefaults = record.requestDefaults;
    if (
      requestDefaults !== undefined &&
      (requestDefaults === null ||
        typeof requestDefaults !== "object" ||
        Array.isArray(requestDefaults))
    ) {
      throw new Error(
        `Clutch endpoints[${index}].requestDefaults must be an object.`,
      );
    }

    endpoints.push({
      baseUrl,
      id,
      label,
      ...(headers === undefined ? {} : { headers }),
      ...(requestDefaults === undefined
        ? {}
        : { requestDefaults: requestDefaults as Record<string, unknown> }),
    });
  }

  return endpoints;
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
  endpoints: readonly ClutchEndpoint[],
): Partial<Record<ClutchModelRole, ClutchModelSelection>> {
  return {
    agent: parseModelSelection(rawModels.agent, "agent", endpoints),
    primary: parseModelSelection(rawModels.primary, "primary", endpoints),
    summarization: parseModelSelection(
      rawModels.summarization,
      "summarization",
      endpoints,
    ),
  };
}

function parseModelSelection(
  raw: unknown,
  role: ClutchModelRole,
  endpoints: readonly ClutchEndpoint[],
): ClutchModelSelection | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`Clutch ${role} model config must be an object.`);
  }

  const record = raw as Record<string, unknown>;
  const provider = record.provider;
  const model = record.model;
  const effortLevel = parseModelEffortLevel({
    raw: record.effortLevel,
    role,
  });
  if (typeof provider !== "string" || typeof model !== "string") {
    throw new Error(
      `Clutch ${role} model config must include provider and model strings.`,
    );
  }

  assertKnownProviderId(provider, endpoints);
  const legacyServiceTier = parseLegacyServiceTier({
    provider,
    raw: record.serviceTier,
    role,
  });
  const openRouter = parseOpenRouterOptions({
    legacyServiceTier,
    provider,
    raw: record.openRouter,
    role,
  });

  return {
    effortLevel,
    model,
    provider,
    ...(openRouter === undefined ? {} : { openRouter }),
  };
}

function parseOpenRouterOptions({
  legacyServiceTier,
  provider,
  raw,
  role,
}: {
  legacyServiceTier?: ClutchModelServiceTier;
  provider: string;
  raw: unknown;
  role: ClutchModelRole;
}): OpenRouterOptions | undefined {
  let openRouter: OpenRouterOptions | undefined;
  if (raw !== undefined) {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`Clutch ${role} model openRouter must be an object.`);
    }
    openRouter = parseOpenRouterOptionsObject(raw as Record<string, unknown>, role);
  }

  if (provider !== OPENROUTER_PROVIDER_ID) {
    return openRouter;
  }

  if (legacyServiceTier === undefined) {
    return openRouter;
  }

  const serviceTier = openRouter?.serviceTier ?? legacyServiceTier;
  const capabilities =
    openRouter?.capabilities === undefined
      ? {
          vendors: [] as string[],
          supportsReasoning: false,
          supportsServiceTier: true,
        }
      : {
          ...openRouter.capabilities,
          ...(serviceTier !== DEFAULT_CLUTCH_MODEL_SERVICE_TIER &&
          !openRouter.capabilities.supportsServiceTier
            ? { supportsServiceTier: true }
            : {}),
        };

  return {
    ...(openRouter ?? {}),
    serviceTier,
    capabilities,
  };
}

function parseOpenRouterOptionsObject(
  raw: Record<string, unknown>,
  role: ClutchModelRole,
): OpenRouterOptions {
  const vendor = raw.vendor;
  if (vendor !== undefined && typeof vendor !== "string") {
    throw new Error(`Clutch ${role} model openRouter.vendor must be a string.`);
  }

  const allowFallbacks = raw.allowFallbacks;
  if (allowFallbacks !== undefined && typeof allowFallbacks !== "boolean") {
    throw new Error(
      `Clutch ${role} model openRouter.allowFallbacks must be a boolean.`,
    );
  }

  const sort = raw.sort;
  if (
    sort !== undefined &&
    sort !== "price" &&
    sort !== "throughput" &&
    sort !== "latency"
  ) {
    throw new Error(
      `Clutch ${role} model openRouter.sort must be price, throughput, or latency.`,
    );
  }

  const serviceTier = parseModelServiceTier({
    raw: raw.serviceTier,
    role,
  });
  const providerExtras = raw.providerExtras;
  if (
    providerExtras !== undefined &&
    (providerExtras === null ||
      typeof providerExtras !== "object" ||
      Array.isArray(providerExtras))
  ) {
    throw new Error(
      `Clutch ${role} model openRouter.providerExtras must be an object.`,
    );
  }

  const capabilities = parseOpenRouterCapabilities(raw.capabilities, role);

  return {
    ...(vendor === undefined ? {} : { vendor }),
    ...(allowFallbacks === undefined ? {} : { allowFallbacks }),
    ...(sort === undefined ? {} : { sort }),
    ...(serviceTier === DEFAULT_CLUTCH_MODEL_SERVICE_TIER &&
    raw.serviceTier === undefined
      ? {}
      : { serviceTier }),
    ...(providerExtras === undefined
      ? {}
      : { providerExtras: providerExtras as Record<string, unknown> }),
    ...(capabilities === undefined ? {} : { capabilities }),
  };
}

function parseOpenRouterCapabilities(
  raw: unknown,
  role: ClutchModelRole,
): OpenRouterCapabilities | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(
      `Clutch ${role} model openRouter.capabilities must be an object.`,
    );
  }

  const record = raw as Record<string, unknown>;
  const vendors = record.vendors;
  if (!Array.isArray(vendors) || !vendors.every((item) => typeof item === "string")) {
    throw new Error(
      `Clutch ${role} model openRouter.capabilities.vendors must be a string array.`,
    );
  }

  const supportsReasoning = record.supportsReasoning;
  if (typeof supportsReasoning !== "boolean") {
    throw new Error(
      `Clutch ${role} model openRouter.capabilities.supportsReasoning must be a boolean.`,
    );
  }

  const supportsServiceTier = record.supportsServiceTier;
  if (typeof supportsServiceTier !== "boolean") {
    throw new Error(
      `Clutch ${role} model openRouter.capabilities.supportsServiceTier must be a boolean.`,
    );
  }

  return {
    supportsReasoning,
    supportsServiceTier,
    vendors,
  };
}

function parseLegacyServiceTier({
  provider,
  raw,
  role,
}: {
  provider: string;
  raw: unknown;
  role: ClutchModelRole;
}): ClutchModelServiceTier | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (provider !== OPENROUTER_PROVIDER_ID) {
    throw new Error(
      `Clutch ${role} model serviceTier is only supported on OpenRouter selections. Re-run /config.`,
    );
  }
  return parseModelServiceTier({ raw, role });
}

function parseClutchAuth(raw: Record<string, unknown>): ClutchAuth {
  const auth: ClutchAuth = {};
  for (const [provider, credential] of Object.entries(raw)) {
    if (LEGACY_PROVIDER_IDS.has(provider)) {
      throw new Error(
        `Legacy provider "${provider}" is no longer supported. Re-run /config.`,
      );
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
    if (type === "oauth") {
      throw new Error(
        "Legacy OAuth credentials are no longer supported. Re-run /config.",
      );
    }
    if (type !== "api_key") {
      throw new Error(
        `Clutch auth credential for ${provider} must include type "api_key".`,
      );
    }

    const key = (credential as Record<string, unknown>).key;
    if (typeof key !== "string") {
      throw new Error(
        `Clutch auth credential for ${provider} with type "api_key" must include key string.`,
      );
    }
    auth[provider] = { key, type: "api_key" };
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

function assertUsableModelSelection(
  settings: ClutchSettings,
  selection: ClutchModelSelection,
  role: ClutchModelRole,
) {
  if (!hasUsableModelSelection(settings, selection)) {
    throw new Error(`Clutch ${role} model is not configured.`);
  }
}

function assertConfiguredProviderCredential(
  settings: ClutchSettings,
  auth: ClutchAuth,
  provider: string,
) {
  assertClutchProviderId(provider, settings);
  if (!hasUsableApiKey(auth[provider])) {
    throw new Error(`Missing Clutch credentials for provider "${provider}".`);
  }
}

function hasUsableModelSelection(
  settings: ClutchSettings,
  selection: ClutchModelSelection | undefined,
): selection is ClutchModelSelection {
  return (
    selection !== undefined &&
    isClutchProviderId(selection.provider, settings) &&
    selection.model.length > 0
  );
}

function normalizeModelSelectionForSave(
  selection: ClutchModelSelection,
): ClutchModelSelection {
  const { openRouter, ...rest } = selection;
  return {
    ...rest,
    effortLevel: getClutchModelEffortLevel(selection),
    ...(selection.provider === OPENROUTER_PROVIDER_ID
      ? {
          openRouter: {
            ...(openRouter ?? {}),
            serviceTier: getClutchOpenRouterServiceTier(selection),
          },
        }
      : {}),
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

function assertKnownProviderId(
  provider: string,
  endpoints: readonly ClutchEndpoint[],
) {
  if (LEGACY_PROVIDER_IDS.has(provider)) {
    throw new Error(
      `Legacy provider "${provider}" is no longer supported. Re-run /config.`,
    );
  }
  if (!isClutchProviderId(provider, { endpoints: [...endpoints] })) {
    throw new Error(`Unknown Clutch provider "${provider}". Re-run /config.`);
  }
}

function assertClutchProviderId(provider: string, settings: ClutchSettings) {
  if (LEGACY_PROVIDER_IDS.has(provider)) {
    throw new Error(
      `Legacy provider "${provider}" is no longer supported. Re-run /config.`,
    );
  }
  if (!isClutchProviderId(provider, settings)) {
    throw new Error(`Unknown Clutch provider "${provider}". Re-run /config.`);
  }
}

function resolveEndpointConfig(
  provider: string,
  settings: ClutchSettings,
): {
  baseUrl: string;
  headers?: Record<string, string>;
  requestDefaults?: Record<string, unknown>;
} {
  assertClutchProviderId(provider, settings);
  if (provider === OPENROUTER_PROVIDER_ID) {
    return { baseUrl: OPENROUTER_BASE_URL };
  }

  const endpoint = settings.endpoints?.find((candidate) => candidate.id === provider);
  if (endpoint === undefined) {
    throw new Error(`Unknown Clutch endpoint "${provider}". Re-run /config.`);
  }

  return endpoint;
}

function assertEndpointSlug(id: string) {
  if (id === OPENROUTER_PROVIDER_ID) {
    throw new Error(`Endpoint id "${OPENROUTER_PROVIDER_ID}" is reserved.`);
  }
  if (!/^[a-z][a-z0-9-]*$/.test(id)) {
    throw new Error('Endpoint id must be a lowercase slug like "my-proxy".');
  }
}

function normalizeEndpointForSave(endpoint: ClutchEndpoint): ClutchEndpoint {
  const id = endpoint.id.trim();
  const label = endpoint.label.trim();
  const baseUrl = endpoint.baseUrl.trim();
  if (label.length === 0) {
    throw new Error("Endpoint label must be a non-empty string.");
  }
  if (baseUrl.length === 0) {
    throw new Error("Endpoint baseUrl must be a non-empty string.");
  }

  return {
    baseUrl,
    id,
    label,
    ...(endpoint.headers === undefined ? {} : { headers: endpoint.headers }),
    ...(endpoint.requestDefaults === undefined
      ? {}
      : { requestDefaults: endpoint.requestDefaults }),
  };
}

function resolveApiKeyCredential(
  auth: ClutchAuth,
  provider: string,
): ClutchApiKeyCredential {
  const credential = auth[provider];
  if (!hasUsableApiKey(credential)) {
    throw new Error(
      `Missing Clutch credentials for provider "${provider}". Run /config to configure credentials.`,
    );
  }
  return credential;
}
