import { expect, test } from "bun:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import {
  configuredLlmRequestOptions,
  maxOutputTokensForModel,
  reasoningForEffortLevel,
  serviceTierForRequest,
  usesProviderSpecificRequestOptions,
} from "./requestOptions";

function modelFixture(
  provider: string,
  maxTokens: number,
  api: Api = "openai-completions",
  id = "model",
): Model<Api> {
  return {
    api,
    baseUrl: "https://example.test/v1",
    contextWindow: 128_000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id,
    input: ["text"],
    maxTokens,
    name: "Model",
    provider,
    reasoning: false,
  };
}

test("caps Cerebras output tokens below account token-per-minute limits", () => {
  expect(maxOutputTokensForModel(modelFixture("cerebras", 32_000))).toBe(4_096);
  expect(maxOutputTokensForModel(modelFixture("cerebras", 1_024))).toBe(1_024);
});

test("leaves other providers to their model defaults", () => {
  expect(maxOutputTokensForModel(modelFixture("openai", 32_000))).toBe(
    undefined,
  );
});

test("maps model effort levels to simple reasoning options", () => {
  expect(reasoningForEffortLevel("off")).toBe(undefined);
  expect(reasoningForEffortLevel("low")).toBe("low");
  expect(reasoningForEffortLevel("xhigh")).toBe("xhigh");
});

test("builds configured simple request options", () => {
  const model = modelFixture("cerebras", 32_000);

  expect(
    configuredLlmRequestOptions({
      apiKey: "token",
      effortLevel: "medium",
      headers: { "x-test": "yes" },
      model,
      serviceTier: "default",
    }),
  ).toEqual({
    apiKey: "token",
    headers: { "x-test": "yes" },
    maxTokens: 4_096,
    reasoning: "medium",
    signal: undefined,
  });
});

test("omits service tier by default for OpenAI API key responses models", () => {
  const model = modelFixture("openai", 32_000, "openai-responses");

  const request = {
    apiKey: "token",
    effortLevel: "medium" as const,
    model,
    serviceTier: "default" as const,
  };

  expect(serviceTierForRequest(request)).toBe(undefined);
  expect(usesProviderSpecificRequestOptions(request)).toBe(false);
  expect(configuredLlmRequestOptions(request)).not.toHaveProperty(
    "serviceTier",
  );
});

test("uses priority service tier for configured OpenAI API key responses models", () => {
  const model = modelFixture("openai", 32_000, "openai-responses");
  const request = {
    apiKey: "token",
    effortLevel: "medium" as const,
    model,
    serviceTier: "priority" as const,
  };

  expect(serviceTierForRequest(request)).toBe("priority");
  expect(usesProviderSpecificRequestOptions(request)).toBe(true);
  expect(configuredLlmRequestOptions(request)).toMatchObject({
    apiKey: "token",
    reasoning: "medium",
    reasoningEffort: "medium",
    serviceTier: "priority",
  });
});

test("adds OpenRouter priority service tier and reasoning to chat-completions payloads", () => {
  const model = modelFixture(
    "openrouter",
    32_000,
    "openai-completions",
    "google/gemini-3.1-flash-lite",
  );
  const request = {
    apiKey: "token",
    effortLevel: "medium" as const,
    model,
    serviceTier: "priority" as const,
  };
  const options = configuredLlmRequestOptions(request);

  expect(serviceTierForRequest(request)).toBe("priority");
  expect(usesProviderSpecificRequestOptions(request)).toBe(false);
  expect(options.onPayload?.({ model: "model", stream: true }, model)).toEqual({
    model: "model",
    reasoning: { effort: "medium", exclude: true },
    service_tier: "priority",
    stream: true,
  });
  expect(options).not.toHaveProperty("serviceTier");
});

test("turns OpenRouter OpenAI-style reasoning off explicitly", () => {
  const model = modelFixture(
    "openrouter",
    32_000,
    "openai-completions",
    "openai/gpt-5.4-mini",
  );
  const options = configuredLlmRequestOptions({
    apiKey: "token",
    effortLevel: "off",
    model,
    serviceTier: "default",
  });

  expect(options.onPayload?.({ model: "model", stream: true }, model)).toEqual({
    model: "model",
    reasoning: { effort: "none", exclude: true },
    stream: true,
  });
});

test("uses Gemini minimal as the lowest OpenRouter reasoning level", () => {
  const model = modelFixture(
    "openrouter",
    32_000,
    "openai-completions",
    "google/gemini-3.5-flash",
  );
  const options = configuredLlmRequestOptions({
    apiKey: "token",
    effortLevel: "off",
    model,
    serviceTier: "priority",
  });

  expect(options.onPayload?.({ model: "model", stream: true }, model)).toEqual({
    model: "model",
    reasoning: { effort: "minimal", exclude: true },
    service_tier: "priority",
    stream: true,
  });
});

test("maps Gemini xhigh to OpenRouter's highest supported Gemini thinking level", () => {
  const model = {
    ...modelFixture(
      "openrouter",
      32_000,
      "openai-completions",
      "google/gemini-3.1-pro-preview",
    ),
    thinkingLevelMap: { xhigh: "high" },
  } satisfies Model<Api>;
  const options = configuredLlmRequestOptions({
    apiKey: "token",
    effortLevel: "xhigh",
    model,
    serviceTier: "default",
  });

  expect(options.onPayload?.({ model: "model", stream: true }, model)).toEqual({
    model: "model",
    reasoning: { effort: "high", exclude: true },
    stream: true,
  });
});

test("leaves non-reasoning OpenRouter model payloads unchanged without priority", () => {
  const model = modelFixture(
    "openrouter",
    32_000,
    "openai-completions",
    "meta-llama/llama-4.1",
  );
  const options = configuredLlmRequestOptions({
    apiKey: "token",
    effortLevel: "off",
    model,
    serviceTier: "default",
  });

  expect(options.onPayload).toBeUndefined();
});

test("rejects priority service tier for unsupported OpenRouter model families", () => {
  const model = modelFixture(
    "openrouter",
    32_000,
    "openai-completions",
    "meta-llama/llama-4.1",
  );

  expect(() =>
    configuredLlmRequestOptions({
      apiKey: "token",
      effortLevel: "medium",
      model,
      serviceTier: "priority",
    }),
  ).toThrow("OpenRouter anthropic/, google/, openai/ model IDs");
});

test("fails loudly for priority service tier on unsupported providers", () => {
  const model = modelFixture("openai-codex", 32_000, "openai-codex-responses");

  expect(() =>
    configuredLlmRequestOptions({
      apiKey: "token",
      effortLevel: "medium",
      model,
      serviceTier: "priority",
    }),
  ).toThrow("Priority service tier is only supported");
});
