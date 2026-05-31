import type { Api, Model } from "@earendil-works/pi-ai";
import type {
  ClutchConfigPaths,
  SupportedClutchLlmProvider,
} from "./clutchConfig";
import { getClutchConfigPaths, loadClutchAuth } from "./clutchConfig";

type ProviderModelApiProfile = {
  api: Api;
  baseUrl: string;
  defaultContextWindow: number;
  defaultMaxTokens: number;
};

type FetchModelOptions = {
  fetchImpl?: typeof fetch;
  paths?: ClutchConfigPaths;
  signal?: AbortSignal;
};

const PROVIDER_MODEL_API_PROFILES: Record<
  SupportedClutchLlmProvider,
  ProviderModelApiProfile
> = {
  cerebras: {
    api: "openai-completions",
    baseUrl: "https://api.cerebras.ai/v1",
    defaultContextWindow: 128_000,
    defaultMaxTokens: 4_096,
  },
  openai: {
    api: "openai-responses",
    baseUrl: "https://api.openai.com/v1",
    defaultContextWindow: 128_000,
    defaultMaxTokens: 16_384,
  },
  openrouter: {
    api: "openai-completions",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultContextWindow: 128_000,
    defaultMaxTokens: 32_000,
  },
  opencode: {
    api: "openai-completions",
    baseUrl: "https://opencode.ai/zen/v1",
    defaultContextWindow: 200_000,
    defaultMaxTokens: 128_000,
  },
  "opencode-go": {
    api: "openai-completions",
    baseUrl: "https://opencode.ai/zen/go/v1",
    defaultContextWindow: 1_000_000,
    defaultMaxTokens: 384_000,
  },
};

export async function fetchClutchProviderModels({
  fetchImpl = fetch,
  paths = getClutchConfigPaths(),
  provider,
  signal,
}: FetchModelOptions & {
  provider: SupportedClutchLlmProvider;
}): Promise<Model<Api>[]> {
  const credential = loadClutchAuth(paths)[provider];
  if (credential?.type !== "api_key" || credential.key.trim().length === 0) {
    throw new Error(
      `Missing Clutch API key for provider "${provider}". Configure credentials before loading models.`,
    );
  }

  const profile = providerModelApiProfile(provider);
  const response = await fetchImpl(`${profile.baseUrl}/models`, {
    headers: {
      accept: "application/json",
      authorization: `Bearer ${credential.key}`,
    },
    signal,
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(
      `Could not load ${provider} models: HTTP ${response.status}${body.trim().length === 0 ? "" : ` ${body.trim().slice(0, 300)}`}`,
    );
  }

  return modelsFromProviderResponse({
    provider,
    responseJson: await response.json(),
  });
}

export function modelsFromProviderResponse({
  provider,
  responseJson,
}: {
  provider: SupportedClutchLlmProvider;
  responseJson: unknown;
}): Model<Api>[] {
  if (
    responseJson === null ||
    typeof responseJson !== "object" ||
    Array.isArray(responseJson)
  ) {
    throw new Error(`${provider} models response must be a JSON object.`);
  }

  const data = (responseJson as Record<string, unknown>).data;
  if (!Array.isArray(data)) {
    throw new Error(`${provider} models response must include a data array.`);
  }

  const modelsById = new Map<string, Model<Api>>();
  for (const [index, item] of data.entries()) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      throw new Error(`${provider} models data[${index}] must be an object.`);
    }

    const id = (item as Record<string, unknown>).id;
    if (typeof id !== "string" || id.trim().length === 0) {
      throw new Error(`${provider} models data[${index}].id must be a string.`);
    }

    modelsById.set(
      id,
      modelFromProviderModelRecord({
        provider,
        record: item as Record<string, unknown>,
      }),
    );
  }

  return [...modelsById.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function providerModelApiProfile(
  provider: SupportedClutchLlmProvider,
): ProviderModelApiProfile {
  const profile = PROVIDER_MODEL_API_PROFILES[provider];
  if (profile === undefined) {
    throw new Error(`Unsupported Clutch LLM provider: ${provider}`);
  }
  return profile;
}

function modelFromProviderModelRecord({
  provider,
  record,
}: {
  provider: SupportedClutchLlmProvider;
  record: Record<string, unknown>;
}): Model<Api> {
  const id = record.id as string;
  const profile = providerModelApiProfile(provider);
  const name =
    typeof record.name === "string" ? record.name : titleFromModelId(id);
  const contextWindow =
    numberField(record.context_length) ??
    numberField(record.contextWindow) ??
    numberField(nestedRecord(record.top_provider)?.context_length) ??
    profile.defaultContextWindow;
  const maxTokens =
    numberField(nestedRecord(record.top_provider)?.max_completion_tokens) ??
    numberField(record.max_tokens) ??
    numberField(record.maxTokens) ??
    profile.defaultMaxTokens;

  return {
    id,
    name,
    api: profile.api,
    provider,
    baseUrl: profile.baseUrl,
    reasoning: defaultReasoning({ id, provider }),
    thinkingLevelMap: defaultThinkingLevelMap({ id, provider }),
    input: inputModalities(record),
    cost: providerModelCost(record),
    contextWindow,
    maxTokens,
    compat: defaultCompat({ id, provider }),
  } as Model<Api>;
}

function inputModalities(
  record: Record<string, unknown>,
): ("image" | "text")[] {
  const architecture = nestedRecord(record.architecture);
  const inputModalities = architecture?.input_modalities;
  if (!Array.isArray(inputModalities)) {
    return ["text"];
  }

  const input = new Set<"image" | "text">(["text"]);
  if (inputModalities.includes("image")) {
    input.add("image");
  }
  return [...input];
}

function providerModelCost(
  record: Record<string, unknown>,
): Model<Api>["cost"] {
  const pricing = nestedRecord(record.pricing);
  return {
    input: pricePerMillionTokens(pricing?.prompt),
    output: pricePerMillionTokens(pricing?.completion),
    cacheRead: pricePerMillionTokens(pricing?.input_cache_read),
    cacheWrite: pricePerMillionTokens(pricing?.input_cache_write),
  };
}

function defaultReasoning({
  id,
  provider,
}: {
  id: string;
  provider: SupportedClutchLlmProvider;
}): boolean {
  if (provider === "opencode" || provider === "opencode-go") {
    return true;
  }

  return id.startsWith("o") || id.startsWith("gpt-5");
}

function defaultThinkingLevelMap({
  id,
  provider,
}: {
  id: string;
  provider: SupportedClutchLlmProvider;
}): Model<Api>["thinkingLevelMap"] {
  if (provider === "opencode-go" && id.includes("deepseek")) {
    return {
      minimal: null,
      low: null,
      medium: null,
      high: "high",
      xhigh: "max",
    };
  }

  return undefined;
}

function defaultCompat({
  id,
  provider,
}: {
  id: string;
  provider: SupportedClutchLlmProvider;
}): Model<Api>["compat"] {
  if (provider === "opencode-go" && id.includes("deepseek")) {
    return {
      requiresReasoningContentOnAssistantMessages: true,
      thinkingFormat: "deepseek",
    } as Model<Api>["compat"];
  }

  return undefined;
}

function titleFromModelId(id: string): string {
  return id
    .split("/")
    .at(-1)!
    .replace(/[._-]+/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function numberField(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return undefined;
  }

  return value;
}

function pricePerMillionTokens(value: unknown): number {
  if (typeof value !== "string" && typeof value !== "number") {
    return 0;
  }

  const price = Number(value);
  if (!Number.isFinite(price) || price < 0) {
    return 0;
  }

  return price * 1_000_000;
}

function nestedRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  return value as Record<string, unknown>;
}
