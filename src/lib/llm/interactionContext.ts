import type { ContextItem } from "../../types";
import { getLlmWorkflowTools } from "../../workflows/llmTools/toolRegistry";
import { buildLlmContext, type BuiltLlmContext } from "./context";
import { patchAwareSystemPrompt, renderPrompt } from "./prompts";

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
  return await buildLlmContext({
    question: formatQuestionForCommand({ commandDirective, question }),
    contextItems,
    focusedContextItemId,
    root,
    systemPrompt: patchAwareSystemPrompt,
    tools: getLlmWorkflowTools({ allowedToolNames }),
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
