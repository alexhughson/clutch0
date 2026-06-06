import { ContextDeck } from "../../app/contextDeck";
import type { AppActions, AppState } from "../../app/appTypes";
import { createMcpToolOutputContextItem } from "../../lib/context/contextItems";
import type { McpToolOutput } from "../../lib/mcp/mcpTypes";

type SetAppState = (
  partial:
    | Partial<AppState>
    | AppState
    | ((state: AppState) => Partial<AppState> | AppState),
) => void;

export function createMcpActions({
  set,
}: {
  set: SetAppState;
}): AppActions["mcp"] {
  return {
    finishToolCall: ({ output, requestId, responseText }) =>
      set((state) => finishMcpToolCall(state, requestId, output, responseText)),
  };
}

function finishMcpToolCall(
  state: AppState,
  requestId: number,
  output: McpToolOutput,
  responseText: string,
): Partial<AppState> | AppState {
  if (
    state.activeTask?.kind !== "response" ||
    state.activeTask.request.id !== requestId ||
    (state.activeTask.request.status !== "loading" &&
      state.activeTask.request.status !== "streaming")
  ) {
    return state;
  }

  const itemId = `mcp:${state.nextContextItemId}`;
  const item = createMcpToolOutputContextItem({
    createdAt: Date.now(),
    id: itemId,
    output,
    sourceRequestId: requestId,
  });

  return {
    activeTask: {
      ...state.activeTask,
      request: {
        ...state.activeTask.request,
        responseText:
          responseText.trim().length > 0
            ? responseText
            : formatMcpToolCallResponse(output, itemId),
        savedContextItemId: itemId,
        status: "done",
      },
    },
    nextContextItemId: state.nextContextItemId + 1,
    workspace: ContextDeck.fromComposeScreen(state.workspace)
      .add(item)
      .applyTo(state.workspace),
  };
}

function formatMcpToolCallResponse(
  output: McpToolOutput,
  itemId: string,
): string {
  return [
    `Called MCP tool \`${output.serverName}:${output.toolName}\`.`,
    output.isError
      ? "The tool returned an error result."
      : "The tool succeeded.",
    `Saved output to context item \`${itemId}\`.`,
  ].join("\n");
}
