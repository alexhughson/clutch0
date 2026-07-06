import type { ContextItem } from "../../types";
import { getLlmWorkflowTools } from "../../workflows/llmTools/toolRegistry";
import { buildLlmContext, type BuiltLlmContext } from "./context";
import { buildPatchAwareSystemPrompt, renderPrompt } from "./prompts";

export type BuildLlmInteractionContextOptions = {
  allowedToolNames?: readonly string[];
  commandDirective?: string;
  contextItems: readonly ContextItem[];
  focusedContextItemId?: string | null;
  question: string;
  root?: string;
};

export async function buildLlmInteractionContext({
  allowedToolNames,
  commandDirective,
  contextItems,
  focusedContextItemId,
  question,
  root,
}: BuildLlmInteractionContextOptions): Promise<BuiltLlmContext> {
  const tools = getLlmWorkflowTools({ allowedToolNames });

  return await buildLlmContext({
    question: formatQuestionForCommand({ commandDirective, question }),
    contextItems,
    focusedContextItemId,
    root,
    systemPrompt: buildPatchAwareSystemPrompt({
      toolNames: tools.map((tool) => tool.name),
    }),
    tools,
  });
}

export function formatQuestionForCommand({
  commandDirective,
  question,
}: {
  commandDirective?: string;
  question: string;
}): string {
  if (commandDirective === undefined) {
    return question;
  }

  return renderPrompt("context/command-user-message.md", {
    commandDirective,
    question,
  });
}
