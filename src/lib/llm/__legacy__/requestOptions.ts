// Vendored from git c0d4316:src/lib/llm/requestOptions.ts (test-only baseline).
// Edits beyond import paths: none.

import type {
  ClutchModelEffortLevel,
  ClutchModelServiceTier,
} from "../../config/clutchConfigSchemas";
import type { ResolvedConfiguredLlmRequest } from "../../config/clutchConfig";
import type { LlmModel, LlmThinkingLevel } from "../types";

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

export type ConfiguredLlmRequestOptions = {
  apiKey: string;
  headers?: Record<string, string>;
  maxTokens?: number;
  onPayload?: (
    payload: unknown,
    model: LlmModel,
  ) => unknown | undefined | Promise<unknown | undefined>;
  reasoning?: LlmThinkingLevel;
  reasoningEffort?: LlmThinkingLevel;
  serviceTier?: typeof PRIORITY_SERVICE_TIER;
  signal?: AbortSignal;
};

export function maxOutputTokensForModel(model: LlmModel): number | undefined {
  if (model.provider === "cerebras") {
    return Math.min(model.maxTokens, CEREBRAS_MAX_OUTPUT_TOKENS);
  }

  return undefined;
}

export function reasoningForEffortLevel(
  effortLevel: ClutchModelEffortLevel,
): LlmThinkingLevel | undefined {
  return effortLevel === "off" ? undefined : effortLevel;
}

export function serviceTierForRequest({
  model,
  serviceTier,
}: {
  model: LlmModel;
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
  model: LlmModel;
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

function isOpenAiResponsesPriorityModel(model: LlmModel): boolean {
  return model.provider === "openai" && model.api === "openai-responses";
}

function isOpenRouterPriorityModel(model: LlmModel): boolean {
  return (
    model.provider === "openrouter" &&
    model.api === "openai-completions" &&
    OPENROUTER_PRIORITY_MODEL_PREFIXES.some((prefix) =>
      model.id.startsWith(prefix),
    )
  );
}

function isOpenRouterChatCompletionsModel(model: LlmModel): boolean {
  return model.provider === "openrouter" && model.api === "openai-completions";
}

function isOpenRouterGeminiReasoningModel(model: LlmModel): boolean {
  return model.id
    .toLowerCase()
    .startsWith(OPENROUTER_GEMINI_REASONING_MODEL_PREFIX);
}

function isOpenRouterOpenAiReasoningModel(model: LlmModel): boolean {
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
  model: LlmModel;
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
  model: LlmModel;
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
  model: LlmModel;
  serviceTier: typeof PRIORITY_SERVICE_TIER | undefined;
}): ConfiguredLlmRequestOptions["onPayload"] | undefined {
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
