import type { Tool, ToolCall } from "@earendil-works/pi-ai";
import { findFilesWorkflowTool } from "../findFiles/findFilesTool";
import { patchWorkflowTool } from "./patchWorkflowTool";
import type { LlmWorkflowToolController, LlmWorkflowToolResult } from "./types";

const workflowToolControllers: readonly LlmWorkflowToolController[] = [
  patchWorkflowTool,
  findFilesWorkflowTool,
];

export function getLlmWorkflowTools(): Tool[] {
  return workflowToolControllers.map((controller) => controller.tool);
}

export async function routeLlmWorkflowToolCalls({
  root,
  toolCalls,
}: {
  root?: string;
  toolCalls: readonly ToolCall[];
}): Promise<LlmWorkflowToolResult | null> {
  for (const toolCall of toolCalls) {
    for (const controller of workflowToolControllers) {
      const result = await controller.routeToolCall({ root, toolCall });
      if (result !== null) {
        return result;
      }
    }
  }

  return null;
}
