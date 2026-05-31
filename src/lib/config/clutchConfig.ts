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

export const CLUTCH_CONFIG_DIR_ENV = "CLUTCH_CONFIG_DIR";

export const SUPPORTED_CLUTCH_LLM_PROVIDERS = [
  { id: "cerebras", label: "Cerebras" },
  { id: "openai", label: "OpenAI" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "opencode", label: "OpenCode Zen" },
  { id: "opencode-go", label: "OpenCode Go" },
] as const;

export type SupportedClutchLlmProvider =
  (typeof SUPPORTED_CLUTCH_LLM_PROVIDERS)[number]["id"];

export type ClutchModelRole = "primary" | "summarization";

export type ClutchModelSelection = {
  metadata?: Model<Api>;
  model: string;
  provider: SupportedClutchLlmProvider;
};

export type ClutchSettings = {
  models?: Partial<Record<ClutchModelRole, ClutchModelSelection>>;
};

export type ClutchApiKeyCredential = {
  key: string;
  type: "api_key";
};

export type ClutchAuth = Partial<
  Record<SupportedClutchLlmProvider, ClutchApiKeyCredential>
>;

export type ClutchConfigPaths = {
  authPath: string;
  configDir: string;
  settingsPath: string;
};

export type ResolvedConfiguredLlmModel = {
  apiKey: string;
  model: Model<Api>;
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
    hasUsableApiKey(auth[settings.models.primary.provider]) &&
    hasUsableApiKey(auth[settings.models.summarization.provider])
  );
}

export function resolveConfiguredLlmModel(
  role: ClutchModelRole,
  paths = getClutchConfigPaths(),
): ResolvedConfiguredLlmModel {
  const settings = loadClutchSettings(paths);
  const auth = loadClutchAuth(paths);
  const selection = settings.models?.[role];

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
  if (!hasUsableApiKey(credential)) {
    throw new Error(
      `Missing Clutch API key for provider "${selection.provider}". Run /config to configure credentials.`,
    );
  }

  return {
    apiKey: credential.key,
    model: selection.metadata,
  };
}

export function saveClutchConfiguration({
  apiKey,
  paths = getClutchConfigPaths(),
  primary,
  summarization,
}: {
  apiKey?: string;
  paths?: ClutchConfigPaths;
  primary: ClutchModelSelection;
  summarization: ClutchModelSelection;
}) {
  if (apiKey !== undefined) {
    saveClutchApiKey({ apiKey, paths, provider: primary.provider });
  }
  saveClutchModelConfiguration({
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
  writeJsonFile(paths.authPath, {
    ...existingAuth,
    [provider]: {
      key: normalizedApiKey,
      type: "api_key",
    },
  } satisfies ClutchAuth);
  chmodSync(paths.authPath, 0o600);
}

export function saveClutchModelConfiguration({
  paths = getClutchConfigPaths(),
  primary,
  summarization,
}: {
  paths?: ClutchConfigPaths;
  primary: ClutchModelSelection;
  summarization: ClutchModelSelection;
}) {
  assertUsableModelSelection(primary, "primary");
  assertUsableModelSelection(summarization, "summarization");

  const auth = loadClutchAuth(paths);
  assertConfiguredProviderCredential(auth, primary.provider);
  assertConfiguredProviderCredential(auth, summarization.provider);

  mkdirSync(paths.configDir, { recursive: true });
  writeJsonFile(paths.settingsPath, {
    models: {
      primary,
      summarization,
    },
  } satisfies ClutchSettings);
}

export function createDefaultClutchConfigDraft(
  paths = getClutchConfigPaths(),
): {
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

  return {
    configuredProviders: SUPPORTED_CLUTCH_LLM_PROVIDERS.map(
      (candidate) => candidate.id,
    ).filter((candidate) => hasUsableApiKey(auth[candidate])),
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
    return model;
  }

  return { model: "", provider };
}

function parseClutchSettings(raw: Record<string, unknown>): ClutchSettings {
  const models = raw.models;
  if (models === undefined) {
    return {};
  }
  if (models === null || typeof models !== "object" || Array.isArray(models)) {
    throw new Error("Clutch settings field models must be an object.");
  }

  return {
    models: parseModelSelections(models as Record<string, unknown>),
  };
}

function parseModelSelections(
  rawModels: Record<string, unknown>,
): Partial<Record<ClutchModelRole, ClutchModelSelection>> {
  return {
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
  if (typeof provider !== "string" || typeof model !== "string") {
    throw new Error(
      `Clutch ${role} model config must include provider and model strings.`,
    );
  }
  if (!isSupportedClutchProvider(provider)) {
    throw new Error(`Unsupported Clutch LLM provider: ${provider}`);
  }

  if (metadata === undefined) {
    return { model, provider };
  }

  return {
    metadata: parseModelMetadata({ metadata, modelId: model, provider, role }),
    model,
    provider,
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
    const key = (credential as Record<string, unknown>).key;
    if (type !== "api_key" || typeof key !== "string") {
      throw new Error(
        `Clutch auth credential for ${provider} must include type "api_key" and key string.`,
      );
    }
    auth[provider] = { key, type };
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
  if (!hasUsableApiKey(auth[provider])) {
    throw new Error(`Missing Clutch API key for provider "${provider}".`);
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

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
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

function hasUsableApiKey(
  credential: ClutchApiKeyCredential | undefined,
): credential is ClutchApiKeyCredential {
  return credential?.type === "api_key" && credential.key.trim().length > 0;
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
