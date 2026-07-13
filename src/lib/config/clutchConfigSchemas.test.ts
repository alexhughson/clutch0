import { expect, test } from "bun:test";
import { decodeClutchAuth } from "./clutchConfigSchemas";

test("decodeClutchAuth skips unsupported auth providers", () => {
  const auth = decodeClutchAuth({
    openai: { key: "secret", type: "api_key" },
    "unknown-provider": { key: "ignored", type: "api_key" },
  });

  expect(auth).toEqual({
    openai: { key: "secret", type: "api_key" },
  });
  expect(auth).not.toHaveProperty("unknown-provider");
});

test("decodeClutchAuth round-trips extra OAuth fields", () => {
  const auth = decodeClutchAuth({
    "openai-codex": {
      access: "access-token",
      accountId: "acct-123",
      expires: 1_700_000_000_000,
      refresh: "refresh-token",
      type: "oauth",
    },
  });

  expect(auth["openai-codex"]).toEqual({
    access: "access-token",
    accountId: "acct-123",
    expires: 1_700_000_000_000,
    refresh: "refresh-token",
    type: "oauth",
  });
});

test("decodeClutchAuth normalizes api_key credentials to key and type only", () => {
  const auth = decodeClutchAuth({
    openai: {
      extra: "ignored",
      key: "secret",
      legacy: true,
      type: "api_key",
    },
  });

  expect(auth.openai).toEqual({ key: "secret", type: "api_key" });
});

test("decodeClutchAuth rejects malformed api_key credentials with path-bearing messages", () => {
  expect(() =>
    decodeClutchAuth({
      openai: { type: "api_key" },
    }),
  ).toThrow("Clutch auth credential for openai.key must be a string.");
});

test("decodeClutchAuth rejects malformed oauth credentials with path-bearing messages", () => {
  expect(() =>
    decodeClutchAuth({
      "openai-codex": {
        access: "access-token",
        expires: 1_700_000_000_000,
        type: "oauth",
      },
    }),
  ).toThrow(
    'Clutch auth credential for openai-codex with type "oauth".refresh must be a string.',
  );
});
