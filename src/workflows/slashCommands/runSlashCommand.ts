import type { ComposerState } from "../../app/appTypes";
import {
  parseLlmSlashCommandInvocation,
  type LlmSlashCommandInvocation,
} from "../llmTools/toolRegistry";
import { startLlmRequest } from "../llmRequest/startLlmRequest";

export function canSubmitMessage(message: string): boolean {
  const trimmed = message.trim();
  if (trimmed.length === 0) {
    return false;
  }

  const invocation = parseLlmSlashCommandInvocation(trimmed);
  if (invocation === null) {
    return true;
  }

  return (
    invocation.input.length > 0 || invocation.command.allowsEmptyInput === true
  );
}

export async function runSubmittedMessage(
  message: string,
  submittedComposer: ComposerState,
): Promise<void> {
  const trimmed = message.trim();
  const invocation = parseLlmSlashCommandInvocation(trimmed);
  if (invocation === null) {
    startLlmRequest(trimmed, { rejectComposer: submittedComposer });
    return;
  }

  await runSlashCommandInvocation(invocation, submittedComposer);
}

export async function runSlashCommandInvocation(
  invocation: LlmSlashCommandInvocation,
  submittedComposer: ComposerState,
): Promise<void> {
  await invocation.command.run({
    command: invocation.command,
    input: invocation.input,
    submittedComposer,
  });
}
