import type { AppActions } from "../../app/appTypes";
import type { LlmTool, LlmToolCall } from "../../lib/llm/types";
import type { SlashCommandRunner } from "../slashCommands/slashCommandRunners";
import type { CreateFileValidationResult } from "../../lib/createFile/createFile";
import type {
  PatchReviewState,
  PatchValidationResult,
} from "../../lib/patch/types";

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
      command: string;
      kind: "command-proposal";
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
  readonly slashCommand?: Omit<
    LlmSlashCommand,
    "allowedToolNames" | "run"
  >;
  readonly tool: LlmTool;
  handleResult(options: {
    actions: AppActions;
    requestId: number;
    result: LlmWorkflowToolResult & { responseText: string };
  }): void;
  routeToolCall(options: {
    root?: string;
    signal?: AbortSignal;
    toolCall: LlmToolCall;
  }): Promise<LlmWorkflowToolResult>;
}
