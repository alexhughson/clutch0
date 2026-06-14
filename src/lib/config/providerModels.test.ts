import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getClutchConfigPaths,
  saveClutchApiKey,
  saveClutchOAuthCredential,
} from "./clutchConfig";
import {
  fetchClutchProviderModels,
  modelsFromCursorSdkModels,
  modelsFromProviderResponse,
} from "./providerModels";

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

test("uses OpenCode Zen Responses metadata for GPT models", () => {
  const models = modelsFromProviderResponse({
    provider: "opencode",
    responseJson: {
      data: [
        { id: "gpt-5.3-codex", object: "model" },
        { id: "gpt-5.3-codex-spark", object: "model" },
      ],
    },
  });

  expect(models.find((model) => model.id === "gpt-5.3-codex")).toMatchObject({
    api: "openai-responses",
    baseUrl: "https://opencode.ai/zen/v1",
    contextWindow: 400_000,
    maxTokens: 128_000,
    provider: "opencode",
  });
  expect(
    models.find((model) => model.id === "gpt-5.3-codex-spark"),
  ).toMatchObject({
    api: "openai-responses",
    baseUrl: "https://opencode.ai/zen/v1",
    contextWindow: 128_000,
    input: ["text"],
    maxTokens: 32_000,
    name: "GPT-5.3 Codex Spark",
    provider: "opencode",
    reasoning: true,
    thinkingLevelMap: { off: null, xhigh: "xhigh" },
  });
});

test("loads OpenAI subscription models from pi catalog", async () => {
  const paths = getClutchConfigPaths(
    await mkdtemp(join(tmpdir(), "clutch-provider-models-")),
  );
  saveClutchOAuthCredential({
    credential: {
      access: "subscription-access-token",
      expires: Date.now() + 60_000,
      refresh: "subscription-refresh-token",
    },
    paths,
    provider: "openai-codex",
  });
  const unexpectedFetch = (async () => {
    throw new Error("OpenAI subscription model lookup should not fetch");
  }) as unknown as typeof fetch;

  const models = await fetchClutchProviderModels({
    fetchImpl: unexpectedFetch,
    paths,
    provider: "openai-codex",
  });

  expect(models.map((model) => model.id)).toContain("gpt-5.3-codex-spark");
  expect(
    models.find((model) => model.id === "gpt-5.3-codex-spark"),
  ).toMatchObject({
    api: "openai-codex-responses",
    baseUrl: "https://chatgpt.com/backend-api",
    provider: "openai-codex",
  });
});

test("loads Google Gemini models from pi catalog", async () => {
  const paths = getClutchConfigPaths(
    await mkdtemp(join(tmpdir(), "clutch-provider-models-")),
  );
  saveClutchApiKey({
    apiKey: "google-token",
    paths,
    provider: "google",
  });
  const unexpectedFetch = (async () => {
    throw new Error("Google model lookup should use the local catalog");
  }) as unknown as typeof fetch;

  const models = await fetchClutchProviderModels({
    fetchImpl: unexpectedFetch,
    paths,
    provider: "google",
  });

  expect(models.map((model) => model.id)).toContain("gemini-3.5-flash");
  expect(models.map((model) => model.id)).toContain("gemini-3.1-flash-lite");
  expect(models.find((model) => model.id === "gemini-3.5-flash")).toMatchObject(
    {
      api: "google-generative-ai",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      contextWindow: 1_048_576,
      maxTokens: 65_536,
      provider: "google",
      reasoning: true,
    },
  );
});

test("maps Cursor SDK model variants to stored Composer selections", () => {
  const models = modelsFromCursorSdkModels([
    {
      displayName: "Composer 2.5",
      id: "composer-2.5",
      parameters: [
        {
          displayName: "Fast",
          id: "fast",
          values: [{ value: "false" }, { displayName: "Fast", value: "true" }],
        },
      ],
      variants: [
        {
          displayName: "Composer 2.5",
          isDefault: true,
          params: [{ id: "fast", value: "true" }],
        },
        {
          displayName: "Composer 2.5",
          params: [{ id: "fast", value: "false" }],
        },
      ],
    },
  ]);

  expect(models.map((model) => model.id)).toEqual([
    "composer-2.5:fast",
    "composer-2.5:standard",
  ]);
  expect(models[0]).toMatchObject({
    api: "cursor-agent",
    baseUrl: "cursor-sdk://agent",
    id: "composer-2.5:fast",
    name: "Composer 2.5 (Fast)",
    provider: "cursor",
    compat: {
      cursorModelSelection: {
        id: "composer-2.5",
        params: [{ id: "fast", value: "true" }],
      },
    },
  });
  expect(models[1]).toMatchObject({
    id: "composer-2.5:standard",
    name: "Composer 2.5 (Standard)",
    compat: {
      cursorModelSelection: {
        id: "composer-2.5",
        params: [{ id: "fast", value: "false" }],
      },
    },
  });
});

test("loads Cursor models through the SDK with configured API key", async () => {
  const paths = getClutchConfigPaths(
    await mkdtemp(join(tmpdir(), "clutch-provider-models-")),
  );
  saveClutchApiKey({
    apiKey: "cursor-token",
    paths,
    provider: "cursor",
  });

  const models = await fetchClutchProviderModels({
    cursorListModels: async ({ apiKey }) => {
      expect(apiKey).toBe("cursor-token");
      return [
        {
          displayName: "Composer 2.5",
          id: "composer-2.5",
          variants: [
            {
              displayName: "Fast",
              params: [{ id: "fast", value: "true" }],
            },
          ],
        },
      ];
    },
    fetchImpl: (async () => {
      throw new Error("Cursor model lookup should use the SDK");
    }) as unknown as typeof fetch,
    paths,
    provider: "cursor",
  });

  expect(models[0]).toMatchObject({
    api: "cursor-agent",
    id: "composer-2.5:fast",
    provider: "cursor",
  });
});

test("keeps OpenCode Zen chat-completions metadata for compatible models", () => {
  const models = modelsFromProviderResponse({
    provider: "opencode",
    responseJson: {
      data: [{ id: "big-pickle", object: "model" }],
    },
  });

  expect(models).toHaveLength(1);
  expect(models[0]).toMatchObject({
    api: "openai-completions",
    baseUrl: "https://opencode.ai/zen/v1",
    id: "big-pickle",
    provider: "opencode",
  });
});

test("uses OpenCode OpenAI-compatible reasoning metadata for DeepSeek V4 Flash", () => {
  const models = modelsFromProviderResponse({
    provider: "opencode-go",
    responseJson: {
      data: [{ id: "deepseek-v4-flash", object: "model" }],
    },
  });

  expect(models).toHaveLength(1);
  expect(models[0]).toMatchObject({
    api: "openai-completions",
    baseUrl: "https://opencode.ai/zen/go/v1",
    id: "deepseek-v4-flash",
    provider: "opencode-go",
    reasoning: true,
    thinkingLevelMap: {
      minimal: null,
      low: "low",
      medium: "medium",
      high: "high",
      xhigh: "max",
    },
    compat: {
      requiresReasoningContentOnAssistantMessages: true,
    },
  });
  expect(models[0]?.compat).not.toHaveProperty("thinkingFormat");
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

test("uses OpenRouter reasoning metadata for Gemini 3 models", () => {
  const models = modelsFromProviderResponse({
    provider: "openrouter",
    responseJson: {
      data: [{ id: "google/gemini-3.1-flash-lite" }],
    },
  });

  expect(models[0]).toMatchObject({
    api: "openai-completions",
    baseUrl: "https://openrouter.ai/api/v1",
    id: "google/gemini-3.1-flash-lite",
    provider: "openrouter",
    reasoning: true,
    thinkingLevelMap: { xhigh: "high" },
  });
});

test("parses SambaNova model metadata", () => {
  const models = modelsFromProviderResponse({
    provider: "sambanova",
    responseJson: {
      data: [
        {
          context_length: 128_000,
          id: "gpt-oss-120b",
          max_completion_tokens: 16_384,
          object: "model",
          pricing: {
            completion: 0.0000012,
            prompt: 0.0000006,
          },
        },
        {
          context_length: 128_000,
          id: "Meta-Llama-3.3-70B-Instruct",
          max_completion_tokens: 4_096,
          object: "model",
        },
      ],
    },
  });

  expect(models.find((model) => model.id === "gpt-oss-120b")).toMatchObject({
    api: "openai-completions",
    baseUrl: "https://api.sambanova.ai/v1",
    contextWindow: 128_000,
    cost: { input: 0.6, output: 1.2 },
    id: "gpt-oss-120b",
    maxTokens: 16_384,
    provider: "sambanova",
    reasoning: true,
    thinkingLevelMap: { minimal: null, xhigh: "high" },
    compat: {
      supportsLongCacheRetention: false,
      supportsStore: false,
      supportsStrictMode: false,
    },
  });
  expect(
    models.find((model) => model.id === "Meta-Llama-3.3-70B-Instruct"),
  ).toMatchObject({
    provider: "sambanova",
    reasoning: false,
  });
});

test("loads SambaNova models from the public OpenAI-compatible endpoint", async () => {
  const paths = getClutchConfigPaths(
    await mkdtemp(join(tmpdir(), "clutch-provider-models-")),
  );
  saveClutchApiKey({
    apiKey: "sambanova-token",
    paths,
    provider: "sambanova",
  });
  const fetchImpl = (async (
    url: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    expect(url).toBe("https://api.sambanova.ai/v1/models");
    expect(init?.headers).toMatchObject({
      accept: "application/json",
      authorization: "Bearer sambanova-token",
    });
    return Response.json({
      data: [{ id: "Meta-Llama-3.3-70B-Instruct" }],
    });
  }) as unknown as typeof fetch;

  const models = await fetchClutchProviderModels({
    fetchImpl,
    paths,
    provider: "sambanova",
  });

  expect(models[0]).toMatchObject({
    baseUrl: "https://api.sambanova.ai/v1",
    id: "Meta-Llama-3.3-70B-Instruct",
    provider: "sambanova",
  });
});

test("rejects malformed model responses", () => {
  expect(() =>
    modelsFromProviderResponse({
      provider: "openai",
      responseJson: { data: [{ name: "missing id" }] },
    }),
  ).toThrow("id must be a string");
});
