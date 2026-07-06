import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AppActions, AppState } from "../../app/appTypes";
import { createInitialAppState } from "../../app/appInitialState";
import type { McpToolRuntime } from "../../lib/mcp/mcpTypes";
import { createMcpActions } from "./mcpWorkflow";
import {
  createMcpWorkflowResources,
  loadMcpWorkflowResources,
} from "./mcpWorkflowTool";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    tempRoots
      .splice(0)
      .map((path) => rm(path, { force: true, recursive: true })),
  );
});

function createHarness() {
  let state: AppState = {
    ...createInitialAppState(),
    actions: {} as AppActions,
    activeTask: {
      kind: "response",
      request: {
        contextItems: [],
        focusedContextItemId: null,
        id: 1,
        question: "Search repositories",
        responseText: "",
        status: "loading",
      },
    },
  };

  const mcp = createMcpActions({
    set: (partial) => {
      const next = typeof partial === "function" ? partial(state) : partial;
      state = { ...state, ...next };
    },
  });

  return {
    get state() {
      return state;
    },
    mcp,
  };
}

test("MCP workflow saves tool output as a context item and finishes the response", () => {
  const harness = createHarness();

  harness.mcp.finishToolCall({
    output: {
      arguments: { query: "react" },
      contentText: "repo results",
      isError: false,
      rawResult: { content: [{ text: "repo results", type: "text" }] },
      serverName: "github",
      toolName: "search_repositories",
    },
    requestId: 1,
    responseText: "",
  });

  expect(harness.state.activeTask).toMatchObject({
    kind: "response",
    request: {
      savedContextItemId: "mcp:1",
      status: "done",
    },
  });
  expect(
    harness.state.activeTask?.kind === "response"
      ? harness.state.activeTask.request.responseText
      : "",
  ).toContain("Called MCP tool `github:search_repositories`.");
  expect(harness.state.workspace.contextItems).toHaveLength(1);
  const item = harness.state.workspace.contextItems[0];
  expect(item?.id).toBe("mcp:1");
  expect(item?.getSummaryView().title).toBe("MCP github: search_repositories");
});

test("MCP workflow resources expose runtime cleanup", async () => {
  let closeCount = 0;
  const runtime: McpToolRuntime = {
    async callTool() {
      throw new Error("not used");
    },
    close() {
      closeCount += 1;
    },
    async listTools() {
      return [];
    },
  };
  const resources = createMcpWorkflowResources({ runtime, tools: [] });

  await resources.close?.();

  expect(closeCount).toBe(1);
});

test("MCP resource loading publishes cleanup before direct tool discovery", async () => {
  const root = await tempDir("clutch-mcp-workflow-");
  await writeFile(
    join(root, ".mcp.json"),
    `${JSON.stringify({
      settings: { directTools: true },
      mcpServers: { slow: { command: "slow-mcp" } },
    })}\n`,
    "utf8",
  );
  let closeReady = false;
  const runtime: McpToolRuntime = {
    async callTool() {
      throw new Error("not used");
    },
    close() {},
    async listTools() {
      expect(closeReady).toBe(true);
      return [];
    },
  };

  await loadMcpWorkflowResources({
    onCloseReady: () => {
      closeReady = true;
    },
    root,
    runtime,
  });

  expect(closeReady).toBe(true);
});

async function tempDir(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix));
  tempRoots.push(path);
  return path;
}
