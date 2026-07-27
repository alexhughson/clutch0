import { Type } from "@sinclair/typebox";
import type { Static } from "@sinclair/typebox";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { OAuthCredentials } from "@earendil-works/pi-ai/oauth";
import { decodeSchema } from "../schemaDecode";

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

const PositiveNumber = Type.Number({ exclusiveMinimum: 0 });

const ModelCostSchema = Type.Object({
  cacheRead: Type.Number(),
  cacheWrite: Type.Number(),
  input: Type.Number(),
  output: Type.Number(),
});

export const ModelMetadataSchema = Type.Object({
  api: Type.String({ minLength: 1 }),
  baseUrl: Type.String({ minLength: 1 }),
  contextWindow: PositiveNumber,
  cost: ModelCostSchema,
  id: Type.String({ minLength: 1 }),
  input: Type.Array(Type.String()),
  maxTokens: PositiveNumber,
  name: Type.String({ minLength: 1 }),
  provider: Type.String({ minLength: 1 }),
  reasoning: Type.Boolean(),
});

const ClutchModelEffortLevelSchema = Type.Union(
  CLUTCH_MODEL_EFFORT_LEVELS.map((level) => Type.Literal(level)),
);

const ClutchModelServiceTierSchema = Type.Union(
  CLUTCH_MODEL_SERVICE_TIERS.map((tier) => Type.Literal(tier)),
);

const RawModelSelectionSchema = Type.Object({
  effortLevel: Type.Optional(ClutchModelEffortLevelSchema),
  metadata: Type.Optional(ModelMetadataSchema),
  model: Type.String(),
  provider: Type.String(),
  serviceTier: Type.Optional(ClutchModelServiceTierSchema),
});

const RawModelSelectionsSchema = Type.Object({
  agent: Type.Optional(RawModelSelectionSchema),
  primary: Type.Optional(RawModelSelectionSchema),
  summarization: Type.Optional(RawModelSelectionSchema),
});

export const AgentBackendConfigSchema = Type.Object({
  args: Type.Optional(Type.Array(Type.String())),
  command: Type.String(),
  env: Type.Optional(Type.Record(Type.String(), Type.String())),
});

export const ClutchSettingsSchema = Type.Object({
  agentBackend: Type.Optional(AgentBackendConfigSchema),
  models: Type.Optional(RawModelSelectionsSchema),
});

const ApiKeyCredentialSchema = Type.Object({
  key: Type.String(),
  type: Type.Literal("api_key"),
});

const OAuthCredentialFieldsSchema = Type.Object({
  access: Type.String(),
  expires: Type.Number(),
  refresh: Type.String(),
});

export type ClutchModelSelection = {
  effortLevel?: ClutchModelEffortLevel;
  metadata?: Model<Api>;
  model: string;
  provider: SupportedClutchLlmProvider;
  serviceTier?: ClutchModelServiceTier;
};

export type ClutchSettings = {
  agentBackend?: Static<typeof AgentBackendConfigSchema>;
  models?: Partial<Record<ClutchModelRole, ClutchModelSelection>>;
};

export type ClutchAgentBackendConfig = Static<typeof AgentBackendConfigSchema>;

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

export function decodeClutchSettings(
  snapshot: unknown,
  label = "Clutch settings",
): ClutchSettings {
  const decoded = decodeSchema<Static<typeof ClutchSettingsSchema>>(
    ClutchSettingsSchema,
    snapshot,
    label,
  );

  return {
    ...(decoded.agentBackend === undefined
      ? {}
      : {
          agentBackend: normalizeAgentBackendConfig(
            decoded.agentBackend,
            `${label}.agentBackend`,
          ),
        }),
    ...(decoded.models === undefined
      ? {}
      : { models: decodeModelSelections(decoded.models) }),
  };
}

export function decodeClutchAuth(
  snapshot: unknown,
  label = "Clutch auth",
): ClutchAuth {
  const decoded = decodeSchema<Record<string, unknown>>(
    Type.Record(Type.String(), Type.Unknown()),
    snapshot,
    label,
  );

  const auth: ClutchAuth = {};
  for (const [provider, credential] of Object.entries(decoded)) {
    if (!isSupportedClutchProvider(provider)) {
      continue;
    }

    auth[provider] = decodeClutchCredential(
      credential,
      `${label} credential for ${provider}`,
      provider,
    );
  }

  return auth;
}

function decodeModelSelections(
  rawModels: Static<typeof RawModelSelectionsSchema>,
): Partial<Record<ClutchModelRole, ClutchModelSelection>> {
  return {
    agent: decodeModelSelection(rawModels.agent, "agent"),
    primary: decodeModelSelection(rawModels.primary, "primary"),
    summarization: decodeModelSelection(
      rawModels.summarization,
      "summarization",
    ),
  };
}

function decodeModelSelection(
  raw: Static<typeof RawModelSelectionSchema> | undefined,
  role: ClutchModelRole,
): ClutchModelSelection | undefined {
  if (raw === undefined) {
    return undefined;
  }

  if (!isSupportedClutchProvider(raw.provider)) {
    throw new Error(`Unsupported Clutch LLM provider: ${raw.provider}`);
  }

  const provider = raw.provider;
  const metadata =
    raw.metadata === undefined
      ? undefined
      : parseModelMetadata({
          metadata: raw.metadata,
          modelId: raw.model,
          provider,
          role,
        });

  return {
    effortLevel: raw.effortLevel,
    ...(metadata === undefined ? {} : { metadata }),
    model: raw.model,
    provider,
    serviceTier: raw.serviceTier,
  };
}

export function normalizeAgentBackendConfig(
  backend: ClutchAgentBackendConfig,
  label = "Clutch agentBackend",
): ClutchAgentBackendConfig {
  if (backend.command.trim().length === 0) {
    throw new Error(`${label}.command must be a non-empty string.`);
  }

  return {
    ...(backend.args === undefined ? {} : { args: backend.args }),
    command: backend.command,
    ...(backend.env === undefined ? {} : { env: backend.env }),
  };
}

function decodeClutchCredential(
  credential: unknown,
  label: string,
  provider: SupportedClutchLlmProvider,
): ClutchCredential {
  if (
    credential === null ||
    typeof credential !== "object" ||
    Array.isArray(credential)
  ) {
    throw new Error(`${label} must be an object.`);
  }

  const type = (credential as Record<string, unknown>).type;
  if (type === "api_key") {
    const decoded = decodeSchema<Static<typeof ApiKeyCredentialSchema>>(
      ApiKeyCredentialSchema,
      credential,
      label,
    );
    return { key: decoded.key, type: "api_key" };
  }
  if (type === "oauth") {
    return parseOAuthCredential(provider, credential);
  }

  throw new Error(`${label} must include type "api_key" or "oauth".`);
}

function parseModelMetadata({
  metadata,
  modelId,
  provider,
  role,
}: {
  metadata: Static<typeof ModelMetadataSchema>;
  modelId: string;
  provider: SupportedClutchLlmProvider;
  role: ClutchModelRole;
}): Model<Api> {
  if (metadata.id !== modelId) {
    throw new Error(`Clutch ${role} model metadata id must match model.`);
  }
  if (metadata.provider !== provider) {
    throw new Error(
      `Clutch ${role} model metadata provider must match provider.`,
    );
  }

  return metadata as unknown as Model<Api>;
}

function parseOAuthCredential(
  provider: SupportedClutchLlmProvider,
  credential: object,
): ClutchOAuthCredential {
  assertOAuthProvider(provider);

  const raw = credential as Record<string, unknown>;
  const fields = decodeSchema<Static<typeof OAuthCredentialFieldsSchema>>(
    OAuthCredentialFieldsSchema,
    credential,
    `Clutch auth credential for ${provider} with type "oauth"`,
  );

  return {
    ...(raw as OAuthCredentials),
    access: fields.access,
    expires: fields.expires,
    refresh: fields.refresh,
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

export function isSupportedClutchProvider(
  provider: string,
): provider is SupportedClutchLlmProvider {
  return SUPPORTED_CLUTCH_LLM_PROVIDERS.some(
    (candidate) => candidate.id === provider,
  );
}
