import { expect, test } from "bun:test";
import type { LlmModel } from "./types";
import { configuredLlmRequestOptions, reasoningForEffortLevel } from "./requestOptions";

function modelFixture(
  overrides: Partial<LlmModel> = {},
): LlmModel {
  return {
    api: "openai-completions",
    baseUrl: "https://openrouter.ai/api/v1",
    contextWindow: 128_000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id: "google/gemini-3.1-flash-lite",
    input: ["text"],
    maxTokens: 16_384,
    name: "google/gemini-3.1-flash-lite",
    provider: "openrouter",
    reasoning: true,
    thinkingLevelMap: { xhigh: "high" },
    ...overrides,
  };
}

test("maps model effort levels to simple reasoning options", () => {
  expect(reasoningForEffortLevel("off")).toBe(undefined);
  expect(reasoningForEffortLevel("low")).toBe("low");
  expect(reasoningForEffortLevel("xhigh")).toBe("xhigh");
});

test("builds configured simple request options", () => {
  const model = modelFixture({ provider: "work-proxy" });

  expect(
    configuredLlmRequestOptions({
      apiKey: "token",
      effortLevel: "medium",
      headers: { "x-test": "yes" },
      model,
      requestDefaults: { temperature: 0.2 },
    }),
  ).toEqual({
    apiKey: "token",
    headers: { "x-test": "yes" },
    onPayload: expect.any(Function),
    reasoning: "medium",
    signal: undefined,
  });
});

test("requestDefaults cannot clobber messages or stream", () => {
  const options = configuredLlmRequestOptions({
    apiKey: "token",
    effortLevel: "low",
    model: modelFixture({ provider: "work-proxy" }),
    requestDefaults: {
      messages: [{ role: "system", content: "override" }],
      model: "wrong-model",
      stream: false,
      temperature: 0.2,
    },
  });

  expect(
    options.onPayload?.(
      {
        messages: [{ role: "user", content: "hello" }],
        model: "right-model",
        stream: true,
      },
      modelFixture({ provider: "work-proxy" }),
    ),
  ).toEqual({
    messages: [{ role: "user", content: "hello" }],
    model: "right-model",
    stream: true,
    temperature: 0.2,
  });
});

test("injects openRouter provider object, service tier, and reasoning from capabilities", () => {
  const model = modelFixture();
  const options = configuredLlmRequestOptions({
    apiKey: "token",
    effortLevel: "medium",
    model,
    openRouter: {
      allowFallbacks: true,
      capabilities: {
        supportsReasoning: true,
        supportsServiceTier: true,
        vendors: ["Google"],
      },
      providerExtras: { data_collection: "deny" },
      serviceTier: "priority",
      sort: "latency",
      vendor: "Google",
    },
  });

  expect(
    options.onPayload?.({ model: "model", stream: true }, model),
  ).toEqual({
    model: "model",
    provider: {
      allow_fallbacks: true,
      data_collection: "deny",
      only: ["Google"],
      sort: "latency",
    },
    reasoning: { effort: "medium", exclude: true },
    service_tier: "priority",
    stream: true,
  });
});

test("turns OpenRouter reasoning off explicitly with minimal effort for Gemini", () => {
  const model = modelFixture();
  const options = configuredLlmRequestOptions({
    apiKey: "token",
    effortLevel: "off",
    model,
    openRouter: {
      capabilities: {
        supportsReasoning: true,
        supportsServiceTier: false,
        vendors: [],
      },
    },
  });

  expect(
    options.onPayload?.({ model: "model", stream: true }, model),
  ).toEqual({
    model: "model",
    reasoning: { effort: "minimal", exclude: true },
    stream: true,
  });
});

test("sets allow_fallbacks false explicitly when vendor is pinned without fallbacks", () => {
  const model = modelFixture();
  const options = configuredLlmRequestOptions({
    apiKey: "token",
    effortLevel: "low",
    model,
    openRouter: {
      allowFallbacks: false,
      capabilities: {
        supportsReasoning: false,
        supportsServiceTier: false,
        vendors: ["Google"],
      },
      vendor: "Google",
    },
  });

  expect(
    options.onPayload?.({ model: "model", stream: true }, model),
  ).toEqual({
    model: "model",
    provider: {
      allow_fallbacks: false,
      only: ["Google"],
    },
    stream: true,
  });
});

test("throws when openRouter options are set without capabilities", () => {
  const model = modelFixture({ id: "meta-llama/llama-4.1", reasoning: false });
  expect(() =>
    configuredLlmRequestOptions({
      apiKey: "token",
      effortLevel: "off",
      model,
      openRouter: {
        serviceTier: "priority",
        vendor: "Meta",
      },
    }),
  ).toThrow("requires capabilities.supportsServiceTier");
});

test("throws when service tier is set without supportsServiceTier", () => {
  const model = modelFixture();
  expect(() =>
    configuredLlmRequestOptions({
      apiKey: "token",
      effortLevel: "medium",
      model,
      openRouter: {
        capabilities: {
          supportsReasoning: false,
          supportsServiceTier: false,
          vendors: [],
        },
        serviceTier: "priority",
      },
    }),
  ).toThrow("requires capabilities.supportsServiceTier");
});
