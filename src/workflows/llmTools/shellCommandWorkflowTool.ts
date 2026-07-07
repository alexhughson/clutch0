import { Type, type Tool } from "@earendil-works/pi-ai";
import { invariant } from "../../lib/invariant";
import { shellCommandPromptDirective } from "../../lib/llm/prompts";
import {
  isImplicitApplyPatchShellCommand,
  parseApplyPatchShellCommand,
} from "../../lib/patch/applyPatchShellCommand";
import { validatePatchProposal } from "../../lib/patch/patchEngine";
import { runShellCommand } from "../../lib/shell/shellCommand";
import { recordSessionRuntimeEvent } from "../../store/appStore";
import type { LlmWorkflowToolController } from "./types";

export const RUN_SHELL_COMMAND_TOOL_NAME = "run_shell_command";

export const runShellCommandTool: Tool = {
  name: RUN_SHELL_COMMAND_TOOL_NAME,
  description:
    "Run one project-root shell command and save stdout/stderr as context.",
  parameters: Type.Object({
    command: Type.String({
      description: "One concise command.",
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

    recordSessionRuntimeEvent({ command, kind: "shell-command.started" });
    try {
      const result = await runShellCommand({ command, root, signal });
      recordSessionRuntimeEvent({
        command,
        exitCode: result.exitCode,
        kind: "shell-command.finished",
        signal: result.signal,
        timedOut: result.timedOut,
      });
      return {
        kind: "command-output" as const,
        result,
      };
    } catch (error) {
      recordSessionRuntimeEvent({
        command,
        errorMessage: error instanceof Error ? error.message : String(error),
        kind: "shell-command.failed",
      });
      throw error;
    }
  },
};
