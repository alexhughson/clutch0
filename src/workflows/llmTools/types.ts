import type { AppActions } from "../../app/appTypes";
import type { Tool, ToolCall } from "@earendil-works/pi-ai";
import type { SlashCommandRunner } from "../slashCommands/slashCommandRunners";
import type { CreateFileValidationResult } from "../../lib/createFile/createFile";
import type {
  PatchReviewState,
  PatchValidationResult,
} from "../../lib/patch/types";
import type { ShellCommandResult } from "../../lib/shell/shellCommand";

export type PatchToolMode = "apply" | "review";

export type LlmWorkflowToolResult =
  | {
      kind: "add-files";
      paths: string[];
    }
  | {
      applyStatus?: PatchReviewState["applyStatus"];
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
  readonly allowsEmptyInput?: boolean;
  readonly description: string;
  readonly name: string;
  readonly patchToolMode?: PatchToolMode;
  readonly promptDirective: string;
  readonly run: SlashCommandRunner;
  readonly title: string;
};

export type PendingLlmSlashCommand = Omit<LlmSlashCommand, "run">;

export interface LlmWorkflowToolController {
  readonly enabledByDefault?: boolean;
  readonly resultKind: LlmWorkflowToolResult["kind"];
  readonly runSlashCommand?: SlashCommandRunner;
  readonly slashCommand?: Omit<LlmSlashCommand, "allowedToolNames" | "run">;
  readonly tool: Tool;
  handleResult(options: {
    actions: AppActions;
    requestId: number;
    result: LlmWorkflowToolResult & { responseText: string };
  }): void;
  routeToolCall(options: {
    root?: string;
    signal?: AbortSignal;
    toolCall: ToolCall;
  }): Promise<LlmWorkflowToolResult>;
}
