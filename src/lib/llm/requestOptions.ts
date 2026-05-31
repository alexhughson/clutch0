import type { Api, Model } from "@earendil-works/pi-ai";

const CEREBRAS_MAX_OUTPUT_TOKENS = 4_096;

export function maxOutputTokensForModel(model: Model<Api>): number | undefined {
  if (model.provider === "cerebras") {
    return Math.min(model.maxTokens, CEREBRAS_MAX_OUTPUT_TOKENS);
  }

  return undefined;
}
