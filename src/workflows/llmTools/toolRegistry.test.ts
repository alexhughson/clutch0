import { expect, test } from "bun:test";
import type { ToolCall } from "@earendil-works/pi-ai";
import { FIND_RELEVANT_FILES_TOOL_NAME } from "../findFiles/findFilesTool";
import { routeLlmWorkflowToolCalls } from "./toolRegistry";

test("routes find relevant files tool calls to the find files workflow", async () => {
  const result = await routeLlmWorkflowToolCalls({
    toolCalls: [
      {
        type: "toolCall",
        id: "tool-1",
        name: FIND_RELEVANT_FILES_TOOL_NAME,
        arguments: {
          goal: "Find routing code",
          hints: ["App", "screen"],
        },
      } satisfies ToolCall,
    ],
  });

  expect(result).toEqual({
    kind: "find-files",
    goal: "Find routing code",
    hints: ["App", "screen"],
  });
});
