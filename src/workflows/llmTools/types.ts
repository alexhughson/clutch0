import type { Tool, ToolCall } from "@earendil-works/pi-ai";
import type { CreateFileValidationResult } from "../../lib/createFile/createFile";
import type { PatchValidationResult } from "../../lib/patch/types";
import type { ShellCommandResult } from "../../lib/shell/shellCommand";

export type LlmWorkflowToolResult =
  | {
      kind: "patch";
      patch: PatchValidationResult;
    }
  | {
      goal: string;
      hints: string[];
      kind: "find-files";
    }
  | {
      kind: "command-output";
      result: ShellCommandResult;
    }
  | {
      kind: "create-file";
      validation: CreateFileValidationResult;
    };

export type LlmSlashCommand = {
  readonly allowedToolNames: readonly string[];
  readonly description: string;
  readonly name: string;
  readonly promptDirective: string;
  readonly taskKind?: "agent-ask" | "shell-command" | "show-context";
  readonly title: string;
};

export interface LlmWorkflowToolController {
  readonly enabledByDefault?: boolean;
  readonly slashCommand?: Omit<LlmSlashCommand, "allowedToolNames">;
  readonly tool: Tool;
  routeToolCall(options: {
    root?: string;
    toolCall: ToolCall;
  }): Promise<LlmWorkflowToolResult | null>;
}
