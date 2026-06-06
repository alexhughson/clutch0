import { expect, test } from "bun:test";
import type { AppActions, AppState } from "../../app/appTypes";
import { createInitialAppState } from "../../app/appInitialState";
import { createMcpActions } from "./mcpWorkflow";

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
