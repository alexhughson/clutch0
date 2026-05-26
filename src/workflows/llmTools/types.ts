import type { Tool, ToolCall } from "@earendil-works/pi-ai";
import type { PatchValidationResult } from "../../lib/patch/types";

export type LlmWorkflowToolResult =
  | {
      kind: "patch";
      patch: PatchValidationResult;
    }
  | {
      goal: string;
      hints: string[];
      kind: "find-files";
    };

export type LlmSlashCommand = {
  readonly allowedToolNames: readonly string[];
  readonly description: string;
  readonly name: string;
  readonly promptDirective: string;
  readonly title: string;
};

export interface LlmWorkflowToolController {
  readonly slashCommand?: Omit<LlmSlashCommand, "allowedToolNames">;
  readonly tool: Tool;
  routeToolCall(options: {
    root?: string;
    toolCall: ToolCall;
  }): Promise<LlmWorkflowToolResult | null>;
}
