import {
  getModel,
  getModels,
  getProviders,
  type Api,
  type KnownProvider,
  type Model,
} from "@earendil-works/pi-ai";

export const DEFAULT_LLM_PROVIDER = "openai";
export const DEFAULT_LLM_MODEL = "gpt-5.4-mini";

export function resolveLlmModel(): Model<Api> {
  const provider = process.env.CLUTCH_LLM_PROVIDER ?? DEFAULT_LLM_PROVIDER;
  const modelId = process.env.CLUTCH_LLM_MODEL ?? DEFAULT_LLM_MODEL;

  if (provider === DEFAULT_LLM_PROVIDER && modelId === DEFAULT_LLM_MODEL) {
    return getModel(DEFAULT_LLM_PROVIDER, DEFAULT_LLM_MODEL);
  }

  if (!isKnownProvider(provider)) {
    throw new Error(
      `Unknown LLM provider "${provider}". Set CLUTCH_LLM_PROVIDER to one of: ${getProviders().join(", ")}`,
    );
  }

  const model = getModels(provider).find(
    (candidate) => candidate.id === modelId,
  );
  if (model === undefined) {
    throw new Error(
      `Unknown LLM model "${modelId}" for provider "${provider}". Set CLUTCH_LLM_MODEL to a supported model id.`,
    );
  }

  return model;
}

function isKnownProvider(provider: string): provider is KnownProvider {
  return getProviders().includes(provider as KnownProvider);
}
