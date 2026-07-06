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
const OPENROUTER_OPENAI_REASONING_MODEL_PREFIXES = [
  "openai/gpt-5",
  "openai/o",
  "xai/grok",
] as const;
const OPENROUTER_GEMINI_REASONING_MODEL_PREFIX = "google/gemini-3";

type OpenRouterReasoning = {
  effort: string;
  exclude: true;
};

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
  const openRouterPayloadOptions = openRouterPayloadOptionsForRequest({
    effortLevel,
    model,
    serviceTier,
  });
  return {
    apiKey,
    headers,
    maxTokens: maxOutputTokensForModel(model),
    reasoning,
    ...(serviceTier === undefined || !isOpenAiResponsesPriorityModel(model)
      ? {}
      : { reasoningEffort: reasoning, serviceTier }),
    ...(openRouterPayloadOptions === undefined
      ? {}
      : { onPayload: openRouterPayloadOptions }),
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

function isOpenRouterChatCompletionsModel(model: Model<Api>): boolean {
  return model.provider === "openrouter" && model.api === "openai-completions";
}

function isOpenRouterGeminiReasoningModel(model: Model<Api>): boolean {
  return model.id
    .toLowerCase()
    .startsWith(OPENROUTER_GEMINI_REASONING_MODEL_PREFIX);
}

function isOpenRouterOpenAiReasoningModel(model: Model<Api>): boolean {
  const modelId = model.id.toLowerCase();
  return OPENROUTER_OPENAI_REASONING_MODEL_PREFIXES.some((prefix) =>
    modelId.startsWith(prefix),
  );
}

function openRouterReasoningForRequest({
  effortLevel,
  model,
}: {
  effortLevel: ClutchModelEffortLevel;
  model: Model<Api>;
}): OpenRouterReasoning | undefined {
  if (!isOpenRouterChatCompletionsModel(model)) {
    return undefined;
  }

  if (isOpenRouterGeminiReasoningModel(model)) {
    const effort =
      effortLevel === "off"
        ? "minimal"
        : mappedOpenRouterReasoningEffort({ effortLevel, model });
    return { effort, exclude: true };
  }

  if (!isOpenRouterOpenAiReasoningModel(model)) {
    return undefined;
  }

  return {
    effort:
      effortLevel === "off"
        ? "none"
        : mappedOpenRouterReasoningEffort({ effortLevel, model }),
    exclude: true,
  };
}

function mappedOpenRouterReasoningEffort({
  effortLevel,
  model,
}: {
  effortLevel: Exclude<ClutchModelEffortLevel, "off">;
  model: Model<Api>;
}): string {
  const effort = model.thinkingLevelMap?.[effortLevel] ?? effortLevel;
  if (effort === null) {
    throw new Error(
      `OpenRouter model ${model.id} cannot use effort level ${effortLevel}.`,
    );
  }
  return effort;
}

function openRouterPayloadOptionsForRequest({
  effortLevel,
  model,
  serviceTier,
}: {
  effortLevel: ClutchModelEffortLevel;
  model: Model<Api>;
  serviceTier: typeof PRIORITY_SERVICE_TIER | undefined;
}): ProviderStreamOptions["onPayload"] | undefined {
  if (!isOpenRouterChatCompletionsModel(model)) {
    return undefined;
  }

  const reasoning = openRouterReasoningForRequest({ effortLevel, model });
  const shouldSetPriorityServiceTier =
    serviceTier !== undefined && isOpenRouterPriorityModel(model);
  if (reasoning === undefined && !shouldSetPriorityServiceTier) {
    return undefined;
  }

  return (payload) =>
    withOpenRouterPayloadOptions({
      payload,
      reasoning,
      serviceTier: shouldSetPriorityServiceTier ? serviceTier : undefined,
    });
}

function withOpenRouterPayloadOptions({
  payload,
  reasoning,
  serviceTier,
}: {
  payload: unknown;
  reasoning: OpenRouterReasoning | undefined;
  serviceTier: typeof PRIORITY_SERVICE_TIER | undefined;
}): unknown {
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
    ...(reasoning === undefined ? {} : { reasoning }),
    ...(serviceTier === undefined ? {} : { service_tier: serviceTier }),
  };
}
