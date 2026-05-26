import { expect, test } from "bun:test";
import type { ToolCall } from "@earendil-works/pi-ai";
import { PROPOSE_PATCH_TOOL_NAME } from "../../lib/llm/patchTool";
import { FIND_RELEVANT_FILES_TOOL_NAME } from "../findFiles/findFilesTool";
import {
  getLlmSlashCommands,
  getLlmWorkflowTools,
  parseLlmSlashCommandInvocation,
  routeLlmWorkflowToolCalls,
} from "./toolRegistry";

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

test("restricts workflow tools by allowed tool names", () => {
  expect(
    getLlmWorkflowTools({ allowedToolNames: [] }).map((tool) => tool.name),
  ).toEqual([]);
  expect(
    getLlmWorkflowTools({
      allowedToolNames: [FIND_RELEVANT_FILES_TOOL_NAME],
    }).map((tool) => tool.name),
  ).toEqual([FIND_RELEVANT_FILES_TOOL_NAME]);
});

test("derives slash commands from workflow tools plus ask", () => {
  const commands = getLlmSlashCommands();

  expect(commands.map((command) => command.name)).toEqual([
    "ask",
    "find",
    "edit",
  ]);
  expect(
    commands.find((command) => command.name === "ask")?.allowedToolNames,
  ).toEqual([]);
  expect(
    commands.find((command) => command.name === "edit")?.allowedToolNames,
  ).toEqual([PROPOSE_PATCH_TOOL_NAME]);
  expect(
    commands.find((command) => command.name === "find")?.allowedToolNames,
  ).toEqual([FIND_RELEVANT_FILES_TOOL_NAME]);
});

test("parses known slash commands and leaves unknown commands unrestricted", () => {
  expect(parseLlmSlashCommandInvocation("/find auth routing")).toMatchObject({
    command: {
      allowedToolNames: [FIND_RELEVANT_FILES_TOOL_NAME],
      name: "find",
    },
    input: "auth routing",
  });
  expect(parseLlmSlashCommandInvocation("/wat auth routing")).toBeNull();
});
