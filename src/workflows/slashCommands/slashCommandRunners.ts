import type { ComposerState } from "../../app/appTypes";
import { validateExistingContextFilePaths } from "../../lib/context/contextFilePaths";
import { useAppStore } from "../../store/appStore";
import {
  startAgentAskRequest,
  startAgentEditRequest,
  startAgentSkillRequest,
} from "../agentAsk/startAgentAskRequest";
import { parseAgentSkillSlashCommandName } from "../agentAsk/agentSkillCommand";
import { startLlmRequest } from "../llmRequest/startLlmRequest";
import type { LlmSlashCommand, PendingLlmSlashCommand } from "../llmTools/types";
import { startShellCommandRequest } from "../shellCommand/startShellCommandRequest";
import { startShowContextRequest } from "../showContext/startShowContextRequest";

export type SlashCommandContext = {
  command: LlmSlashCommand;
  input: string;
  submittedComposer: ComposerState;
};

export type SlashCommandRunner = (
  context: SlashCommandContext,
) => void | Promise<void>;

export function runLlmSlashCommand({
  command,
  input,
  submittedComposer,
}: SlashCommandContext): void {
  startLlmRequest(input, {
    allowedToolNames:
      command.allowedToolNames.length > 0 ? command.allowedToolNames : undefined,
    commandDirective: command.promptDirective,
    patchToolMode: command.patchToolMode,
    rejectComposer: submittedComposer,
  });
}

export function runShowContextSlashCommand({
  input,
  submittedComposer,
}: SlashCommandContext): void {
  startShowContextRequest(input, {
    rejectComposer: submittedComposer,
  });
}

export function runConfigSlashCommand(): void {
  useAppStore.getState().actions.config.openSettings();
}

export function runSaySlashCommand({ input }: SlashCommandContext): void {
  useAppStore.getState().actions.say.addToContext({ text: input });
}

export function runAgentAskSlashCommand({
  input,
  submittedComposer,
}: SlashCommandContext): void {
  startAgentAskRequest(input, { rejectComposer: submittedComposer });
}

export function runAgentEditSlashCommand({
  input,
  submittedComposer,
}: SlashCommandContext): void {
  startAgentEditRequest(input, { rejectComposer: submittedComposer });
}

export function runAgentSkillSlashCommand({
  command,
  input,
  submittedComposer,
}: SlashCommandContext): void {
  startAgentSkillRequest({
    prompt: input,
    rejectComposer: submittedComposer,
    skillName: parseAgentSkillSlashCommandName(command.name),
  });
}

export function runShellCommandSlashCommand({
  command,
  input,
  submittedComposer,
}: SlashCommandContext): void {
  startShellCommandRequest(input, {
    commandDirective: command.promptDirective,
    rejectComposer: submittedComposer,
  });
}

export async function runAddSlashCommand(
  context: SlashCommandContext,
): Promise<void> {
  const paths = context.input.split(/\s+/).filter((token) => token.length > 0);
  if (paths.length > 0) {
    try {
      const validatedPaths = await validateExistingContextFilePaths({ paths });
      useAppStore.getState().actions.addFiles.addToContext({
        paths: validatedPaths,
      });
      return;
    } catch {
      // Fall through to the LLM file-selection workflow.
    }
  }

  runLlmSlashCommand(context);
}

export function runFindSlashCommand(context: SlashCommandContext): void {
  if (context.input.length > 0) {
    useAppStore.getState().actions.findFiles.showSearch({
      goal: context.input,
      hints: [],
    });
    return;
  }

  runLlmSlashCommand(context);
}

export function attachAgentSkillRunner(
  command: PendingLlmSlashCommand,
): LlmSlashCommand {
  return {
    ...command,
    allowsEmptyInput: true,
    run: runAgentSkillSlashCommand,
  };
}

export function attachLlmRunner(
  command: PendingLlmSlashCommand,
): LlmSlashCommand {
  return {
    ...command,
    run: runLlmSlashCommand,
  };
}
