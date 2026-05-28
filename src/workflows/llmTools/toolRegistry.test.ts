import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import type { ToolCall } from "@earendil-works/pi-ai";
import { PROPOSE_PATCH_TOOL_NAME } from "../../lib/llm/patchTool";
import { FIND_RELEVANT_FILES_TOOL_NAME } from "../findFiles/findFilesTool";
import { CREATE_FILE_TOOL_NAME } from "../createFile/createFileWorkflowTool";
import { RUN_SHELL_COMMAND_TOOL_NAME } from "./shellCommandWorkflowTool";
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

test("routes create file tool calls to the create file workflow", async () => {
  const root = await mkdtemp(join(tmpdir(), "clutch-create-file-"));
  const result = await routeLlmWorkflowToolCalls({
    root,
    toolCalls: [
      {
        type: "toolCall",
        id: "tool-1",
        name: CREATE_FILE_TOOL_NAME,
        arguments: {
          content: "export const value = 1;\n",
          path: "src/newFile.ts",
          summary: "Add new file",
        },
      } satisfies ToolCall,
    ],
  });

  expect(result).toEqual({
    kind: "create-file",
    validation: {
      proposal: {
        content: "export const value = 1;\n",
        path: "src/newFile.ts",
        summary: "Add new file",
      },
      status: "valid",
    },
  });
});

test("routes shell command tool calls and captures output", async () => {
  const result = await routeLlmWorkflowToolCalls({
    allowedToolNames: [RUN_SHELL_COMMAND_TOOL_NAME],
    toolCalls: [
      {
        type: "toolCall",
        id: "tool-1",
        name: RUN_SHELL_COMMAND_TOOL_NAME,
        arguments: {
          command: "printf clutch-cmd",
        },
      } satisfies ToolCall,
    ],
  });

  expect(result).toMatchObject({
    kind: "command-output",
    result: {
      command: "printf clutch-cmd",
      exitCode: 0,
      stdout: "clutch-cmd",
    },
  });
});

test("does not expose shell commands to unrestricted LLM requests", async () => {
  expect(getLlmWorkflowTools().map((tool) => tool.name)).not.toContain(
    RUN_SHELL_COMMAND_TOOL_NAME,
  );

  const result = await routeLlmWorkflowToolCalls({
    toolCalls: [
      {
        type: "toolCall",
        id: "tool-1",
        name: RUN_SHELL_COMMAND_TOOL_NAME,
        arguments: {
          command: "printf clutch-cmd",
        },
      } satisfies ToolCall,
    ],
  });

  expect(result).toBeNull();
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
    "agent-ask",
    "show-context",
    "create",
    "find",
    "edit",
    "cmd",
  ]);
  expect(
    commands.find((command) => command.name === "ask")?.allowedToolNames,
  ).toEqual([]);
  expect(
    commands.find((command) => command.name === "show-context")
      ?.allowedToolNames,
  ).toEqual([]);
  expect(
    commands.find((command) => command.name === "create")?.allowedToolNames,
  ).toEqual([CREATE_FILE_TOOL_NAME]);
  expect(
    commands.find((command) => command.name === "edit")?.allowedToolNames,
  ).toEqual([PROPOSE_PATCH_TOOL_NAME]);
  expect(
    commands.find((command) => command.name === "find")?.allowedToolNames,
  ).toEqual([FIND_RELEVANT_FILES_TOOL_NAME]);
  expect(
    commands.find((command) => command.name === "cmd")?.allowedToolNames,
  ).toEqual([RUN_SHELL_COMMAND_TOOL_NAME]);
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
