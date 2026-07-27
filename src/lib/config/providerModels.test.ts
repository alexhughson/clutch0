import { expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getClutchConfigPaths,
  OPENROUTER_PROVIDER_ID,
  saveClutchApiKey,
} from "./clutchConfig";
import {
  fetchClutchProviderModels,
  modelsFromProviderResponse,
} from "./providerModels";

test("parses OpenAI-compatible model responses", () => {
  const models = modelsFromProviderResponse({
    data: [{ id: "claude-live", name: "Claude Live" }],
  });

  expect(models).toEqual([{ id: "claude-live", name: "Claude Live" }]);
});

test("parses OpenRouter model list entries", () => {
  const models = modelsFromProviderResponse({
    data: [
      {
        id: "vendor/model-a",
        name: "Model A",
      },
    ],
  });

  expect(models).toEqual([{ id: "vendor/model-a", name: "Model A" }]);
});

test("loads OpenRouter models from the public endpoint", async () => {
  const paths = getClutchConfigPaths(
    await mkdtemp(join(tmpdir(), "clutch-provider-models-")),
  );
  saveClutchApiKey({
    apiKey: "openrouter-token",
    paths,
    provider: OPENROUTER_PROVIDER_ID,
  });
  const fetchImpl = (async (
    url: Parameters<typeof fetch>[0],
    init?: Parameters<typeof fetch>[1],
  ) => {
    expect(url).toBe("https://openrouter.ai/api/v1/models");
    expect(init?.headers).toMatchObject({
      accept: "application/json",
      authorization: "Bearer openrouter-token",
    });
    return Response.json({
      data: [{ id: "anthropic/claude-sonnet-4", name: "Claude Sonnet 4" }],
    });
  }) as unknown as typeof fetch;

  const models = await fetchClutchProviderModels({
    fetchImpl,
    paths,
    provider: OPENROUTER_PROVIDER_ID,
  });

  expect(models[0]).toEqual({
    id: "anthropic/claude-sonnet-4",
    name: "Claude Sonnet 4",
  });
});

test("rejects malformed model responses", () => {
  expect(() =>
    modelsFromProviderResponse({
      data: [{ name: "missing id" }],
    }),
  ).toThrow("id must be a string");
});
