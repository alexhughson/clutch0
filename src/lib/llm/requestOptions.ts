import type {
  Api,
  Model,
  ProviderStreamOptions,
  SimpleStreamOptions,
  ThinkingLevel,
} from "@earendil-works/pi-ai";
import type {
  ClutchModelEffortLevel,
  ClutchModelServiceTier,
  ResolvedConfiguredLlmRequest,
} from "../config/clutchConfig";

const CEREBRAS_MAX_OUTPUT_TOKENS = 4_096;
const PRIORITY_SERVICE_TIER = "priority";
const OPENROUTER_PRIORITY_MODEL_PREFIXES = [
  "anthropic/",
  "google/",
  "openai/",
] as const;

type ConfiguredLlmRequestOptions = SimpleStreamOptions &
  ProviderStreamOptions & {
    reasoningEffort?: ThinkingLevel;
    serviceTier?: typeof PRIORITY_SERVICE_TIER;
  };

export function maxOutputTokensForModel(model: Model<Api>): number | undefined {
  if (model.provider === "cerebras") {
    return Math.min(model.maxTokens, CEREBRAS_MAX_OUTPUT_TOKENS);
  }

  return undefined;
}

export function reasoningForEffortLevel(
  effortLevel: ClutchModelEffortLevel,
): ThinkingLevel | undefined {
  return effortLevel === "off" ? undefined : effortLevel;
}

export function serviceTierForRequest({
  model,
  serviceTier,
}: {
  model: Model<Api>;
  serviceTier: ClutchModelServiceTier;
}): typeof PRIORITY_SERVICE_TIER | undefined {
  if (serviceTier === "default") {
    return undefined;
  }

  if (
    isOpenAiResponsesPriorityModel(model) ||
    isOpenRouterPriorityModel(model)
  ) {
    return PRIORITY_SERVICE_TIER;
  }

  throw new Error(
    `Priority service tier is only supported for OpenAI Responses models and OpenRouter ${OPENROUTER_PRIORITY_MODEL_PREFIXES.join(", ")} model IDs. ${model.provider}/${model.id} uses ${model.api}.`,
  );
}

export function usesProviderSpecificRequestOptions({
  model,
  serviceTier,
}: {
  model: Model<Api>;
  serviceTier: ClutchModelServiceTier;
}): boolean {
  return (
    serviceTier === PRIORITY_SERVICE_TIER &&
    isOpenAiResponsesPriorityModel(model)
  );
}

export function configuredLlmRequestOptions({
  apiKey,
  effortLevel,
  headers,
  model,
  serviceTier: configuredServiceTier,
  signal,
}: ResolvedConfiguredLlmRequest & {
  signal?: AbortSignal;
}): ConfiguredLlmRequestOptions {
  const reasoning = reasoningForEffortLevel(effortLevel);
  const serviceTier = serviceTierForRequest({
    model,
    serviceTier: configuredServiceTier,
  });
  return {
    apiKey,
    headers,
    maxTokens: maxOutputTokensForModel(model),
    reasoning,
    ...(serviceTier === undefined || !isOpenAiResponsesPriorityModel(model)
      ? {}
      : { reasoningEffort: reasoning, serviceTier }),
    ...(serviceTier === undefined || !isOpenRouterPriorityModel(model)
      ? {}
      : { onPayload: withOpenRouterPriorityServiceTier }),
    signal,
  };
}

function isOpenAiResponsesPriorityModel(model: Model<Api>): boolean {
  return model.provider === "openai" && model.api === "openai-responses";
}

function isOpenRouterPriorityModel(model: Model<Api>): boolean {
  return (
    model.provider === "openrouter" &&
    model.api === "openai-completions" &&
    OPENROUTER_PRIORITY_MODEL_PREFIXES.some((prefix) =>
      model.id.startsWith(prefix),
    )
  );
}

function withOpenRouterPriorityServiceTier(payload: unknown): unknown {
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    throw new Error(
      "OpenRouter chat-completions payload must be an object to set priority service tier.",
    );
  }

  return {
    ...payload,
    service_tier: PRIORITY_SERVICE_TIER,
  };
}
