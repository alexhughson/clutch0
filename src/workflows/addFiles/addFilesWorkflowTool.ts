import { Type, type Tool, type ToolCall } from "@earendil-works/pi-ai";
import { validateExistingContextFilePaths } from "../../lib/context/contextFilePaths";
import { invariant } from "../../lib/invariant";
import { addCommandPromptDirective } from "../../lib/llm/prompts";
import type { FilePath } from "../../types";
import type { LlmWorkflowToolController } from "../llmTools/types";

export const ADD_CONTEXT_FILES_TOOL_NAME = "add_context_files";

export const addContextFilesTool: Tool = {
  name: ADD_CONTEXT_FILES_TOOL_NAME,
  description:
    "Add one or more existing project files to the user's selected context. Use this when specific files are needed in context before answering or editing.",
  parameters: Type.Object({
    paths: Type.Array(Type.String(), {
      description:
        "Existing file paths to add, relative to the working directory. Include all files in one tool call.",
    }),
  }),
};

export const addFilesWorkflowTool: LlmWorkflowToolController = {
  resultKind: "add-files",
  slashCommand: {
    description: "Ask the LLM to choose files and add them to context.",
    name: "add",
    promptDirective: addCommandPromptDirective,
    title: "Add files to context",
  },
  tool: addContextFilesTool,
  handleResult({ actions, requestId, result }) {
    invariant(
      result.kind === "add-files",
      `add_context_files cannot handle ${result.kind} results`,
    );

    actions.addFiles.addToContext({ paths: result.paths });
    actions.response.finish({
      requestId,
      responseKind: "text",
      responseText:
        result.responseText.trim().length > 0
          ? result.responseText
          : formatAddedFilesResponse(result.paths),
    });
  },
  async routeToolCall({ root, toolCall }) {
    invariant(
      toolCall.name === ADD_CONTEXT_FILES_TOOL_NAME,
      `add_context_files routed unexpected tool ${toolCall.name}`,
    );

    return {
      kind: "add-files" as const,
      paths: await validateExistingContextFilePaths({
        paths: addFilesRequestFromToolCall(toolCall),
        root,
      }),
    };
  },
};

function addFilesRequestFromToolCall(toolCall: ToolCall): string[] {
  const arguments_ = toolCall.arguments;
  invariant(
    Array.isArray(arguments_.paths),
    "add_context_files.paths must be an array.",
  );
  invariant(
    arguments_.paths.every((path) => typeof path === "string"),
    "add_context_files.paths must contain only strings.",
  );

  return arguments_.paths;
}

function formatAddedFilesResponse(paths: readonly FilePath[]): string {
  return `Added files to context:\n${paths.map((path) => `- ${path}`).join("\n")}`;
}
