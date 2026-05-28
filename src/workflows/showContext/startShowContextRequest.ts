import { buildLlmContext } from "../../lib/llm/context";
import { patchAwareSystemPrompt } from "../../lib/llm/prompts";
import { getLlmWorkflowTools } from "../llmTools/toolRegistry";
import { useAppStore } from "../../store/appStore";

export function startShowContextRequest(question: string) {
  const currentState = useAppStore.getState();
  const requestId = currentState.actions.showContext.start({ question });
  if (requestId === null) {
    return;
  }

  const contextItems = currentState.workspace.contextItems;
  const focusedContextItemId = currentState.workspace.focusedContextItemId;

  void buildLlmContext({
    contextItems,
    focusedContextItemId,
    question: question.length === 0 ? "(no question)" : question,
    systemPrompt: patchAwareSystemPrompt,
    tools: getLlmWorkflowTools(),
  }).then(
    ({ context }) => {
      useAppStore.getState().actions.showContext.finish({
        content: formatContextDebugView(context),
        requestId,
      });
    },
    (error: unknown) => {
      useAppStore.getState().actions.showContext.fail({
        errorMessage: error instanceof Error ? error.message : String(error),
        requestId,
      });
    },
  );
}

function formatContextDebugView(
  context: Awaited<ReturnType<typeof buildLlmContext>>["context"],
): string {
  const tools = context.tools ?? [];
  const toolText =
    tools.length === 0
      ? "No tools."
      : tools.map((tool) => `- ${tool.name}`).join("\n");
  const messages = context.messages
    .map(
      (message, index) =>
        `<message index=${index} role=${JSON.stringify(message.role)}>\n${message.content}\n</message>`,
    )
    .join("\n\n");

  return `System prompt:\n${context.systemPrompt}\n\nTools:\n${toolText}\n\nMessages:\n${messages}`;
}
