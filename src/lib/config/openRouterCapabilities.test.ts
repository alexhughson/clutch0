import { expect, test } from "bun:test";
import {
  fetchOpenRouterCapabilities,
  openRouterModelTraits,
  validateOpenRouterOptions,
} from "./openRouterCapabilities";

test("openRouterModelTraits marks Gemini 3 models as reasoning", () => {
  expect(openRouterModelTraits("google/gemini-3.1-flash-lite")).toEqual({
    reasoning: true,
    thinkingLevelMap: { xhigh: "high" },
  });
  expect(openRouterModelTraits("meta-llama/llama-4.1")).toEqual({
    reasoning: false,
  });
});

test("fetchOpenRouterCapabilities returns slim snapshot", async () => {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("supported_parameters=service_tier")) {
      return Response.json({
        data: [{ id: "anthropic/claude-sonnet-4" }, { id: "openai/gpt-5" }],
      });
    }
    if (url.includes("/endpoints")) {
      return Response.json({
        data: [{ tag: "Anthropic" }, { tag: "Google" }],
      });
    }
    return Response.json({
      data: [
        {
          id: "anthropic/claude-sonnet-4",
          supported_parameters: ["reasoning"],
        },
      ],
    });
  }) as unknown as typeof fetch;

  await expect(
    fetchOpenRouterCapabilities("anthropic/claude-sonnet-4", {
      apiKey: "token",
      fetchImpl,
    }),
  ).resolves.toEqual({
    supportsReasoning: true,
    supportsServiceTier: true,
    vendors: ["Anthropic", "Google"],
  });
});

test("fetchOpenRouterCapabilities uses service_tier filter when model record omits it", async () => {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("supported_parameters=service_tier")) {
      return Response.json({
        data: [{ id: "openai/gpt-5" }],
      });
    }
    if (url.includes("/endpoints")) {
      return Response.json({ data: [] });
    }
    return Response.json({
      data: [
        {
          id: "openai/gpt-5",
          supported_parameters: ["reasoning_effort"],
        },
      ],
    });
  }) as unknown as typeof fetch;

  await expect(
    fetchOpenRouterCapabilities("openai/gpt-5", {
      apiKey: "token",
      fetchImpl,
    }),
  ).resolves.toEqual({
    supportsReasoning: true,
    supportsServiceTier: true,
    vendors: [],
  });
});

test("fetchOpenRouterCapabilities returns empty vendors when endpoints fetch fails", async () => {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("supported_parameters=service_tier")) {
      return Response.json({ data: [] });
    }
    if (url.includes("/endpoints")) {
      return new Response(null, { status: 404 });
    }
    return Response.json({
      data: [
        {
          id: "meta-llama/llama-4.1",
          supported_parameters: [],
        },
      ],
    });
  }) as unknown as typeof fetch;

  await expect(
    fetchOpenRouterCapabilities("meta-llama/llama-4.1", {
      apiKey: "token",
      fetchImpl,
    }),
  ).resolves.toEqual({
    supportsReasoning: false,
    supportsServiceTier: false,
    vendors: [],
  });
});

test("validateOpenRouterOptions clears invalid vendor", () => {
  expect(
    validateOpenRouterOptions(
      {
        capabilities: {
          supportsReasoning: true,
          supportsServiceTier: true,
          vendors: ["Anthropic"],
        },
        vendor: "Google",
      },
      {
        supportsReasoning: true,
        supportsServiceTier: true,
        vendors: ["Anthropic"],
      },
    ),
  ).toEqual({
    capabilities: {
      supportsReasoning: true,
      supportsServiceTier: true,
      vendors: ["Anthropic"],
    },
  });
});
