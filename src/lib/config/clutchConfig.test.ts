import type { Api, Model } from "@earendil-works/pi-ai";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import {
  getClutchConfigPaths,
  isClutchConfigured,
  loadClutchAuth,
  resolveConfiguredLlmModel,
  saveClutchApiKey,
  saveClutchConfiguration,
  saveClutchModelConfiguration,
} from "./clutchConfig";

async function createTempConfigPaths() {
  return getClutchConfigPaths(await mkdtemp(join(tmpdir(), "clutch-config-")));
}

function modelFixture({
  id,
  provider = "openai",
}: {
  id: string;
  provider?: string;
}): Model<Api> {
  return {
    api: provider === "openai" ? "openai-responses" : "openai-completions",
    baseUrl:
      provider === "openai"
        ? "https://api.openai.com/v1"
        : "https://openrouter.ai/api/v1",
    contextWindow: 128_000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 1, output: 2 },
    id,
    input: ["text"],
    maxTokens: 16_384,
    name: id,
    provider,
    reasoning: false,
  };
}

test("saves model settings separately from API credentials", async () => {
  const paths = await createTempConfigPaths();
  const primary = {
    metadata: modelFixture({ id: "gpt-live-primary" }),
    model: "gpt-live-primary",
    provider: "openai" as const,
  };
  const summarization = {
    metadata: modelFixture({ id: "gpt-live-summary" }),
    model: "gpt-live-summary",
    provider: "openai" as const,
  };

  saveClutchConfiguration({
    apiKey: "secret-token",
    paths,
    primary,
    summarization,
  });

  const settingsText = await readFile(paths.settingsPath, "utf-8");
  const auth = loadClutchAuth(paths);
  expect(settingsText).toContain(primary.model);
  expect(settingsText).toContain('"metadata"');
  expect(settingsText).not.toContain("secret-token");
  expect(auth.openai?.key).toBe("secret-token");
  expect(isClutchConfigured(paths)).toBe(true);
});

test("resolves primary and summarization models independently", async () => {
  const paths = await createTempConfigPaths();
  const primary = {
    metadata: modelFixture({ id: "gpt-live-primary" }),
    model: "gpt-live-primary",
    provider: "openai" as const,
  };
  const summarization = {
    metadata: modelFixture({ id: "gpt-live-summary" }),
    model: "gpt-live-summary",
    provider: "openai" as const,
  };

  saveClutchConfiguration({
    apiKey: "secret-token",
    paths,
    primary,
    summarization,
  });

  expect(resolveConfiguredLlmModel("primary", paths).model.id).toBe(
    primary.model,
  );
  expect(resolveConfiguredLlmModel("summarization", paths).model.id).toBe(
    summarization.model,
  );
  expect(resolveConfiguredLlmModel("primary", paths).apiKey).toBe(
    "secret-token",
  );
});

test("supports different providers for primary and summarization models", async () => {
  const paths = await createTempConfigPaths();
  await Promise.all([
    saveClutchApiKey({ apiKey: "openai-token", paths, provider: "openai" }),
    saveClutchApiKey({
      apiKey: "openrouter-token",
      paths,
      provider: "openrouter",
    }),
  ]);
  const primary = {
    metadata: modelFixture({ id: "gpt-live-primary", provider: "openai" }),
    model: "gpt-live-primary",
    provider: "openai" as const,
  };
  const summarization = {
    metadata: modelFixture({
      id: "anthropic/live-summary",
      provider: "openrouter",
    }),
    model: "anthropic/live-summary",
    provider: "openrouter" as const,
  };

  saveClutchModelConfiguration({
    paths,
    primary,
    summarization,
  });

  expect(resolveConfiguredLlmModel("primary", paths).apiKey).toBe(
    "openai-token",
  );
  expect(resolveConfiguredLlmModel("summarization", paths).apiKey).toBe(
    "openrouter-token",
  );
  expect(isClutchConfigured(paths)).toBe(true);
});

test("requires dynamic model metadata for configured models", async () => {
  const paths = await createTempConfigPaths();
  saveClutchApiKey({ apiKey: "secret-token", paths, provider: "openai" });

  expect(() =>
    saveClutchModelConfiguration({
      paths,
      primary: { model: "legacy-primary", provider: "openai" },
      summarization: { model: "legacy-summary", provider: "openai" },
    }),
  ).toThrow("missing dynamic model metadata");
});

test("requires credentials for the configured provider", async () => {
  const paths = await createTempConfigPaths();

  expect(() =>
    saveClutchConfiguration({
      paths,
      primary: {
        metadata: modelFixture({ id: "gpt-live-primary" }),
        model: "gpt-live-primary",
        provider: "openai",
      },
      summarization: {
        metadata: modelFixture({ id: "gpt-live-summary" }),
        model: "gpt-live-summary",
        provider: "openai",
      },
    }),
  ).toThrow('Missing Clutch API key for provider "openai".');
});

test("legacy metadata-less settings are not considered configured", async () => {
  const paths = await createTempConfigPaths();
  saveClutchApiKey({ apiKey: "secret-token", paths, provider: "openai" });
  await writeFile(
    paths.settingsPath,
    JSON.stringify({
      models: {
        primary: { model: "legacy-primary", provider: "openai" },
        summarization: { model: "legacy-summary", provider: "openai" },
      },
    }),
    "utf-8",
  );

  expect(isClutchConfigured(paths)).toBe(false);
  expect(() => resolveConfiguredLlmModel("primary", paths)).toThrow(
    "missing dynamic model metadata",
  );
});

test("malformed settings fail loudly", async () => {
  const paths = await createTempConfigPaths();
  await writeFile(paths.settingsPath, "{not json", "utf-8");

  expect(() => isClutchConfigured(paths)).toThrow(
    /Clutch settings file could not be read/,
  );
});
