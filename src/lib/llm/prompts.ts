import { readFileSync } from "node:fs";

export const defaultSystemPrompt = readPrompt("system/default.md");

export const askCommandPromptDirective = readPrompt("commands/ask.md");
export const addCommandPromptDirective = readPrompt("commands/add.md");
export const createCommandPromptDirective = readPrompt("commands/create.md");
export const findCommandPromptDirective = readPrompt("commands/find.md");
export const editCommandPromptDirective = readPrompt("commands/edit.md");
export const shellCommandPromptDirective = readPrompt("commands/cmd.md");

export const contextItemSummarySystemPrompt = readPrompt(
  "context-summary/system.md",
);

const ADD_CONTEXT_FILES_TOOL_NAME = "add_context_files";
const CREATE_FILE_TOOL_NAME = "create_file";
const FIND_RELEVANT_FILES_TOOL_NAME = "find_relevant_files";
const APPLY_PATCH_TOOL_NAME = "apply_patch";
const DEFAULT_PATCH_AWARE_TOOL_NAMES = [
  ADD_CONTEXT_FILES_TOOL_NAME,
  CREATE_FILE_TOOL_NAME,
  FIND_RELEVANT_FILES_TOOL_NAME,
  APPLY_PATCH_TOOL_NAME,
  "run_shell_command",
] as const;

export const patchAwareSystemPrompt = buildPatchAwareSystemPrompt();

export function buildPatchAwareSystemPrompt({
  toolNames = DEFAULT_PATCH_AWARE_TOOL_NAMES,
}: {
  toolNames?: readonly string[];
} = {}): string {
  const availableToolNames = new Set(toolNames);
  const hasFindTool = availableToolNames.has(FIND_RELEVANT_FILES_TOOL_NAME);
  const hasPatchTool = availableToolNames.has(APPLY_PATCH_TOOL_NAME);
  const hasCreateFileTool = availableToolNames.has(CREATE_FILE_TOOL_NAME);

  return normalizePromptSpacing(
    renderPrompt("system/patch-aware.md", {
      editScopeSection: hasPatchTool
        ? readPrompt(
            hasCreateFileTool
              ? "system/patch-aware/edit-scope-with-create-file.md"
              : "system/patch-aware/edit-scope.md",
          )
        : "",
      missingContextInstruction: readPrompt(
        hasFindTool
          ? "system/patch-aware/missing-context-with-find.md"
          : "system/patch-aware/missing-context-without-find.md",
      ),
      patchConstructionSection: hasPatchTool
        ? readPrompt("system/patch-aware/patch-construction.md")
        : "",
      workflowToolsSection:
        toolNames.length === 0
          ? ""
          : buildWorkflowToolsPromptSection({ availableToolNames }),
    }),
  );
}

function buildWorkflowToolsPromptSection({
  availableToolNames,
}: {
  availableToolNames: ReadonlySet<string>;
}): string {
  const toolInstructions: string[] = [];
  if (availableToolNames.has(FIND_RELEVANT_FILES_TOOL_NAME)) {
    toolInstructions.push(
      readPrompt("system/patch-aware/tool-find-relevant-files.md"),
    );
  }
  if (availableToolNames.has(ADD_CONTEXT_FILES_TOOL_NAME)) {
    toolInstructions.push(
      readPrompt(
        availableToolNames.has(FIND_RELEVANT_FILES_TOOL_NAME)
          ? "system/patch-aware/tool-add-context-files-with-find.md"
          : "system/patch-aware/tool-add-context-files.md",
      ),
    );
  }
  if (availableToolNames.has(CREATE_FILE_TOOL_NAME)) {
    toolInstructions.push(readPrompt("system/patch-aware/tool-create-file.md"));
  }
  if (availableToolNames.has(APPLY_PATCH_TOOL_NAME)) {
    toolInstructions.push(
      readPrompt("system/patch-aware/tool-propose-patch.md"),
    );
  }

  return normalizePromptSpacing(
    renderPrompt("system/patch-aware/workflow-tools.md", {
      toolInstructions: toolInstructions.join("\n"),
    }),
  );
}

export function renderPrompt(
  fileName: string,
  variables: Record<string, string>,
): string {
  return readPrompt(fileName).replace(
    /{{\s*([A-Za-z0-9_-]+)\s*}}/g,
    (match, key: string) => {
      const value = variables[key];
      if (value === undefined) {
        throw new Error(
          `Prompt ${fileName} references missing variable: ${key}`,
        );
      }

      return value;
    },
  );
}

function readPrompt(fileName: string): string {
  return readFileSync(
    new URL(`../../prompts/${fileName}`, import.meta.url),
    "utf8",
  ).trim();
}

function normalizePromptSpacing(prompt: string): string {
  return prompt.replace(/\n{3,}/g, "\n\n").trim();
}
