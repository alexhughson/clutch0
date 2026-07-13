import type {
  ClutchModelEffortLevel,
  ClutchModelServiceTier,
} from "../config/clutchConfigSchemas";
import type { ResolvedConfiguredLlmRequest } from "../config/clutchConfig";
import type { LlmModel } from "./types";
import type { LlmRequestOptions } from "./llmProgram";

const CEREBRAS_MAX_OUTPUT_TOKENS = 4_096;
const PRIORITY_SERVICE_TIER = "priority";
const OPENROUTER_PRIORITY_MODEL_PREFIXES = [
  "anthropic/",
  "google/",
  "openai/",
] as const;

export type ConfiguredLlmRequestOptions = LlmRequestOptions;

export function maxOutputTokensForModel(model: LlmModel): number | undefined {
  if (model.provider === "cerebras") {
    return Math.min(model.maxTokens, CEREBRAS_MAX_OUTPUT_TOKENS);
  }
  return undefined;
}

export function reasoningForEffortLevel(
  effortLevel: ClutchModelEffortLevel,
): LlmRequestOptions["reasoning"] {
  return effortLevel === "off" ? undefined : effortLevel;
}

export function serviceTierForRequest({
  model,
  serviceTier,
}: {
  model: LlmModel;
  serviceTier: ClutchModelServiceTier;
}): typeof PRIORITY_SERVICE_TIER | undefined {
  if (serviceTier === "default") return undefined;
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
  const serviceTier = serviceTierForRequest({
    model,
    serviceTier: configuredServiceTier,
  });
  return {
    apiKey,
    effortLevel,
    headers,
    maxTokens: maxOutputTokensForModel(model),
    reasoning: reasoningForEffortLevel(effortLevel),
    ...(serviceTier === undefined || !isOpenAiResponsesPriorityModel(model)
      ? {}
      : { reasoningEffort: reasoningForEffortLevel(effortLevel), serviceTier }),
    ...(serviceTier === undefined || isOpenAiResponsesPriorityModel(model)
      ? {}
      : { serviceTier }),
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
