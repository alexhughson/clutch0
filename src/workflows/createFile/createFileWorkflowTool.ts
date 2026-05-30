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
