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

export interface LlmWorkflowToolController {
  readonly tool: Tool;
  routeToolCall(options: {
    root?: string;
    toolCall: ToolCall;
  }): Promise<LlmWorkflowToolResult | null>;
}
