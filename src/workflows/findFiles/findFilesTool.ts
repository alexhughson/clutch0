import { Type, type Tool, type ToolCall } from "@earendil-works/pi-ai";
import { invariant } from "../../lib/invariant";
import { findCommandPromptDirective } from "../../lib/llm/prompts";
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
  resultKind: "find-files",
  slashCommand: {
    description:
      "Ask the LLM to find project files relevant to a goal, then open the interactive file picker.",
    name: "find",
    promptDirective: findCommandPromptDirective,
    title: "Find relevant files",
  },
  tool: findRelevantFilesTool,
  handleResult({ actions, result }) {
    invariant(
      result.kind === "find-files",
      `find_relevant_files cannot handle ${result.kind} results`,
    );
    actions.findFiles.showSearch({
      goal: result.goal,
      hints: result.hints,
    });
  },
  async routeToolCall({ toolCall }) {
    invariant(
      toolCall.name === FIND_RELEVANT_FILES_TOOL_NAME,
      `find_relevant_files routed unexpected tool ${toolCall.name}`,
    );

    return findFilesRequestFromToolCall(toolCall);
  },
};

function findFilesRequestFromToolCall(toolCall: ToolCall) {
  const arguments_ = toolCall.arguments;
  invariant(
    typeof arguments_.goal === "string" && arguments_.goal.trim().length > 0,
    "find_relevant_files.goal must be a non-empty string.",
  );

  if (arguments_.hints !== undefined) {
    invariant(
      Array.isArray(arguments_.hints),
      "find_relevant_files.hints must be an array of strings when provided.",
    );
    invariant(
      arguments_.hints.every((hint) => typeof hint === "string"),
      "find_relevant_files.hints must contain only strings.",
    );
  }

  return {
    goal: arguments_.goal,
    hints: arguments_.hints ?? [],
    kind: "find-files" as const,
  };
}
