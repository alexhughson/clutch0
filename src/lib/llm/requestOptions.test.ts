import { expect, test } from "bun:test";
import type { Api, Model } from "@earendil-works/pi-ai";
import { maxOutputTokensForModel } from "./requestOptions";

function modelFixture(provider: string, maxTokens: number): Model<Api> {
  return {
    api: "openai-completions",
    baseUrl: "https://example.test/v1",
    contextWindow: 128_000,
    cost: { cacheRead: 0, cacheWrite: 0, input: 0, output: 0 },
    id: "model",
    input: ["text"],
    maxTokens,
    name: "Model",
    provider,
    reasoning: false,
  };
}

test("caps Cerebras output tokens below account token-per-minute limits", () => {
  expect(maxOutputTokensForModel(modelFixture("cerebras", 32_000))).toBe(4_096);
  expect(maxOutputTokensForModel(modelFixture("cerebras", 1_024))).toBe(1_024);
});

test("leaves other providers to their model defaults", () => {
  expect(maxOutputTokensForModel(modelFixture("openai", 32_000))).toBe(
    undefined,
  );
});
