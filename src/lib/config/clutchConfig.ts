import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "fs";
import { homedir } from "os";
import { join } from "path";
import {
  getModels,
  type Api,
  type KnownProvider,
  type Model,
} from "@earendil-works/pi-ai";

export const CLUTCH_CONFIG_DIR_ENV = "CLUTCH_CONFIG_DIR";

export const SUPPORTED_CLUTCH_LLM_PROVIDERS = [
  { id: "openai", label: "OpenAI" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "opencode", label: "OpenCode Zen" },
  { id: "opencode-go", label: "OpenCode Go" },
] as const;

export type SupportedClutchLlmProvider =
  (typeof SUPPORTED_CLUTCH_LLM_PROVIDERS)[number]["id"];

export type ClutchModelRole = "primary" | "summarization";

export type ClutchModelSelection = {
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

const PREFERRED_MODELS: Record<
  SupportedClutchLlmProvider,
  Partial<Record<ClutchModelRole, string>>
> = {
  openai: {
    primary: "gpt-5",
    summarization: "gpt-4.1-mini",
  },
  openrouter: {
    primary: "anthropic/claude-sonnet-4.5",
    summarization: "openai/gpt-4.1-mini",
  },
  opencode: {
    primary: "claude-sonnet-4-5",
    summarization: "gemini-3-flash",
  },
  "opencode-go": {
    primary: "kimi-k2.6",
    summarization: "deepseek-v4-flash",
  },
};

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

export function getClutchModelOptions(
  provider: SupportedClutchLlmProvider,
): Model<Api>[] {
  return getModels(provider as KnownProvider) as Model<Api>[];
}

export function getDefaultClutchModelId({
  provider,
  role,
}: {
  provider: SupportedClutchLlmProvider;
  role: ClutchModelRole;
}): string {
  const models = getClutchModelOptions(provider);
  const preferredModel = PREFERRED_MODELS[provider][role];
  if (
    preferredModel !== undefined &&
    models.some((model) => model.id === preferredModel)
  ) {
    return preferredModel;
  }

  const firstModel = models[0];
  if (firstModel === undefined) {
    throw new Error(`No models are registered for provider: ${provider}`);
  }
  return firstModel.id;
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

  const model = getClutchModelOptions(selection.provider).find(
    (candidate) => candidate.id === selection.model,
  );
  if (model === undefined) {
    throw new Error(
      `Unknown Clutch ${role} model "${selection.model}" for provider "${selection.provider}". Run /config to choose a supported model.`,
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
    model,
  };
}

export function saveClutchConfiguration({
  apiKey,
  paths = getClutchConfigPaths(),
  primaryModel,
  provider,
  summarizationModel,
}: {
  apiKey?: string;
  paths?: ClutchConfigPaths;
  primaryModel: string;
  provider: SupportedClutchLlmProvider;
  summarizationModel: string;
}) {
  if (apiKey !== undefined) {
    saveClutchApiKey({ apiKey, paths, provider });
  }
  saveClutchModelConfiguration({
    paths,
    primary: { model: primaryModel, provider },
    summarization: { model: summarizationModel, provider },
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
  assertKnownModel({
    modelId: primary.model,
    provider: primary.provider,
    role: "primary",
  });
  assertKnownModel({
    modelId: summarization.model,
    provider: summarization.provider,
    role: "summarization",
  });

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
    primary: {
      model: getExistingOrDefaultModel({
        model: settings.models?.primary,
        provider: primaryProvider,
        role: "primary",
      }),
      provider: primaryProvider,
    },
    summarization: {
      model: getExistingOrDefaultModel({
        model: settings.models?.summarization,
        provider: summarizationProvider,
        role: "summarization",
      }),
      provider: summarizationProvider,
    },
  };
}

function getExistingOrDefaultModel({
  model,
  provider,
  role,
}: {
  model?: ClutchModelSelection;
  provider: SupportedClutchLlmProvider;
  role: ClutchModelRole;
}): string {
  if (model?.provider === provider) {
    assertKnownModel({ modelId: model.model, provider, role });
    return model.model;
  }

  return getDefaultClutchModelId({ provider, role });
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
  if (typeof provider !== "string" || typeof model !== "string") {
    throw new Error(
      `Clutch ${role} model config must include provider and model strings.`,
    );
  }
  if (!isSupportedClutchProvider(provider)) {
    throw new Error(`Unsupported Clutch LLM provider: ${provider}`);
  }

  assertKnownModel({ modelId: model, provider, role });
  return { model, provider };
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

function assertKnownModel({
  modelId,
  provider,
  role,
}: {
  modelId: string;
  provider: SupportedClutchLlmProvider;
  role: ClutchModelRole;
}) {
  if (!getClutchModelOptions(provider).some((model) => model.id === modelId)) {
    throw new Error(
      `Unknown Clutch ${role} model "${modelId}" for provider "${provider}".`,
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
