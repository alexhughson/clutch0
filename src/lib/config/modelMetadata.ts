import type { Api, Model } from "@earendil-works/pi-ai";

const OPENCODE_DEEPSEEK_V4_THINKING_LEVEL_MAP = {
  minimal: null,
  low: "low",
  medium: "medium",
  high: "high",
  xhigh: "max",
} satisfies NonNullable<Model<Api>["thinkingLevelMap"]>;

export function normalizeClutchModelMetadata(model: Model<Api>): Model<Api> {
  if (!isOpenCodeDeepSeekV4Model(model)) {
    return model;
  }

  const compat = { ...(model.compat ?? {}) } as Record<string, unknown>;
  delete compat.thinkingFormat;

  return {
    ...model,
    api: "openai-completions",
    baseUrl:
      model.provider === "opencode-go"
        ? "https://opencode.ai/zen/go/v1"
        : "https://opencode.ai/zen/v1",
    reasoning: true,
    thinkingLevelMap: OPENCODE_DEEPSEEK_V4_THINKING_LEVEL_MAP,
    compat: {
      ...compat,
      requiresReasoningContentOnAssistantMessages: true,
    } as Model<Api>["compat"],
  };
}

function isOpenCodeDeepSeekV4Model(model: Model<Api>): boolean {
  return (
    (model.provider === "opencode" || model.provider === "opencode-go") &&
    model.id.toLowerCase().includes("deepseek-v4")
  );
}
