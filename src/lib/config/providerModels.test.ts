import { expect, test } from "bun:test";
import { modelsFromProviderResponse } from "./providerModels";

test("parses Cerebras OpenAI-compatible model responses", () => {
  const models = modelsFromProviderResponse({
    provider: "cerebras",
    responseJson: {
      data: [{ id: "qwen-3-coder-480b" }],
    },
  });

  expect(models).toHaveLength(1);
  expect(models[0]).toMatchObject({
    api: "openai-completions",
    baseUrl: "https://api.cerebras.ai/v1",
    contextWindow: 128_000,
    id: "qwen-3-coder-480b",
    maxTokens: 4_096,
    name: "Qwen 3 Coder 480b",
    provider: "cerebras",
  });
});

test("parses OpenAI-compatible model responses", () => {
  const models = modelsFromProviderResponse({
    provider: "opencode",
    responseJson: {
      data: [{ id: "claude-live", object: "model" }],
    },
  });

  expect(models).toHaveLength(1);
  expect(models[0]).toMatchObject({
    api: "openai-completions",
    baseUrl: "https://opencode.ai/zen/v1",
    contextWindow: 200_000,
    id: "claude-live",
    maxTokens: 128_000,
    name: "Claude Live",
    provider: "opencode",
    reasoning: true,
  });
});

test("parses OpenRouter model metadata", () => {
  const models = modelsFromProviderResponse({
    provider: "openrouter",
    responseJson: {
      data: [
        {
          architecture: { input_modalities: ["text", "image"] },
          context_length: 256_000,
          id: "vendor/model-a",
          name: "Model A",
          pricing: {
            completion: "0.000002",
            input_cache_read: "0.0000001",
            prompt: "0.000001",
          },
          top_provider: { max_completion_tokens: 64_000 },
        },
      ],
    },
  });

  expect(models[0]).toMatchObject({
    api: "openai-completions",
    baseUrl: "https://openrouter.ai/api/v1",
    contextWindow: 256_000,
    cost: { cacheWrite: 0, input: 1, output: 2 },
    id: "vendor/model-a",
    input: ["text", "image"],
    maxTokens: 64_000,
    name: "Model A",
    provider: "openrouter",
  });
  expect(models[0]?.cost.cacheRead).toBeCloseTo(0.1);
});

test("rejects malformed model responses", () => {
  expect(() =>
    modelsFromProviderResponse({
      provider: "openai",
      responseJson: { data: [{ name: "missing id" }] },
    }),
  ).toThrow("id must be a string");
});
