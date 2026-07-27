import { expect, test } from "bun:test";
import { OPENROUTER_PROVIDER_ID } from "../../lib/config/clutchConfig";
import {
  buildModelSettingsRows,
  commitOpenRouterModelSelection,
  openRouterVendorOptions,
  sanitizeOpenRouterOptionsAfterCapabilities,
} from "./configScreenHelpers";

const openRouterSelection = {
  model: "anthropic/claude-sonnet-4",
  provider: OPENROUTER_PROVIDER_ID,
  openRouter: {
    capabilities: {
      supportsReasoning: true,
      supportsServiceTier: true,
      vendors: ["Anthropic"],
    },
    serviceTier: "priority" as const,
    vendor: "Anthropic",
  },
};

const customSelection = {
  model: "vendor/model",
  provider: "work-proxy",
};

test("buildModelSettingsRows gates OpenRouter rows from capabilities", () => {
  const rows = buildModelSettingsRows({
    agent: openRouterSelection,
    primary: openRouterSelection,
    summarization: customSelection,
  });

  expect(rows).toEqual([
    { entry: "primary", kind: "model" },
    { entry: "primary", kind: "sort" },
    { entry: "primary", kind: "vendor" },
    { entry: "primary", kind: "service-tier" },
    { entry: "primary", kind: "effort" },
    { entry: "primary", kind: "provider-extras" },
    { entry: "agent", kind: "model" },
    { entry: "agent", kind: "sort" },
    { entry: "agent", kind: "vendor" },
    { entry: "agent", kind: "service-tier" },
    { entry: "agent", kind: "effort" },
    { entry: "agent", kind: "provider-extras" },
    { entry: "summarization", kind: "model" },
    { kind: "done" },
  ]);
});

test("openRouterVendorOptions includes Auto when vendors exist", () => {
  expect(
    openRouterVendorOptions({
      supportsReasoning: false,
      supportsServiceTier: false,
      vendors: ["Anthropic", "Google"],
    }),
  ).toEqual(["Auto", "Anthropic", "Google"]);
});

test("sanitizeOpenRouterOptionsAfterCapabilities clears unsupported service tier", () => {
  expect(
    sanitizeOpenRouterOptionsAfterCapabilities({
      capabilities: {
        supportsReasoning: false,
        supportsServiceTier: false,
        vendors: [],
      },
      options: {
        capabilities: {
          supportsReasoning: false,
          supportsServiceTier: false,
          vendors: [],
        },
        serviceTier: "priority",
        vendor: "Anthropic",
      },
    }),
  ).toEqual({
    capabilities: {
      supportsReasoning: false,
      supportsServiceTier: false,
      vendors: [],
    },
    serviceTier: "default",
  });
});

test("commitOpenRouterModelSelection fetches capabilities and validates options", async () => {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("supported_parameters=service_tier")) {
      return Response.json({ data: [{ id: "anthropic/claude-sonnet-4" }] });
    }
    if (url.includes("/endpoints")) {
      return Response.json({ data: [{ tag: "Anthropic" }] });
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
    commitOpenRouterModelSelection({
      apiKey: "token",
      fetchImpl,
      modelId: "anthropic/claude-sonnet-4",
      selection: {
        model: "",
        provider: OPENROUTER_PROVIDER_ID,
        openRouter: {
          serviceTier: "priority",
          vendor: "Google",
        },
      },
    }),
  ).resolves.toMatchObject({
    model: "anthropic/claude-sonnet-4",
    openRouter: {
      capabilities: {
        supportsReasoning: true,
        supportsServiceTier: true,
        vendors: ["Anthropic"],
      },
      serviceTier: "priority",
    },
  });
});
