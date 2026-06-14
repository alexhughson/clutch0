import type { Api, Model } from "@earendil-works/pi-ai";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import {
  createDefaultClutchConfigDraft,
  getClutchConfigPaths,
  isClutchConfigured,
  loadClutchAuth,
  resolveConfiguredLlmModel,
  resolveConfiguredLlmRequest,
  saveClutchApiKey,
  saveClutchConfiguration,
  saveClutchModelConfiguration,
  saveClutchOAuthCredential,
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
  const profile =
    provider === "openai-codex"
      ? {
          api: "openai-codex-responses" as const,
          baseUrl: "https://chatgpt.com/backend-api",
        }
      : provider === "cursor"
        ? {
            api: "cursor-agent" as const,
            baseUrl: "cursor-sdk://agent",
          }
        : provider === "google"
          ? {
              api: "google-generative-ai" as const,
              baseUrl: "https://generativelanguage.googleapis.com/v1beta",
            }
          : provider === "openai"
            ? {
                api: "openai-responses" as const,
                baseUrl: "https://api.openai.com/v1",
              }
            : {
                api: "openai-completions" as const,
                baseUrl: "https://openrouter.ai/api/v1",
              };

  return {
    api: profile.api,
    baseUrl: profile.baseUrl,
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
  expect(settingsText).toContain('"effortLevel": "low"');
  expect(settingsText).toContain('"serviceTier": "default"');
  expect(settingsText).not.toContain("secret-token");
  expect(auth.openai).toEqual({ key: "secret-token", type: "api_key" });
  expect(isClutchConfigured(paths)).toBe(true);
});

test("resolves primary, agent, and summarization models independently", async () => {
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
  const agent = {
    effortLevel: "high" as const,
    metadata: modelFixture({ id: "gpt-live-agent" }),
    model: "gpt-live-agent",
    provider: "openai" as const,
    serviceTier: "priority" as const,
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
  expect(resolveConfiguredLlmModel("summarization", paths).model.id).toBe(
    summarization.model,
  );
  expect(resolveConfiguredLlmModel("agent", paths).model.id).toBe(agent.model);
  expect(resolveConfiguredLlmModel("primary", paths).effortLevel).toBe("low");
  expect(resolveConfiguredLlmModel("agent", paths).effortLevel).toBe("high");
  expect(resolveConfiguredLlmModel("primary", paths).serviceTier).toBe(
    "default",
  );
  expect(resolveConfiguredLlmModel("agent", paths).serviceTier).toBe(
    "priority",
  );
  expect(resolveConfiguredLlmModel("primary", paths).credential).toEqual({
    key: "secret-token",
    type: "api_key",
  });
  await expect(resolveConfiguredLlmRequest("primary", paths)).resolves.toEqual({
    apiKey: "secret-token",
    effortLevel: "low",
    model: primary.metadata,
    serviceTier: "default",
  });
});

test("agent model falls back to primary for legacy settings", async () => {
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
  const settings = JSON.parse(await readFile(paths.settingsPath, "utf-8"));
  delete settings.models.agent;
  await writeFile(paths.settingsPath, JSON.stringify(settings), "utf-8");

  expect(resolveConfiguredLlmModel("agent", paths).model.id).toBe(
    primary.model,
  );
  expect(isClutchConfigured(paths)).toBe(true);
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

  await expect(resolveConfiguredLlmRequest("primary", paths)).resolves.toEqual({
    apiKey: "openai-token",
    effortLevel: "low",
    model: primary.metadata,
    serviceTier: "default",
  });
  await expect(
    resolveConfiguredLlmRequest("summarization", paths),
  ).resolves.toEqual({
    apiKey: "openrouter-token",
    effortLevel: "low",
    model: summarization.metadata,
    serviceTier: "default",
  });
  expect(resolveConfiguredLlmModel("primary", paths).credential).toEqual({
    key: "openai-token",
    type: "api_key",
  });
  expect(resolveConfiguredLlmModel("summarization", paths).credential).toEqual({
    key: "openrouter-token",
    type: "api_key",
  });
  expect(isClutchConfigured(paths)).toBe(true);
});

test("supports Google Gemini API key credentials", async () => {
  const paths = await createTempConfigPaths();
  saveClutchApiKey({ apiKey: "google-token", paths, provider: "google" });
  const primary = {
    metadata: modelFixture({ id: "gemini-3.5-flash", provider: "google" }),
    model: "gemini-3.5-flash",
    provider: "google" as const,
  };

  saveClutchModelConfiguration({
    paths,
    primary,
    summarization: primary,
  });

  await expect(resolveConfiguredLlmRequest("primary", paths)).resolves.toEqual({
    apiKey: "google-token",
    effortLevel: "low",
    model: primary.metadata,
    serviceTier: "default",
  });
  expect(loadClutchAuth(paths).google).toEqual({
    key: "google-token",
    type: "api_key",
  });
  expect(isClutchConfigured(paths)).toBe(true);
});

test("supports Cursor Composer as the primary model only", async () => {
  const paths = await createTempConfigPaths();
  saveClutchApiKey({ apiKey: "cursor-token", paths, provider: "cursor" });
  saveClutchApiKey({ apiKey: "openai-token", paths, provider: "openai" });
  const primary = {
    metadata: {
      ...modelFixture({ id: "composer-2.5:fast", provider: "cursor" }),
      compat: {
        cursorModelSelection: {
          id: "composer-2.5",
          params: [{ id: "speed", value: "fast" }],
        },
      },
      name: "Composer 2.5 (Fast)",
    } as Model<Api>,
    model: "composer-2.5:fast",
    provider: "cursor" as const,
  };
  const summarization = {
    metadata: modelFixture({ id: "gpt-live-summary" }),
    model: "gpt-live-summary",
    provider: "openai" as const,
  };
  const agent = {
    metadata: modelFixture({ id: "gpt-live-agent" }),
    model: "gpt-live-agent",
    provider: "openai" as const,
  };

  saveClutchModelConfiguration({
    agent,
    paths,
    primary,
    summarization,
  });

  await expect(resolveConfiguredLlmRequest("primary", paths)).resolves.toEqual({
    apiKey: "cursor-token",
    effortLevel: "low",
    model: primary.metadata,
    serviceTier: "default",
  });
  await expect(resolveConfiguredLlmRequest("agent", paths)).resolves.toEqual({
    apiKey: "openai-token",
    effortLevel: "low",
    model: agent.metadata,
    serviceTier: "default",
  });
  expect(isClutchConfigured(paths)).toBe(true);
});

test("rejects Cursor Composer for agent and summarization model roles", async () => {
  const paths = await createTempConfigPaths();
  saveClutchApiKey({ apiKey: "cursor-token", paths, provider: "cursor" });
  saveClutchApiKey({ apiKey: "openai-token", paths, provider: "openai" });
  const cursorSelection = {
    metadata: modelFixture({ id: "composer-2.5:fast", provider: "cursor" }),
    model: "composer-2.5:fast",
    provider: "cursor" as const,
  };
  const openAiSelection = {
    metadata: modelFixture({ id: "gpt-live-primary" }),
    model: "gpt-live-primary",
    provider: "openai" as const,
  };

  expect(() =>
    saveClutchModelConfiguration({
      agent: cursorSelection,
      paths,
      primary: openAiSelection,
      summarization: openAiSelection,
    }),
  ).toThrow("Cursor Composer is only supported for the Clutch primary model.");
  expect(() =>
    saveClutchModelConfiguration({
      agent: openAiSelection,
      paths,
      primary: openAiSelection,
      summarization: cursorSelection,
    }),
  ).toThrow("Cursor Composer is only supported for the Clutch primary model.");
});

test("defaults non-primary model drafts away from Cursor Composer", async () => {
  const paths = await createTempConfigPaths();
  saveClutchApiKey({ apiKey: "cursor-token", paths, provider: "cursor" });
  await writeFile(
    paths.settingsPath,
    JSON.stringify({
      models: {
        primary: {
          effortLevel: "low",
          metadata: modelFixture({
            id: "composer-2.5:fast",
            provider: "cursor",
          }),
          model: "composer-2.5:fast",
          provider: "cursor",
          serviceTier: "default",
        },
      },
    }),
    "utf-8",
  );

  const draft = createDefaultClutchConfigDraft(paths);

  expect(draft.primary.provider).toBe("cursor");
  expect(draft.agent).toMatchObject({ model: "", provider: "openai" });
  expect(draft.summarization).toMatchObject({ model: "", provider: "openai" });
});

test("normalizes saved OpenCode DeepSeek V4 metadata on resolve", async () => {
  const paths = await createTempConfigPaths();
  saveClutchApiKey({
    apiKey: "opencode-token",
    paths,
    provider: "opencode-go",
  });
  const staleMetadata = {
    ...modelFixture({ id: "deepseek-v4-flash", provider: "opencode-go" }),
    baseUrl: "https://opencode.ai/zen/go/v1",
    compat: {
      requiresReasoningContentOnAssistantMessages: true,
      thinkingFormat: "deepseek",
    },
    reasoning: true,
    thinkingLevelMap: {
      minimal: null,
      low: null,
      medium: null,
      high: "high",
      xhigh: "max",
    },
  } satisfies Model<Api>;
  const selection = {
    metadata: staleMetadata,
    model: "deepseek-v4-flash",
    provider: "opencode-go" as const,
  };

  saveClutchModelConfiguration({
    paths,
    primary: selection,
    summarization: selection,
  });

  const resolved = resolveConfiguredLlmModel("primary", paths).model;
  expect(resolved).toMatchObject({
    api: "openai-completions",
    baseUrl: "https://opencode.ai/zen/go/v1",
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
  expect(resolved.compat).not.toHaveProperty("thinkingFormat");
});

test("supports OpenAI subscription OAuth credentials", async () => {
  const paths = await createTempConfigPaths();
  saveClutchOAuthCredential({
    credential: {
      access: "subscription-access-token",
      expires: Date.now() + 60_000,
      refresh: "subscription-refresh-token",
    },
    paths,
    provider: "openai-codex",
  });
  const primary = {
    metadata: modelFixture({
      id: "gpt-5.3-codex-spark",
      provider: "openai-codex",
    }),
    model: "gpt-5.3-codex-spark",
    provider: "openai-codex" as const,
  };

  saveClutchModelConfiguration({
    paths,
    primary,
    summarization: primary,
  });

  expect(loadClutchAuth(paths)["openai-codex"]).toMatchObject({
    access: "subscription-access-token",
    refresh: "subscription-refresh-token",
    type: "oauth",
  });
  await expect(resolveConfiguredLlmRequest("primary", paths)).resolves.toEqual({
    apiKey: "subscription-access-token",
    effortLevel: "low",
    model: primary.metadata,
    serviceTier: "default",
  });
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
  ).toThrow('Missing Clutch credentials for provider "openai".');
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

test("malformed model service tier fails loudly", async () => {
  const paths = await createTempConfigPaths();
  await writeFile(
    paths.settingsPath,
    JSON.stringify({
      models: {
        primary: {
          model: "gpt-live-primary",
          provider: "openai",
          serviceTier: "turbo",
        },
      },
    }),
    "utf-8",
  );

  expect(() => isClutchConfigured(paths)).toThrow(
    "model serviceTier must be one of",
  );
});
