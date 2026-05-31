import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import {
  getClutchConfigPaths,
  getDefaultClutchModelId,
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

test("saves model settings separately from API credentials", async () => {
  const paths = await createTempConfigPaths();
  const primaryModel = getDefaultClutchModelId({
    provider: "openai",
    role: "primary",
  });
  const summarizationModel = getDefaultClutchModelId({
    provider: "openai",
    role: "summarization",
  });

  saveClutchConfiguration({
    apiKey: "secret-token",
    paths,
    primaryModel,
    provider: "openai",
    summarizationModel,
  });

  const settingsText = await readFile(paths.settingsPath, "utf-8");
  const auth = loadClutchAuth(paths);
  expect(settingsText).toContain(primaryModel);
  expect(settingsText).not.toContain("secret-token");
  expect(auth.openai?.key).toBe("secret-token");
  expect(isClutchConfigured(paths)).toBe(true);
});

test("resolves primary and summarization models independently", async () => {
  const paths = await createTempConfigPaths();
  const primaryModel = getDefaultClutchModelId({
    provider: "openai",
    role: "primary",
  });
  const summarizationModel = getDefaultClutchModelId({
    provider: "openai",
    role: "summarization",
  });

  saveClutchConfiguration({
    apiKey: "secret-token",
    paths,
    primaryModel,
    provider: "openai",
    summarizationModel,
  });

  expect(resolveConfiguredLlmModel("primary", paths).model.id).toBe(
    primaryModel,
  );
  expect(resolveConfiguredLlmModel("summarization", paths).model.id).toBe(
    summarizationModel,
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
  const primaryModel = getDefaultClutchModelId({
    provider: "openai",
    role: "primary",
  });
  const summarizationModel = getDefaultClutchModelId({
    provider: "openrouter",
    role: "summarization",
  });

  saveClutchModelConfiguration({
    paths,
    primary: { model: primaryModel, provider: "openai" },
    summarization: {
      model: summarizationModel,
      provider: "openrouter",
    },
  });

  expect(resolveConfiguredLlmModel("primary", paths).apiKey).toBe(
    "openai-token",
  );
  expect(resolveConfiguredLlmModel("summarization", paths).apiKey).toBe(
    "openrouter-token",
  );
  expect(isClutchConfigured(paths)).toBe(true);
});

test("requires credentials for the configured provider", async () => {
  const paths = await createTempConfigPaths();
  const primaryModel = getDefaultClutchModelId({
    provider: "openai",
    role: "primary",
  });
  const summarizationModel = getDefaultClutchModelId({
    provider: "openai",
    role: "summarization",
  });

  expect(() =>
    saveClutchConfiguration({
      paths,
      primaryModel,
      provider: "openai",
      summarizationModel,
    }),
  ).toThrow('Missing Clutch API key for provider "openai".');
});

test("malformed settings fail loudly", async () => {
  const paths = await createTempConfigPaths();
  await writeFile(paths.settingsPath, "{not json", "utf-8");

  expect(() => isClutchConfigured(paths)).toThrow(
    /Clutch settings file could not be read/,
  );
});
