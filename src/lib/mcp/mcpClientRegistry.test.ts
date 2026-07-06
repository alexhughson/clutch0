import { expect, test } from "bun:test";
import { McpClientRegistry } from "./mcpClientRegistry";

test("MCP registry rejects aborted tool calls before connecting", async () => {
  const controller = new AbortController();
  controller.abort();
  const registry = new McpClientRegistry({
    servers: [
      {
        args: [],
        debug: false,
        directTools: true,
        excludeTools: [],
        lifecycle: "lazy",
        name: "never-connect",
        command: "never-run-this-command",
      },
    ],
    settings: {
      directTools: true,
      idleTimeout: 1,
      toolPrefix: "none",
    },
  });

  await expect(
    registry.callTool({
      arguments: {},
      serverName: "never-connect",
      signal: controller.signal,
      toolName: "tool",
    }),
  ).rejects.toThrow("MCP tool call was aborted");
});
