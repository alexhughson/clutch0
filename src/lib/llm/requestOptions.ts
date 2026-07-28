import type {
  ClutchModelEffortLevel,
  OpenRouterOptions,
  ResolvedConfiguredLlmRequest,
} from "../config/clutchConfig";
import type { LlmModel, LlmThinkingLevel } from "./types";

const CLUTCH_PAYLOAD_KEYS = [
  "max_tokens",
  "messages",
  "model",
  "stream",
  "tools",
] as const;

type OpenRouterReasoning = {
  effort: string;
  exclude: true;
};

export type ConfiguredLlmRequestOptions = {
  apiKey: string;
  headers?: Record<string, string>;
  onPayload?: (
    payload: unknown,
    model: LlmModel,
  ) => unknown | undefined | Promise<unknown | undefined>;
  reasoning?: LlmThinkingLevel;
  signal?: AbortSignal;
};

export function reasoningForEffortLevel(
  effortLevel: ClutchModelEffortLevel,
): LlmThinkingLevel | undefined {
  return effortLevel === "off" ? undefined : effortLevel;
}

export function configuredLlmRequestOptions({
  apiKey,
  effortLevel,
  headers,
  model,
  openRouter,
  requestDefaults,
  signal,
}: ResolvedConfiguredLlmRequest & {
  signal?: AbortSignal;
}): ConfiguredLlmRequestOptions {
  const reasoning = reasoningForEffortLevel(effortLevel);
  const onPayload = buildConfiguredPayloadHandler({
    effortLevel,
    model,
    openRouter,
    requestDefaults,
  });

  return {
    apiKey,
    headers,
    reasoning,
    ...(onPayload === undefined ? {} : { onPayload }),
    signal,
  };
}

function buildConfiguredPayloadHandler({
  effortLevel,
  model,
  openRouter,
  requestDefaults,
}: {
  effortLevel: ClutchModelEffortLevel;
  model: LlmModel;
  openRouter?: OpenRouterOptions;
  requestDefaults?: Record<string, unknown>;
}): ConfiguredLlmRequestOptions["onPayload"] | undefined {
  const handlers: NonNullable<ConfiguredLlmRequestOptions["onPayload"]>[] = [];

  if (requestDefaults !== undefined) {
    handlers.push((payload) => mergeRequestDefaults(payload, requestDefaults));
  }

  if (model.provider === "openrouter" && openRouter !== undefined) {
    const openRouterHandler = openRouterPayloadHandler({
      effortLevel,
      model,
      openRouter,
    });
    if (openRouterHandler !== undefined) {
      handlers.push(openRouterHandler);
    }
  }

  if (handlers.length === 0) {
    return undefined;
  }

  return (payload, currentModel) => {
    let nextPayload = payload;
    for (const handler of handlers) {
      const result = handler(nextPayload, currentModel);
      if (result !== undefined) {
        nextPayload = result;
      }
    }
    return nextPayload;
  };
}

function mergeRequestDefaults(
  payload: unknown,
  requestDefaults: Record<string, unknown>,
): unknown {
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    throw new Error(
      "Custom endpoint payload must be an object to merge request defaults.",
    );
  }

  const payloadRecord = payload as Record<string, unknown>;
  const clutchOverrides = Object.fromEntries(
    CLUTCH_PAYLOAD_KEYS.filter((key) => payloadRecord[key] !== undefined).map(
      (key) => [key, payloadRecord[key]],
    ),
  );

  return {
    ...requestDefaults,
    ...payloadRecord,
    ...clutchOverrides,
  };
}

function openRouterPayloadHandler({
  effortLevel,
  model,
  openRouter,
}: {
  effortLevel: ClutchModelEffortLevel;
  model: LlmModel;
  openRouter: OpenRouterOptions;
}): ConfiguredLlmRequestOptions["onPayload"] | undefined {
  const provider = buildOpenRouterProviderObject(openRouter);
  const serviceTier = openRouterServiceTierForRequest(openRouter);
  const reasoning = openRouterReasoningForRequest({
    effortLevel,
    model,
    openRouter,
  });

  if (
    provider === undefined &&
    serviceTier === undefined &&
    reasoning === undefined
  ) {
    return undefined;
  }

  return (payload) =>
    withOpenRouterPayloadOptions({
      payload,
      provider,
      reasoning,
      serviceTier,
    });
}

function buildOpenRouterProviderObject(
  openRouter: OpenRouterOptions,
): Record<string, unknown> | undefined {
  const provider: Record<string, unknown> = {
    ...(openRouter.providerExtras ?? {}),
  };

  if (openRouter.vendor !== undefined) {
    provider.only = [openRouter.vendor];
    provider.allow_fallbacks = openRouter.allowFallbacks !== false;
  }

  if (openRouter.sort !== undefined) {
    provider.sort = openRouter.sort;
  }

  return Object.keys(provider).length === 0 ? undefined : provider;
}

function openRouterServiceTierForRequest(
  openRouter: OpenRouterOptions,
): "flex" | "priority" | undefined {
  const serviceTier = openRouter.serviceTier ?? "default";
  if (serviceTier === "default") {
    return undefined;
  }

  if (!openRouter.capabilities?.serviceTiers.includes(serviceTier)) {
    throw new Error(
      `OpenRouter service tier "${serviceTier}" is not in capabilities.serviceTiers.`,
    );
  }

  return serviceTier;
}

function openRouterReasoningForRequest({
  effortLevel,
  model,
  openRouter,
}: {
  effortLevel: ClutchModelEffortLevel;
  model: LlmModel;
  openRouter: OpenRouterOptions;
}): OpenRouterReasoning | undefined {
  if (openRouter.capabilities?.supportsReasoning !== true) {
    return undefined;
  }

  const effort =
    effortLevel === "off"
      ? lowestOpenRouterReasoningEffort(model)
      : mappedOpenRouterReasoningEffort({
          effortLevel,
          model,
        });

  return { effort, exclude: true };
}

function lowestOpenRouterReasoningEffort(model: LlmModel): string {
  const modelId = model.id.toLowerCase();
  if (modelId.startsWith("google/gemini-3")) {
    return "minimal";
  }
  return "none";
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

function withOpenRouterPayloadOptions({
  payload,
  provider,
  reasoning,
  serviceTier,
}: {
  payload: unknown;
  provider: Record<string, unknown> | undefined;
  reasoning: OpenRouterReasoning | undefined;
  serviceTier: "flex" | "priority" | undefined;
}): unknown {
  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    throw new Error(
      "OpenRouter chat-completions payload must be an object to apply OpenRouter options.",
    );
  }

  const payloadRecord = payload as Record<string, unknown>;
  const mergedProvider =
    provider === undefined
      ? payloadRecord.provider
      : {
          ...(typeof payloadRecord.provider === "object" &&
          payloadRecord.provider !== null &&
          !Array.isArray(payloadRecord.provider)
            ? (payloadRecord.provider as Record<string, unknown>)
            : {}),
          ...provider,
        };

  return {
    ...payloadRecord,
    ...(mergedProvider === undefined ? {} : { provider: mergedProvider }),
    ...(reasoning === undefined ? {} : { reasoning }),
    ...(serviceTier === undefined ? {} : { service_tier: serviceTier }),
  };
}
