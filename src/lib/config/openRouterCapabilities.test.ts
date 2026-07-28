import { expect, test } from "bun:test";
import {
  baseVendorTag,
  fetchOpenRouterCapabilities,
  validateOpenRouterOptions,
} from "./openRouterCapabilities";

test("baseVendorTag strips only trailing flex/priority", () => {
  expect(baseVendorTag("openai")).toBe("openai");
  expect(baseVendorTag("openai/flex")).toBe("openai");
  expect(baseVendorTag("openai/priority")).toBe("openai");
  expect(baseVendorTag("xai/zdr/priority")).toBe("xai/zdr");
  expect(baseVendorTag("google-vertex/global")).toBe("google-vertex/global");
});

test("fetchOpenRouterCapabilities derives vendors and serviceTiers from endpoint tags", async () => {
  const fetchImpl = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/models") && !url.includes("/endpoints")) {
      return Response.json({
        data: [
          {
            id: "openai/gpt-test",
            supported_parameters: ["reasoning", "temperature"],
          },
        ],
      });
    }
    if (url.includes("/endpoints")) {
      return Response.json({
        data: {
          id: "openai/gpt-test",
          endpoints: [
            { tag: "openai" },
            { tag: "openai/flex" },
            { tag: "openai/priority" },
            { tag: "azure" },
          ],
        },
      });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  }) as typeof fetch;

  const capabilities = await fetchOpenRouterCapabilities("openai/gpt-test", {
    apiKey: "token",
    fetchImpl,
  });

  expect(capabilities).toEqual({
    serviceTiers: ["flex", "priority"],
    supportsReasoning: true,
    vendors: ["azure", "openai"],
  });
});

test("validateOpenRouterOptions clears unsupported service tier without throwing", () => {
  expect(
    validateOpenRouterOptions(
      {
        serviceTier: "priority",
        vendor: "missing",
      },
      {
        serviceTiers: ["flex"],
        supportsReasoning: false,
        vendors: ["openai"],
      },
    ),
  ).toEqual({
    capabilities: {
      serviceTiers: ["flex"],
      supportsReasoning: false,
      vendors: ["openai"],
    },
  });
});
