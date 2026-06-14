import type { Api, Model } from "@earendil-works/pi-ai";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import {
  getClutchConfigPaths,
  saveClutchConfiguration,
  saveClutchModelConfiguration,
  saveClutchOAuthCredential,
} from "../config/clutchConfig";
import { createPiAgentModelServices } from "./piAgentSession";

function modelFixture({
  id,
  provider = "openai",
}: {
  id: string;
  provider?: string;
}): Model<Api> {
  const isOpenAiCodex = provider === "openai-codex";
  return {
    api: isOpenAiCodex ? "openai-codex-responses" : "openai-responses",
    baseUrl: isOpenAiCodex
      ? "https://chatgpt.com/backend-api"
      : "https://api.openai.com/v1",
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

test("creates pi agent model services from configured agent model", async () => {
  const paths = getClutchConfigPaths(
    await mkdtemp(join(tmpdir(), "clutch-pi-agent-")),
  );
  const agent = {
    effortLevel: "high" as const,
    metadata: modelFixture({ id: "gpt-agent" }),
    model: "gpt-agent",
    provider: "openai" as const,
  };

  saveClutchConfiguration({
    agent,
    apiKey: "agent-token",
    paths,
    primary: {
      metadata: modelFixture({ id: "gpt-primary" }),
      model: "gpt-primary",
      provider: "openai",
    },
    summarization: {
      metadata: modelFixture({ id: "gpt-summary" }),
      model: "gpt-summary",
      provider: "openai",
    },
  });

  const services = createPiAgentModelServices({ paths });

  expect(services.model.id).toBe("gpt-agent");
  expect(services.thinkingLevel).toBe("high");
  expect(services.modelRegistry.hasConfiguredAuth(services.model)).toBe(true);
  await expect(services.authStorage.getApiKey("openai")).resolves.toBe(
    "agent-token",
  );
});

test("creates pi agent model services from OpenAI subscription auth", async () => {
  const paths = getClutchConfigPaths(
    await mkdtemp(join(tmpdir(), "clutch-pi-agent-")),
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
  const agent = {
    metadata: modelFixture({
      id: "gpt-5.3-codex-spark",
      provider: "openai-codex",
    }),
    model: "gpt-5.3-codex-spark",
    provider: "openai-codex" as const,
  };

  saveClutchModelConfiguration({
    agent,
    paths,
    primary: agent,
    summarization: agent,
  });

  const services = createPiAgentModelServices({ paths });

  expect(services.model.id).toBe("gpt-5.3-codex-spark");
  expect(services.thinkingLevel).toBe("low");
  expect(services.modelRegistry.hasConfiguredAuth(services.model)).toBe(true);
  await expect(services.authStorage.getApiKey("openai-codex")).resolves.toBe(
    "subscription-access-token",
  );
});
