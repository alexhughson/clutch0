import { Type, type Tool, type ToolCall } from "@earendil-works/pi-ai";
import {
  validateCreateFileProposal,
  type CreateFileProposal,
} from "../../lib/createFile/createFile";
import { invariant } from "../../lib/invariant";
import { createCommandPromptDirective } from "../../lib/llm/prompts";
import type { LlmWorkflowToolController } from "../llmTools/types";

export const CREATE_FILE_TOOL_NAME = "create_file";

export const createFileTool: Tool = {
  name: CREATE_FILE_TOOL_NAME,
  description: "Propose one new file for review. Does not write files.",
  parameters: Type.Object({
    summary: Type.String({
      description: "Concise file purpose.",
    }),
    path: Type.String({
      description: "New project-relative path.",
    }),
    content: Type.String({
      description: "Full file contents.",
    }),
  }),
};

export const createFileWorkflowTool: LlmWorkflowToolController = {
  resultKind: "create-file",
  slashCommand: {
    description: "Ask the LLM to propose a new file for review.",
    name: "create",
    promptDirective: createCommandPromptDirective,
    title: "Create file",
  },
  tool: createFileTool,
  handleResult({ actions, requestId, result }) {
    invariant(
      result.kind === "create-file",
      `create_file cannot handle ${result.kind} results`,
    );
    actions.createFile.showReview({
      requestId,
      validation: result.validation,
    });
  },
  async routeToolCall({ root, toolCall }) {
    invariant(
      toolCall.name === CREATE_FILE_TOOL_NAME,
      `create_file routed unexpected tool ${toolCall.name}`,
    );

    const proposal = createFileProposalFromToolCall(toolCall);
    return {
      kind: "create-file",
      validation: await validateCreateFileProposal({ proposal, root }),
    };
  },
};

export function createFileProposalFromToolCall(
  toolCall: ToolCall,
): CreateFileProposal {
  const arguments_ = toolCall.arguments;
  invariant(
    typeof arguments_.summary === "string",
    "create_file.summary must be a string.",
  );
  invariant(
    typeof arguments_.path === "string",
    "create_file.path must be a string.",
  );
  invariant(
    typeof arguments_.content === "string",
    "create_file.content must be a string.",
  );

  return {
    content: arguments_.content,
    path: arguments_.path,
    summary: arguments_.summary,
  };
}
