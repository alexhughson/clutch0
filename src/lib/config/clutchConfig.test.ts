import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import {
  createDefaultClutchConfigDraft,
  getClutchConfigPaths,
  isClutchConfigured,
  loadClutchAuth,
  loadClutchSettings,
  OPENROUTER_PROVIDER_ID,
  resolveConfiguredAgentBackend,
  resolveConfiguredLlmModel,
  resolveConfiguredLlmRequest,
  saveClutchAgentBackendConfiguration,
  saveClutchApiKey,
  saveClutchConfiguration,
  saveClutchEndpointConfiguration,
  deleteClutchEndpointConfiguration,
  saveClutchModelConfiguration,
} from "./clutchConfig";

async function createTempConfigPaths() {
  return getClutchConfigPaths(await mkdtemp(join(tmpdir(), "clutch-config-")));
}

test("saves model settings separately from API credentials", async () => {
  const paths = await createTempConfigPaths();
  const primary = {
    model: "anthropic/claude-sonnet-4",
    provider: OPENROUTER_PROVIDER_ID,
  };
  const summarization = {
    model: "google/gemini-2.5-flash",
    provider: OPENROUTER_PROVIDER_ID,
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
  expect(settingsText).not.toContain('"metadata"');
  expect(settingsText).toContain('"effortLevel": "low"');
  expect(settingsText).toContain('"serviceTier": "default"');
  expect(settingsText).not.toContain("secret-token");
  expect(auth.openrouter).toEqual({ key: "secret-token", type: "api_key" });
  expect(isClutchConfigured(paths)).toBe(true);
});

test("parses settings with endpoints and openRouter block", async () => {
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
      models: {
        primary: {
          model: "anthropic/claude-sonnet-4",
          openRouter: {
            capabilities: {
              supportsReasoning: true,
              supportsServiceTier: true,
              vendors: ["Anthropic"],
            },
            serviceTier: "priority",
            sort: "latency",
            vendor: "Anthropic",
          },
          provider: OPENROUTER_PROVIDER_ID,
        },
      },
    }),
    "utf-8",
  );

  const settings = loadClutchSettings(paths);
  expect(settings.endpoints).toHaveLength(1);
  expect(settings.models?.primary?.openRouter).toMatchObject({
    serviceTier: "priority",
    sort: "latency",
    vendor: "Anthropic",
  });
});

test("rejects legacy provider ids and oauth credentials loudly", async () => {
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
  expect(() => loadClutchSettings(paths)).toThrow(
    'Legacy provider "openai" is no longer supported. Re-run /config.',
  );

  await writeFile(
    paths.authPath,
    JSON.stringify({
      openai: { key: "token", type: "api_key" },
    }),
    "utf-8",
  );
  expect(() => loadClutchAuth(paths)).toThrow(
    'Legacy provider "openai" is no longer supported. Re-run /config.',
  );

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
  expect(() => loadClutchAuth(paths)).toThrow(
    "Legacy OAuth credentials are no longer supported. Re-run /config.",
  );
});

test("migrates legacy top-level serviceTier to openRouter.serviceTier", async () => {
  const paths = await createTempConfigPaths();
  await writeFile(
    paths.settingsPath,
    JSON.stringify({
      models: {
        primary: {
          model: "anthropic/claude-sonnet-4",
          provider: OPENROUTER_PROVIDER_ID,
          serviceTier: "priority",
        },
      },
    }),
    "utf-8",
  );

  expect(loadClutchSettings(paths).models?.primary?.openRouter).toEqual({
    capabilities: {
      supportsReasoning: false,
      supportsServiceTier: true,
      vendors: [],
    },
    serviceTier: "priority",
  });
});

test("legacy serviceTier migration seeds capabilities for request injection", async () => {
  const paths = await createTempConfigPaths();
  await writeFile(
    paths.settingsPath,
    JSON.stringify({
      models: {
        primary: {
          model: "anthropic/claude-sonnet-4",
          provider: OPENROUTER_PROVIDER_ID,
          serviceTier: "priority",
        },
        summarization: {
          model: "google/gemini-2.5-flash",
          provider: OPENROUTER_PROVIDER_ID,
        },
      },
    }),
    "utf-8",
  );
  await writeFile(
    paths.authPath,
    JSON.stringify({
      openrouter: { key: "token", type: "api_key" },
    }),
    "utf-8",
  );

  const resolved = resolveConfiguredLlmRequest("primary", paths);
  expect(resolved.openRouter?.serviceTier).toBe("priority");
  expect(resolved.openRouter?.capabilities?.supportsServiceTier).toBe(true);

  const { configuredLlmRequestOptions } = await import("../llm/requestOptions");
  const options = configuredLlmRequestOptions(resolved);
  expect(
    options.onPayload?.({ model: "model", stream: true }, resolved.model),
  ).toEqual({
    model: "model",
    service_tier: "priority",
    stream: true,
  });
});

test("openrouter reasoning requires capabilities snapshot", async () => {
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

  const resolved = resolveConfiguredLlmRequest("primary", paths);
  expect(resolved.model.reasoning).toBe(false);

  const { configuredLlmRequestOptions } = await import("../llm/requestOptions");
  const options = configuredLlmRequestOptions(resolved);
  expect(options.onPayload).toBeUndefined();
});

test("strips openRouter from non-openrouter model saves", async () => {
  const paths = await createTempConfigPaths();
  await writeFile(
    paths.settingsPath,
    JSON.stringify({
      endpoints: [
        {
          baseUrl: "https://proxy.example/v1",
          id: "work-proxy",
          label: "Work Proxy",
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
      openRouter: { serviceTier: "priority", vendor: "Anthropic" },
      provider: "work-proxy",
    },
    summarization: {
      model: "vendor/model",
      provider: "work-proxy",
    },
  });

  const settings = loadClutchSettings(paths);
  expect(settings.models?.primary?.openRouter).toBeUndefined();
});

test("resolve builds LlmModel without metadata", async () => {
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

test("resolves primary, agent, and summarization models independently", async () => {
  const paths = await createTempConfigPaths();
  const primary = {
    model: "anthropic/claude-sonnet-4",
    provider: OPENROUTER_PROVIDER_ID,
  };
  const summarization = {
    model: "google/gemini-2.5-flash",
    provider: OPENROUTER_PROVIDER_ID,
  };
  const agent = {
    effortLevel: "high" as const,
    model: "openai/gpt-4.1-mini",
    openRouter: { serviceTier: "priority" as const },
    provider: OPENROUTER_PROVIDER_ID,
  };

  saveClutchConfiguration({
    agent,
    apiKey: "secret-token",
    paths,
    primary,
    summarization,
  });

  expect(resolveConfiguredLlmModel("primary", paths).model.id).toBe(
    primary.model,
  );
  expect(resolveConfiguredLlmModel("agent", paths).model.id).toBe(agent.model);
  expect(resolveConfiguredLlmModel("agent", paths).effortLevel).toBe("high");
  expect(
    resolveConfiguredLlmModel("agent", paths).openRouter?.serviceTier,
  ).toBe("priority");
});

test("agent model falls back to primary for legacy settings", async () => {
  const paths = await createTempConfigPaths();
  saveClutchConfiguration({
    apiKey: "secret-token",
    paths,
    primary: {
      model: "anthropic/claude-sonnet-4",
      provider: OPENROUTER_PROVIDER_ID,
    },
    summarization: {
      model: "google/gemini-2.5-flash",
      provider: OPENROUTER_PROVIDER_ID,
    },
  });
  const settings = JSON.parse(await readFile(paths.settingsPath, "utf-8"));
  delete settings.models.agent;
  await writeFile(paths.settingsPath, JSON.stringify(settings), "utf-8");

  expect(resolveConfiguredLlmModel("agent", paths).model.id).toBe(
    "anthropic/claude-sonnet-4",
  );
  expect(isClutchConfigured(paths)).toBe(true);
});

test("uses cursor agent as the default ACP backend", async () => {
  const paths = await createTempConfigPaths();

  expect(resolveConfiguredAgentBackend(paths)).toEqual({
    args: ["acp"],
    command: "cursor-agent",
  });
  expect(createDefaultClutchConfigDraft(paths).agentBackend).toEqual({
    args: ["acp"],
    command: "cursor-agent",
  });
});

test("requires credentials for the configured provider", async () => {
  const paths = await createTempConfigPaths();

  expect(() =>
    saveClutchConfiguration({
      paths,
      primary: {
        model: "anthropic/claude-sonnet-4",
        provider: OPENROUTER_PROVIDER_ID,
      },
      summarization: {
        model: "google/gemini-2.5-flash",
        provider: OPENROUTER_PROVIDER_ID,
      },
    }),
  ).toThrow('Missing Clutch credentials for provider "openrouter".');
});

test("malformed settings fail loudly", async () => {
  const paths = await createTempConfigPaths();
  await writeFile(paths.settingsPath, "{not json", "utf-8");

  expect(() => isClutchConfigured(paths)).toThrow(
    /Clutch settings file could not be read/,
  );
});

test("malformed model service tier fails loudly", async () => {
  const paths = await createTempConfigPaths();
  await writeFile(
    paths.settingsPath,
    JSON.stringify({
      models: {
        primary: {
          model: "anthropic/claude-sonnet-4",
          openRouter: { serviceTier: "turbo" },
          provider: OPENROUTER_PROVIDER_ID,
        },
      },
    }),
    "utf-8",
  );

  expect(() => isClutchConfigured(paths)).toThrow(
    "model serviceTier must be one of",
  );
});

test("saves and deletes custom endpoints", async () => {
  const paths = await createTempConfigPaths();
  saveClutchEndpointConfiguration({
    apiKey: "proxy-token",
    endpoint: {
      baseUrl: "https://proxy.example/v1",
      id: "work-proxy",
      label: "Work Proxy",
      headers: { "x-proxy": "1" },
      requestDefaults: { temperature: 0.2 },
    },
    paths,
  });

  const settings = loadClutchSettings(paths);
  expect(settings.endpoints).toEqual([
    {
      baseUrl: "https://proxy.example/v1",
      headers: { "x-proxy": "1" },
      id: "work-proxy",
      label: "Work Proxy",
      requestDefaults: { temperature: 0.2 },
    },
  ]);
  expect(loadClutchAuth(paths)["work-proxy"]).toEqual({
    key: "proxy-token",
    type: "api_key",
  });

  deleteClutchEndpointConfiguration({ endpointId: "work-proxy", paths });
  expect(loadClutchSettings(paths).endpoints).toBeUndefined();
  expect(loadClutchAuth(paths)["work-proxy"]).toBeUndefined();
});

test("deleteClutchEndpointConfiguration blocks when models still use endpoint", async () => {
  const paths = await createTempConfigPaths();
  saveClutchEndpointConfiguration({
    apiKey: "proxy-token",
    endpoint: {
      baseUrl: "https://proxy.example/v1",
      id: "work-proxy",
      label: "Work Proxy",
    },
    paths,
  });
  await writeFile(
    paths.settingsPath,
    JSON.stringify({
      endpoints: [
        {
          baseUrl: "https://proxy.example/v1",
          id: "work-proxy",
          label: "Work Proxy",
        },
      ],
      models: {
        primary: { model: "vendor/model", provider: "work-proxy" },
      },
    }),
    "utf-8",
  );

  expect(() =>
    deleteClutchEndpointConfiguration({ endpointId: "work-proxy", paths }),
  ).toThrow(
    'Cannot delete endpoint "work-proxy" while primary model(s) still use it. Change those models first.',
  );
});
