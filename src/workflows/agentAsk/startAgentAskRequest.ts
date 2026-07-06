import { assembleLlmContextInput } from "../../lib/llm/context";
import { createRuntimeAbortHandle } from "../../lib/session/runtimeInterrupts";
import { useAppStore } from "../../store/appStore";
import type { ComposerState } from "../../app/appTypes";
import type { AgentAskMode } from "../../types";
import { startAgentAskSession } from "./agentAskSessionRegistry";
import { formatAgentSkillSlashCommandName } from "./agentSkillCommand";

export function startAgentAskRequest(
  prompt: string,
  {
    mode = "ask",
    rejectComposer,
    skillName,
  }: {
    mode?: AgentAskMode;
    rejectComposer?: ComposerState;
    skillName?: string;
  } = {},
) {
  const state = useAppStore.getState();
  const { contextItems, focusedContextItemId } = assembleLlmContextInput({
    automaticContextItems: state.workspace.automaticContextItems,
    contextItems: state.workspace.contextItems,
    focusedContextItemId: state.workspace.focusedContextItemId,
  });
  const itemId = state.actions.agentAsk.start({
    mode,
    prompt: formatAgentAskDisplayPrompt({ prompt, skillName }),
    rejectComposer,
  });
  if (itemId === null) {
    return;
  }

  const abortHandle = createRuntimeAbortHandle();
  void startAgentAskSession({
    contextItems,
    focusedContextItemId,
    itemId,
    mode,
    prompt,
    signal: abortHandle.signal,
    skillName,
  }).finally(() => {
    abortHandle.dispose();
  });
}

export function startAgentEditRequest(
  prompt: string,
  options: { rejectComposer?: ComposerState } = {},
) {
  startAgentAskRequest(prompt, { mode: "edit", ...options });
}

export function startAgentSkillRequest({
  prompt,
  rejectComposer,
  skillName,
}: {
  prompt: string;
  rejectComposer?: ComposerState;
  skillName: string;
}) {
  startAgentAskRequest(prompt, { rejectComposer, skillName });
}

function formatAgentAskDisplayPrompt({
  prompt,
  skillName,
}: {
  prompt: string;
  skillName?: string;
}): string {
  if (skillName === undefined) {
    return prompt;
  }

  const commandName = formatAgentSkillSlashCommandName(skillName);
  return prompt.trim().length === 0
    ? `/${commandName}`
    : `/${commandName} ${prompt}`;
}
