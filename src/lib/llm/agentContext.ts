import type { ContextItem } from "../../types";
import { invariant } from "../invariant";
import { buildLlmContext } from "./context";
import { renderPrompt } from "./prompts";

const AGENT_CONTEXT_SNAPSHOT_QUESTION =
  "Use this as the starting context for the delegated agent session.";

export async function buildAgentPromptWithContext({
  contextItems,
  focusedContextItemId,
  prompt,
  root = process.cwd(),
}: {
  contextItems: readonly ContextItem[];
  focusedContextItemId: string | null;
  prompt: string;
  root?: string;
}): Promise<string> {
  const context = await buildAgentContextSnapshot({
    contextItems,
    focusedContextItemId,
    root,
  });

  return renderPrompt("agents/session-context.md", {
    context,
    prompt,
  });
}

export async function buildAgentContextSnapshot({
  contextItems,
  focusedContextItemId,
  root = process.cwd(),
}: {
  contextItems: readonly ContextItem[];
  focusedContextItemId: string | null;
  root?: string;
}): Promise<string> {
  const built = await buildLlmContext({
    contextItems,
    focusedContextItemId,
    question: AGENT_CONTEXT_SNAPSHOT_QUESTION,
    root,
  });
  const message = built.context.messages[0];
  invariant(
    message !== undefined,
    "Agent context snapshot has no user message.",
  );
  invariant(
    message.role === "user" && typeof message.content === "string",
    "Agent context snapshot user message must be text.",
  );

  return message.content;
}
