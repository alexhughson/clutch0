import { Type, type Tool, type ToolCall } from "@earendil-works/pi-ai";
import {
  validateCreateFileProposal,
  type CreateFileProposal,
} from "../../lib/createFile/createFile";
import type { LlmWorkflowToolController } from "../llmTools/types";

export const CREATE_FILE_TOOL_NAME = "create_file";

export const createFileTool: Tool = {
  name: CREATE_FILE_TOOL_NAME,
  description:
    "Propose a new file for the user to review before it is created. This only proposes creation; it does not write files.",
  parameters: Type.Object({
    summary: Type.String({
      description: "A concise summary of the proposed new file.",
    }),
    path: Type.String({
      description:
        "Path for the new file, relative to the working directory. Must not already exist.",
    }),
    content: Type.String({
      description: "The full contents to write to the new file.",
    }),
  }),
};

export const createFileWorkflowTool: LlmWorkflowToolController = {
  slashCommand: {
    description: "Ask the LLM to propose a new file for review.",
    name: "create",
    promptDirective:
      "The user invoked /create. You must call the create_file tool with a relative path and the full desired file contents. Do not call prose-only answers when you can propose the file. Do not propose overwriting an existing file; use /edit for existing files.",
    title: "Create file",
  },
  tool: createFileTool,
  async routeToolCall({ root, toolCall }) {
    if (toolCall.name !== CREATE_FILE_TOOL_NAME) {
      return null;
    }

    const proposal = getCreateFileProposalFromToolCall(toolCall);
    return {
      kind: "create-file",
      validation: await validateCreateFileProposal({ proposal, root }),
    };
  },
};

export function getCreateFileProposalFromToolCall(
  toolCall: ToolCall,
): CreateFileProposal {
  const arguments_ = toolCall.arguments;
  return {
    content: typeof arguments_.content === "string" ? arguments_.content : "",
    path: typeof arguments_.path === "string" ? arguments_.path : "",
    summary:
      typeof arguments_.summary === "string"
        ? arguments_.summary
        : "Create file",
  };
}
