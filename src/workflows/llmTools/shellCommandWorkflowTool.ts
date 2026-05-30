import { Type, type Tool } from "@earendil-works/pi-ai";
import { invariant } from "../../lib/invariant";
import { shellCommandPromptDirective } from "../../lib/llm/prompts";
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
  resultKind: "command-output",
  slashCommand: {
    description:
      "Ask the LLM to choose and run a shell command, then save the output as context.",
    name: "cmd",
    promptDirective: shellCommandPromptDirective,
    taskKind: "shell-command",
    title: "Run shell command",
  },
  enabledByDefault: true,
  tool: runShellCommandTool,
  handleResult({ actions, requestId, result }) {
    invariant(
      result.kind === "command-output",
      `run_shell_command cannot handle ${result.kind} results`,
    );
    actions.shellCommand.finish({
      requestId,
      result: result.result,
    });
  },
  async routeToolCall({ root, toolCall }) {
    invariant(
      toolCall.name === RUN_SHELL_COMMAND_TOOL_NAME,
      `run_shell_command routed unexpected tool ${toolCall.name}`,
    );
    invariant(
      typeof toolCall.arguments.command === "string" &&
        toolCall.arguments.command.trim().length > 0,
      "run_shell_command.command must be a non-empty string.",
    );

    return {
      kind: "command-output" as const,
      result: await runShellCommand({
        command: toolCall.arguments.command.trim(),
        root,
      }),
    };
  },
};
