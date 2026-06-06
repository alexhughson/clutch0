import { expect, test } from "bun:test";
import { parseMergedMcpConfig } from "./mcpConfig";

test("loads and merges MCP settings and servers with interpolation", () => {
  process.env.CLUTCH_TEST_MCP_TOKEN = "secret-token";

  const config = parseMergedMcpConfig({
    rawConfigs: [
      {
        settings: {
          directTools: false,
          idleTimeout: 15,
          toolPrefix: "short",
        },
        mcpServers: {
          "github-mcp": {
            args: ["-y", "github-server"],
            command: "npx",
            env: { GITHUB_TOKEN: "${CLUTCH_TEST_MCP_TOKEN}" },
          },
        },
      },
      {
        mcpServers: {
          "github-mcp": {
            directTools: ["search_repositories"],
            excludeTools: ["delete_repository"],
          },
        },
      },
    ],
    root: "/repo",
  });

  expect(config.settings).toEqual({
    directTools: false,
    idleTimeout: 15,
    toolPrefix: "short",
  });
  expect(config.servers).toHaveLength(1);
  expect(config.servers[0]).toMatchObject({
    args: ["-y", "github-server"],
    command: "npx",
    debug: false,
    directTools: ["search_repositories"],
    env: { GITHUB_TOKEN: "secret-token" },
    excludeTools: ["delete_repository"],
    lifecycle: "lazy",
    name: "github-mcp",
  });
});

test("rejects malformed MCP config", () => {
  expect(() =>
    parseMergedMcpConfig({
      rawConfigs: [
        {
          mcpServers: {
            github: {
              args: "not-array",
              command: "npx",
            },
          },
        },
      ],
    }),
  ).toThrow("config[0].mcpServers.github.args must be an array of strings");

  expect(() =>
    parseMergedMcpConfig({
      rawConfigs: [
        {
          mcpServers: {
            github: {
              command: "npx",
              url: "https://example.test/mcp",
            },
          },
        },
      ],
    }),
  ).toThrow("cannot define both command and url");

  expect(() =>
    parseMergedMcpConfig({
      rawConfigs: [
        {
          mcpServers: {
            github: {
              directTools: true,
            },
          },
        },
      ],
    }),
  ).toThrow("must define either command or url");
});
