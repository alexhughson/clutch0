import { Type, type Tool } from "@earendil-works/pi-ai";
import { runShellCommand } from "../../lib/shell/shellCommand";
import type { LlmWorkflowToolController } from "./types";

export const RUN_SHELL_COMMAND_TOOL_NAME = "run_shell_command";

export const runShellCommandTool: Tool = {
  name: RUN_SHELL_COMMAND_TOOL_NAME,
  description:
    "Run a shell command in the project root and save stdout/stderr as context for later use. Prefer read-only commands unless the user explicitly asks for a command with side effects.",
  parameters: Type.Object({
    command: Type.String({
      description:
        "The shell command to run from the project root. Use one concise command.",
    }),
  }),
};

export const shellCommandWorkflowTool: LlmWorkflowToolController = {
  slashCommand: {
    description:
      "Ask the LLM to choose and run a shell command, then save the output as context.",
    name: "cmd",
    promptDirective:
      "The user invoked /cmd. Decide the best single shell command for the request and call the run_shell_command tool. Prefer read-only commands unless the user explicitly requests side effects. Do not fake command output.",
    taskKind: "shell-command",
    title: "Run shell command",
  },
  enabledByDefault: false,
  tool: runShellCommandTool,
  async routeToolCall({ root, toolCall }) {
    if (toolCall.name !== RUN_SHELL_COMMAND_TOOL_NAME) {
      return null;
    }

    const command =
      typeof toolCall.arguments.command === "string"
        ? toolCall.arguments.command.trim()
        : "";

    if (command.length === 0) {
      return null;
    }

    return {
      kind: "command-output" as const,
      result: await runShellCommand({ command, root }),
    };
  },
};
