import { validateExistingContextFilePaths } from "../../lib/context/contextFilePaths";
import { invariant } from "../../lib/invariant";
import { addCommandPromptDirective } from "../../lib/llm/prompts";
import type { LlmTool, LlmToolCall } from "../../lib/llm/types";
import type { FilePath } from "../../types";
import type { LlmWorkflowToolController } from "../llmTools/types";

export const ADD_CONTEXT_FILES_TOOL_NAME = "add_context_files";

export const addContextFilesTool: LlmTool = {
  name: ADD_CONTEXT_FILES_TOOL_NAME,
  description:
    "Add exact existing project files to selected context. Use only when paths are known.",
  parameters: {
    type: "object",
    properties: {
      paths: {
        type: "array",
        items: { type: "string" },
        description: "Existing project-relative file paths.",
      },
    },
    required: ["paths"],
  },
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

function addFilesRequestFromToolCall(toolCall: LlmToolCall): string[] {
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
