import {
  getModel,
  getModels,
  type Api,
  type Model,
} from "@earendil-works/pi-ai";
import { Cursor, type ModelSelection, type SDKModel } from "@cursor/sdk";
import type {
  ClutchConfigPaths,
  SupportedClutchLlmProvider,
} from "./clutchConfig";
import {
  getClutchConfigPaths,
  hasUsableCredential,
  loadClutchAuth,
} from "./clutchConfig";
import { normalizeClutchModelMetadata } from "./modelMetadata";

type ProviderModelApiProfile = {
  api: Api;
  baseUrl: string;
  defaultContextWindow: number;
  defaultMaxTokens: number;
};

type FetchModelOptions = {
  cursorListModels?: (options: { apiKey?: string }) => Promise<SDKModel[]>;
  fetchImpl?: typeof fetch;
  paths?: ClutchConfigPaths;
  signal?: AbortSignal;
};

const CURSOR_AGENT_API = "cursor-agent";
const CURSOR_AGENT_BASE_URL = "cursor-sdk://agent";
const CURSOR_DEFAULT_CONTEXT_WINDOW = 128_000;
const CURSOR_DEFAULT_MAX_TOKENS = 32_000;

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
  cursor: {
    api: CURSOR_AGENT_API,
    baseUrl: CURSOR_AGENT_BASE_URL,
    defaultContextWindow: CURSOR_DEFAULT_CONTEXT_WINDOW,
    defaultMaxTokens: CURSOR_DEFAULT_MAX_TOKENS,
  },
  google: {
    api: "google-generative-ai",
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    defaultContextWindow: 1_048_576,
    defaultMaxTokens: 65_536,
  },
  openai: {
    api: "openai-responses",
    baseUrl: "https://api.openai.com/v1",
    defaultContextWindow: 128_000,
    defaultMaxTokens: 16_384,
  },
  "openai-codex": {
    api: "openai-codex-responses",
    baseUrl: "https://chatgpt.com/backend-api",
    defaultContextWindow: 128_000,
    defaultMaxTokens: 128_000,
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
  sambanova: {
    api: "openai-completions",
    baseUrl: "https://api.sambanova.ai/v1",
    defaultContextWindow: 128_000,
    defaultMaxTokens: 4_096,
  },
};

export async function fetchClutchProviderModels({
  cursorListModels = Cursor.models.list,
  fetchImpl = fetch,
  paths = getClutchConfigPaths(),
  provider,
  signal,
}: FetchModelOptions & {
  provider: SupportedClutchLlmProvider;
}): Promise<Model<Api>[]> {
  const credential = loadClutchAuth(paths)[provider];
  if (!hasUsableCredential(credential)) {
    throw new Error(
      `Missing Clutch credentials for provider "${provider}". Configure credentials before loading models.`,
    );
  }

  if (provider === "openai-codex" || provider === "google") {
    return getKnownProviderModels(provider);
  }

  if (credential.type !== "api_key") {
    throw new Error(
      `Provider "${provider}" requires a Clutch API key to load models.`,
    );
  }

  if (provider === "cursor") {
    return modelsFromCursorSdkModels(
      await cursorListModels({ apiKey: credential.key }),
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

export function modelsFromCursorSdkModels(
  sdkModels: readonly SDKModel[],
): Model<Api>[] {
  const models = sdkModels.flatMap((sdkModel) => {
    if (sdkModel.variants === undefined || sdkModel.variants.length === 0) {
      return [
        cursorModelFromSdkModel({
          idSuffix: null,
          sdkModel,
          selection: cursorModelSelectionFromSdkModel(sdkModel),
          variantName: null,
        }),
      ];
    }

    const usedSuffixes = new Set<string>();
    return sdkModel.variants.map((variant) => {
      const variantName = cursorVariantName({ sdkModel, variant });
      const idSuffix = uniqueCursorVariantSuffix({
        fallbackParams: variant.params,
        usedSuffixes,
        variantName,
      });

      return cursorModelFromSdkModel({
        idSuffix,
        sdkModel,
        selection: {
          id: sdkModel.id,
          params: variant.params,
        },
        variantName,
      });
    });
  });

  return models.sort((a, b) => a.id.localeCompare(b.id));
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
  const resolvedModel = resolvedProviderModel({ id, provider, record });
  if (resolvedModel !== undefined) {
    return resolvedModel;
  }

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
    numberField(record.max_completion_tokens) ??
    numberField(record.max_tokens) ??
    numberField(record.maxTokens) ??
    profile.defaultMaxTokens;

  return normalizeClutchModelMetadata({
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
  } as Model<Api>);
}

function resolvedProviderModel({
  id,
  provider,
  record,
}: {
  id: string;
  provider: SupportedClutchLlmProvider;
  record: Record<string, unknown>;
}): Model<Api> | undefined {
  if (provider !== "opencode" && provider !== "opencode-go") {
    return undefined;
  }

  const knownModel = getKnownProviderModel(provider, id);
  if (knownModel !== undefined) {
    return knownModel;
  }

  if (provider === "opencode" && isOpenCodeResponsesModelId(id)) {
    return openCodeResponsesModel({ id, record });
  }

  return undefined;
}

function getKnownProviderModel(
  provider: SupportedClutchLlmProvider,
  id: string,
): Model<Api> | undefined {
  const readModel = getModel as unknown as (
    provider: string,
    id: string,
  ) => Model<Api> | undefined;
  const model = readModel(provider, id);
  return model === undefined
    ? undefined
    : normalizeClutchModelMetadata({ ...model });
}

function getKnownProviderModels(
  provider: SupportedClutchLlmProvider,
): Model<Api>[] {
  const readModels = getModels as unknown as (provider: string) => Model<Api>[];
  return readModels(provider)
    .map((model) => normalizeClutchModelMetadata({ ...model }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function cursorModelFromSdkModel({
  idSuffix,
  sdkModel,
  selection,
  variantName,
}: {
  idSuffix: string | null;
  sdkModel: SDKModel;
  selection: ModelSelection;
  variantName: string | null;
}): Model<Api> {
  return {
    id: idSuffix === null ? selection.id : `${selection.id}:${idSuffix}`,
    name:
      variantName === null
        ? sdkModel.displayName
        : `${sdkModel.displayName} (${variantName})`,
    api: CURSOR_AGENT_API,
    provider: "cursor",
    baseUrl: CURSOR_AGENT_BASE_URL,
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: CURSOR_DEFAULT_CONTEXT_WINDOW,
    maxTokens: CURSOR_DEFAULT_MAX_TOKENS,
    compat: {
      cursorModelSelection: selection,
    },
  } as Model<Api>;
}

function cursorModelSelectionFromSdkModel(sdkModel: SDKModel): ModelSelection {
  const model = nestedRecord(
    (sdkModel as unknown as Record<string, unknown>).model,
  );
  if (model === undefined) {
    return { id: sdkModel.id };
  }

  const id = model.id;
  if (typeof id !== "string" || id.trim().length === 0) {
    throw new Error("Cursor SDK model selection id must be a string.");
  }

  return {
    id,
    params: parseCursorModelParams(model.params),
  };
}

function parseCursorModelParams(
  rawParams: unknown,
): ModelSelection["params"] | undefined {
  if (rawParams === undefined) {
    return undefined;
  }
  if (!Array.isArray(rawParams)) {
    throw new Error("Cursor SDK model selection params must be an array.");
  }

  return rawParams.map((param, index) => {
    if (param === null || typeof param !== "object" || Array.isArray(param)) {
      throw new Error(
        `Cursor SDK model selection params[${index}] must be an object.`,
      );
    }

    const id = (param as Record<string, unknown>).id;
    const value = (param as Record<string, unknown>).value;
    if (typeof id !== "string" || typeof value !== "string") {
      throw new Error(
        `Cursor SDK model selection params[${index}] must include id and value strings.`,
      );
    }

    return { id, value };
  });
}

function cursorVariantName({
  sdkModel,
  variant,
}: {
  sdkModel: SDKModel;
  variant: NonNullable<SDKModel["variants"]>[number];
}): string {
  const variantDisplayName = variant.displayName.trim();
  if (
    variantDisplayName.length > 0 &&
    variantDisplayName !== sdkModel.displayName.trim()
  ) {
    return variantDisplayName;
  }

  const fastParam = variant.params.find((param) => param.id === "fast");
  if (fastParam?.value === "true") {
    return "Fast";
  }
  if (fastParam?.value === "false") {
    return "Standard";
  }

  const parameterLabels = variant.params.map((param) =>
    cursorVariantParameterLabel({ param, sdkModel }),
  );
  if (parameterLabels.length > 0) {
    return parameterLabels.join(", ");
  }

  if (variantDisplayName.length === 0) {
    throw new Error("Cursor SDK model variant display name must be a string.");
  }
  return variantDisplayName;
}

function cursorVariantParameterLabel({
  param,
  sdkModel,
}: {
  param: NonNullable<ModelSelection["params"]>[number];
  sdkModel: SDKModel;
}): string {
  const parameter = sdkModel.parameters?.find(
    (candidate) => candidate.id === param.id,
  );
  const value = parameter?.values.find(
    (candidate) => candidate.value === param.value,
  );
  if (value?.displayName !== undefined && value.displayName.trim().length > 0) {
    return value.displayName;
  }

  const parameterName =
    parameter?.displayName !== undefined &&
    parameter.displayName.trim().length > 0
      ? parameter.displayName
      : param.id;
  return `${parameterName} ${param.value}`;
}

function uniqueCursorVariantSuffix({
  fallbackParams,
  usedSuffixes,
  variantName,
}: {
  fallbackParams: readonly NonNullable<ModelSelection["params"]>[number][];
  usedSuffixes: Set<string>;
  variantName: string;
}): string {
  const baseSuffix = slugFromCursorVariantLabel(variantName);
  const fallbackSuffix = slugFromCursorVariantLabel(
    fallbackParams.map((param) => `${param.id}-${param.value}`).join("-"),
  );
  let suffix = baseSuffix;
  if (usedSuffixes.has(suffix)) {
    suffix = `${baseSuffix}-${fallbackSuffix}`;
  }
  if (usedSuffixes.has(suffix)) {
    throw new Error(`Duplicate Cursor SDK model variant id suffix: ${suffix}`);
  }

  usedSuffixes.add(suffix);
  return suffix;
}

function slugFromCursorVariantLabel(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  if (slug.length === 0) {
    throw new Error("Cursor SDK model variant label must be sluggable.");
  }
  return slug;
}

function isOpenCodeResponsesModelId(id: string): boolean {
  return id.startsWith("gpt-") || id.startsWith("o");
}

function openCodeResponsesModel({
  id,
  record,
}: {
  id: string;
  record: Record<string, unknown>;
}): Model<Api> {
  return {
    id,
    name:
      id === "gpt-5.3-codex-spark"
        ? "GPT-5.3 Codex Spark"
        : typeof record.name === "string"
          ? record.name
          : titleFromModelId(id),
    api: "openai-responses",
    provider: "opencode",
    baseUrl: "https://opencode.ai/zen/v1",
    reasoning: true,
    thinkingLevelMap: { off: null, xhigh: "xhigh" },
    input: id === "gpt-5.3-codex-spark" ? ["text"] : inputModalities(record),
    cost:
      id === "gpt-5.3-codex-spark"
        ? { input: 1.75, output: 14, cacheRead: 0.175, cacheWrite: 0 }
        : providerModelCost(record),
    contextWindow: id === "gpt-5.3-codex-spark" ? 128_000 : 400_000,
    maxTokens: id === "gpt-5.3-codex-spark" ? 32_000 : 128_000,
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
  if (provider === "sambanova") {
    return isSambaNovaReasoningModelId(id);
  }
  if (provider === "openrouter") {
    return isOpenRouterReasoningModelId(id);
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
  if (
    (provider === "opencode" || provider === "opencode-go") &&
    id.toLowerCase().includes("deepseek-v4")
  ) {
    return {
      minimal: null,
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "max",
    };
  }
  if (provider === "sambanova" && isSambaNovaReasoningModelId(id)) {
    return {
      minimal: null,
      xhigh: "high",
    };
  }
  if (provider === "openrouter" && isOpenRouterReasoningModelId(id)) {
    return {
      xhigh: "high",
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
  if (
    (provider === "opencode" || provider === "opencode-go") &&
    id.toLowerCase().includes("deepseek-v4")
  ) {
    return {
      requiresReasoningContentOnAssistantMessages: true,
    } as Model<Api>["compat"];
  }
  if (provider === "sambanova") {
    return {
      supportsLongCacheRetention: false,
      supportsStore: false,
      supportsStrictMode: false,
    } as Model<Api>["compat"];
  }

  return undefined;
}

function isSambaNovaReasoningModelId(id: string): boolean {
  const normalized = id.toLowerCase();
  return (
    normalized.startsWith("deepseek-r1") ||
    normalized.startsWith("gpt-oss") ||
    normalized.startsWith("qwq-")
  );
}

function isOpenRouterReasoningModelId(id: string): boolean {
  return id.toLowerCase().startsWith("google/gemini-3");
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
