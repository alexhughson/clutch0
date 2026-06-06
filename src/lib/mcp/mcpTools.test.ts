import { expect, test } from "bun:test";
import { loadDirectMcpTools } from "./mcpTools";
import type { McpToolRuntime, ResolvedMcpConfig } from "./mcpTypes";

test("loads only direct MCP tools and applies prefixing", async () => {
  const runtime = createFakeRuntime();
  const config: ResolvedMcpConfig = {
    settings: {
      directTools: false,
      idleTimeout: 10,
      toolPrefix: "short",
    },
    servers: [
      {
        args: ["server"],
        command: "node",
        debug: false,
        directTools: ["search_repositories", "delete_repository"],
        excludeTools: ["delete_repository"],
        lifecycle: "lazy",
        name: "github-mcp",
      },
      {
        args: ["server"],
        command: "node",
        debug: false,
        excludeTools: [],
        lifecycle: "lazy",
        name: "postgres",
      },
    ],
  };

  const tools = await loadDirectMcpTools({ config, runtime });

  expect(tools.map((tool) => tool.toolName)).toEqual([
    "mcp_github_search_repositories",
  ]);
  expect(tools[0]).toMatchObject({
    name: "search_repositories",
    serverName: "github-mcp",
    slashCommandName: "mcp:github-mcp",
    slashToolName: "mcp:github-mcp:search_repositories",
  });
});

test("global directTools exposes all server tools", async () => {
  const runtime = createFakeRuntime();
  const config: ResolvedMcpConfig = {
    settings: {
      directTools: true,
      idleTimeout: 10,
      toolPrefix: "server",
    },
    servers: [
      {
        args: ["server"],
        command: "node",
        debug: false,
        excludeTools: [],
        lifecycle: "lazy",
        name: "github",
      },
    ],
  };

  const tools = await loadDirectMcpTools({ config, runtime });

  expect(tools.map((tool) => tool.toolName)).toEqual([
    "mcp_github_search_repositories",
    "mcp_github_delete_repository",
  ]);
});

function createFakeRuntime(): McpToolRuntime {
  return {
    async callTool() {
      throw new Error("callTool should not be used in this test.");
    },
    async listTools(serverName) {
      if (serverName === "postgres") {
        return [
          {
            inputSchema: { type: "object" },
            name: "query",
            serverName,
          },
        ];
      }

      return [
        {
          description: "Search repositories.",
          inputSchema: { type: "object" },
          name: "search_repositories",
          serverName,
        },
        {
          description: "Delete a repository.",
          inputSchema: { type: "object" },
          name: "delete_repository",
          serverName,
        },
      ];
    },
  };
}
