import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import {
  getClutchConfigPaths,
  loadClutchAuth,
  loadClutchSettings,
  OPENROUTER_PROVIDER_ID,
  peekClutchConfigRecoveryNotice,
  resolveConfiguredLlmModel,
  resolveConfiguredLlmRequest,
  saveClutchApiKey,
  saveClutchModelConfiguration,
} from "./clutchConfig";

async function createTempConfigPaths() {
  return getClutchConfigPaths(await mkdtemp(join(tmpdir(), "clutch-config-")));
}

test("resolve openrouter builds LlmModel and api key request", async () => {
  const paths = await createTempConfigPaths();
  saveClutchApiKey({
    apiKey: "openrouter-token",
    paths,
    provider: OPENROUTER_PROVIDER_ID,
  });
  saveClutchModelConfiguration({
    paths,
    primary: {
      model: "google/gemini-3.1-flash-lite",
      provider: OPENROUTER_PROVIDER_ID,
    },
    summarization: {
      model: "google/gemini-3.1-flash-lite",
      provider: OPENROUTER_PROVIDER_ID,
    },
  });

  const resolved = resolveConfiguredLlmModel("primary", paths);
  expect(resolved.model).toMatchObject({
    api: "openai-completions",
    baseUrl: "https://openrouter.ai/api/v1",
    id: "google/gemini-3.1-flash-lite",
    provider: OPENROUTER_PROVIDER_ID,
    reasoning: false,
    thinkingLevelMap: { xhigh: "high" },
  });
  expect(resolveConfiguredLlmRequest("primary", paths)).toEqual({
    apiKey: "openrouter-token",
    effortLevel: "low",
    model: resolved.model,
    openRouter: { serviceTier: "default" },
  });
});

test("resolves custom endpoint models with request defaults", async () => {
  const paths = await createTempConfigPaths();
  await writeFile(
    paths.settingsPath,
    JSON.stringify({
      endpoints: [
        {
          baseUrl: "https://proxy.example/v1",
          id: "work-proxy",
          label: "Work Proxy",
          headers: { "x-proxy": "1" },
          requestDefaults: { temperature: 0.2 },
        },
      ],
    }),
    "utf-8",
  );
  saveClutchApiKey({
    apiKey: "proxy-token",
    paths,
    provider: "work-proxy",
  });
  saveClutchModelConfiguration({
    paths,
    primary: {
      model: "vendor/model",
      provider: "work-proxy",
    },
    summarization: {
      model: "vendor/model",
      provider: "work-proxy",
    },
  });

  const resolved = resolveConfiguredLlmRequest("primary", paths);
  expect(resolved.model).toMatchObject({
    api: "openai-completions",
    baseUrl: "https://proxy.example/v1",
    headers: { "x-proxy": "1" },
    provider: "work-proxy",
    reasoning: false,
  });
  expect(resolved.requestDefaults).toEqual({ temperature: 0.2 });
});

test("clears legacy provider ids and oauth credentials on load", async () => {
  const paths = await createTempConfigPaths();
  await writeFile(
    paths.settingsPath,
    JSON.stringify({
      models: {
        primary: { model: "gpt-4", provider: "openai" },
      },
    }),
    "utf-8",
  );
  expect(loadClutchSettings(paths)).toEqual({});
  expect(loadClutchSettings(paths)).toEqual({});
  expect(peekClutchConfigRecoveryNotice()).toContain("Cleared incompatible config");

  await writeFile(
    paths.authPath,
    JSON.stringify({
      openai: { key: "token", type: "api_key" },
    }),
    "utf-8",
  );
  expect(loadClutchAuth(paths)).toEqual({});
  expect(loadClutchAuth(paths)).toEqual({});

  await writeFile(
    paths.authPath,
    JSON.stringify({
      openrouter: {
        access: "a",
        expires: 1,
        refresh: "r",
        type: "oauth",
      },
    }),
    "utf-8",
  );
  expect(loadClutchAuth(paths)).toEqual({});
});

test("openrouter reasoning follows capabilities snapshot", async () => {
  const paths = await createTempConfigPaths();
  saveClutchApiKey({
    apiKey: "openrouter-token",
    paths,
    provider: OPENROUTER_PROVIDER_ID,
  });
  const base = {
    model: "google/gemini-3.1-flash-lite",
    provider: OPENROUTER_PROVIDER_ID,
  } as const;

  // Without a snapshot, traits alone must not enable reasoning injection.
  saveClutchModelConfiguration({
    paths,
    primary: base,
    summarization: base,
  });
  const without = resolveConfiguredLlmRequest("primary", paths);
  expect(without.model.reasoning).toBe(false);
  const { configuredLlmRequestOptions } = await import("../llm/requestOptions");
  expect(configuredLlmRequestOptions(without).onPayload).toBeUndefined();

  // With supportsReasoning, resolve enables it and requestOptions injects.
  saveClutchModelConfiguration({
    paths,
    primary: {
      ...base,
      openRouter: {
        capabilities: {
          serviceTiers: [],
          supportsReasoning: true,
          vendors: [],
        },
      },
    },
    summarization: base,
  });
  const withCaps = resolveConfiguredLlmRequest("primary", paths);
  expect(withCaps.model.reasoning).toBe(true);
  const injected = configuredLlmRequestOptions(withCaps).onPayload?.(
    { model: withCaps.model.id, stream: true },
    withCaps.model,
  );
  expect(injected).toMatchObject({
    reasoning: { effort: "low", exclude: true },
  });
});

test("legacy supportsServiceTier boolean migrates; unsupported tier coerces to default", async () => {
  const paths = await createTempConfigPaths();
  await writeFile(
    paths.settingsPath,
    JSON.stringify({
      models: {
        primary: {
          model: "openai/gpt-5.2",
          provider: OPENROUTER_PROVIDER_ID,
          openRouter: {
            serviceTier: "priority",
            capabilities: {
              supportsReasoning: true,
              supportsServiceTier: false,
              vendors: ["openai"],
            },
          },
        },
        summarization: {
          model: "openai/gpt-5.2",
          provider: OPENROUTER_PROVIDER_ID,
        },
      },
    }),
    "utf-8",
  );
  saveClutchApiKey({
    apiKey: "openrouter-token",
    paths,
    provider: OPENROUTER_PROVIDER_ID,
  });

  const settings = loadClutchSettings(paths);
  expect(settings.models?.primary?.openRouter?.capabilities).toEqual({
    serviceTiers: [],
    supportsReasoning: true,
    vendors: ["openai"],
  });
  expect(settings.models?.primary?.openRouter?.serviceTier).toBeUndefined();
});
