import type {
  ContextItemAction,
  ContextItemDetailView,
  ContextItemSummarizationInput,
  ContextItemSummaryView,
  FormattedContextItem,
  FormatContextItemForLlmOptions,
} from "../../../types";
import type { ContextItemDefinition } from "../contextItemDefinition";
import type { ShellCommandOutputContextItem } from "../contextItemTypes";
import {
  openContextItemAction,
  removeContextItemAction,
  rerunShellCommandAction,
} from "../contextItemActions";
import {
  formatAttributes,
  formatShellCommandOutput,
  getGeneratedSummaryView,
  hashContent,
  MAX_CONTEXT_ITEM_SUMMARY_CHARACTERS,
  MAX_SAVED_CONTEXT_CHARACTERS,
  summarize,
  truncateContent,
} from "../contextItemFormatting";

export const shellCommandOutputContextItemDefinition: ContextItemDefinition<"shell-command-output"> =
  {
    getSummaryView(
      item: ShellCommandOutputContextItem,
    ): ContextItemSummaryView {
      return getGeneratedSummaryView(item.summaryState, {
        detail: summarize(formatShellCommandOutput(item.result)),
        title: `Command: ${summarize(item.result.command)}`,
      });
    },

    getActions(
      item: ShellCommandOutputContextItem,
    ): readonly ContextItemAction[] {
      return [
        openContextItemAction(item.id),
        rerunShellCommandAction({
          command: item.result.command,
          replaceContextItemId: item.id,
        }),
        removeContextItemAction(item.id),
      ];
    },

    async getSummarizationInput(
      item: ShellCommandOutputContextItem,
    ): Promise<ContextItemSummarizationInput> {
      const sourceText = `Command:\n${truncateContent(item.result.command, MAX_CONTEXT_ITEM_SUMMARY_CHARACTERS)}\n\nOutput:\n${truncateContent(formatShellCommandOutput(item.result), MAX_CONTEXT_ITEM_SUMMARY_CHARACTERS)}`;

      return {
        content: sourceText,
        itemId: item.id,
        label: `Command: ${summarize(item.result.command)}`,
        sourceHash: hashContent(sourceText),
        type: item.type,
      };
    },

    async getDetailView(
      item: ShellCommandOutputContextItem,
    ): Promise<ContextItemDetailView> {
      return {
        content: formatShellCommandOutput(item.result),
        kind: "text" as const,
        title: `Command: ${summarize(item.result.command)}`,
      };
    },

    async formatForLlm(
      item: ShellCommandOutputContextItem,
      { focused }: FormatContextItemForLlmOptions,
    ): Promise<FormattedContextItem> {
      return {
        consumedFileCharacters: 0,
        text: `<shell_command${formatAttributes({ focused, source_request_id: item.sourceRequestId, created_at: new Date(item.createdAt).toISOString(), exit_code: item.result.exitCode ?? "signal", signal: item.result.signal })}>\n<command>\n${truncateContent(item.result.command, MAX_SAVED_CONTEXT_CHARACTERS)}\n</command>\n<output>\n${truncateContent(formatShellCommandOutput(item.result), MAX_SAVED_CONTEXT_CHARACTERS)}\n</output>\n</shell_command>`,
      };
    },
  };
