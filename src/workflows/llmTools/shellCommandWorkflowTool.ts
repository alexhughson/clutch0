import { invariant } from "../../lib/invariant";
import { shellCommandPromptDirective } from "../../lib/llm/prompts";
import type { LlmTool } from "../../lib/llm/types";
import {
  isImplicitApplyPatchShellCommand,
  parseApplyPatchShellCommand,
} from "../../lib/patch/applyPatchShellCommand";
import { validatePatchProposal } from "../../lib/patch/patchEngine";
import type { LlmWorkflowToolController } from "./types";

export const RUN_SHELL_COMMAND_TOOL_NAME = "run_shell_command";

export const runShellCommandTool: LlmTool = {
  name: RUN_SHELL_COMMAND_TOOL_NAME,
  description:
    "Propose one project-root shell command for user approval before running.",
  parameters: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "One concise command.",
      },
    },
    required: ["command"],
  },
};

export const shellCommandWorkflowTool: LlmWorkflowToolController = {
  resultKind: "command-proposal",
  slashCommand: {
    description:
      "Ask the LLM to choose a shell command, then approve and run it.",
    name: "cmd",
    promptDirective: shellCommandPromptDirective,
    title: "Run shell command",
  },
  enabledByDefault: true,
  tool: runShellCommandTool,
  handleResult({ actions, requestId, result }) {
    invariant(
      result.kind === "command-proposal",
      `run_shell_command cannot handle ${result.kind} results`,
    );
    actions.shellCommand.propose({
      command: result.command,
      requestId,
    });
  },
  async routeToolCall({ root, signal, toolCall }) {
    invariant(
      toolCall.name === RUN_SHELL_COMMAND_TOOL_NAME,
      `run_shell_command routed unexpected tool ${toolCall.name}`,
    );
    invariant(
      typeof toolCall.arguments.command === "string" &&
        toolCall.arguments.command.trim().length > 0,
      "run_shell_command.command must be a non-empty string.",
    );

    const command = toolCall.arguments.command.trim();
    const patch = parseApplyPatchShellCommand(command);
    if (patch !== null) {
      return {
        kind: "patch" as const,
        patch: await validatePatchProposal({
          proposal: {
            patch,
            summary: "Apply patch from shell command",
            toolCallId: toolCall.id.split("|")[0] ?? toolCall.id,
          },
          root,
        }),
      };
    }
    if (isImplicitApplyPatchShellCommand(command)) {
      return {
        kind: "patch" as const,
        patch: {
          errors: [
            {
              editIndex: 0,
              message:
                'patch detected without explicit call to apply_patch. Rerun as ["apply_patch", "<patch>"]',
              path: "",
            },
          ],
          proposal: {
            patch: command,
            summary: "Invalid implicit apply_patch shell command",
            toolCallId: toolCall.id.split("|")[0] ?? toolCall.id,
          },
          status: "invalid" as const,
        },
      };
    }

    return {
      command,
      kind: "command-proposal" as const,
    };
  },
};
