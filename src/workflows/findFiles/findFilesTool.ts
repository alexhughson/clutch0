import { Type, type Tool, type ToolCall } from "@earendil-works/pi-ai";
import type { LlmWorkflowToolController } from "../llmTools/types";

export const FIND_RELEVANT_FILES_TOOL_NAME = "find_relevant_files";

export const findRelevantFilesTool: Tool = {
  name: FIND_RELEVANT_FILES_TOOL_NAME,
  description:
    "Ask Clutch to search the project for files relevant to the user's request. Use this when the selected context is missing, likely incomplete, or the user asks about code but has not provided enough files. This opens an interactive file-picking workflow for the user; do not answer with guessed file names.",
  parameters: Type.Object({
    goal: Type.String({
      description:
        "What the file search agent should look for, phrased as a concrete code-navigation goal.",
    }),
    hints: Type.Optional(
      Type.Array(Type.String(), {
        description:
          "Optional symbols, directories, error messages, or feature names that may help find relevant files.",
      }),
    ),
  }),
};

export const findFilesWorkflowTool: LlmWorkflowToolController = {
  slashCommand: {
    description:
      "Ask the LLM to find project files relevant to a goal, then open the interactive file picker.",
    name: "find",
    promptDirective:
      "The user invoked /find. Decide the best arguments from the user request and call the find_relevant_files tool. Do not answer with guessed file names.",
    title: "Find relevant files",
  },
  tool: findRelevantFilesTool,
  async routeToolCall({ toolCall }) {
    if (toolCall.name !== FIND_RELEVANT_FILES_TOOL_NAME) {
      return null;
    }

    return normalizeFindFilesToolCall(toolCall);
  },
};

function normalizeFindFilesToolCall(toolCall: ToolCall) {
  return {
    goal:
      typeof toolCall.arguments.goal === "string"
        ? toolCall.arguments.goal
        : "Find files relevant to the user's request.",
    hints: Array.isArray(toolCall.arguments.hints)
      ? toolCall.arguments.hints.filter(
          (hint): hint is string => typeof hint === "string",
        )
      : [],
    kind: "find-files" as const,
  };
}
