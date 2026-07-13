import type {
  ContextItemAction,
  ContextItemDetailView,
  ContextItemSummarizationInput,
  ContextItemSummaryView,
  FormattedContextItem,
  FormatContextItemForLlmOptions,
} from "../../../types";
import {
  openContextItemAction,
  removeContextItemAction,
  rerunPromptAction,
} from "../contextItemActions";
import type { ContextItemDefinition } from "../contextItemDefinition";
import {
  formatAttributes,
  getGeneratedSummaryView,
  hashContent,
  MAX_CONTEXT_ITEM_SUMMARY_CHARACTERS,
  MAX_SAVED_CONTEXT_CHARACTERS,
  summarize,
  truncateContent,
} from "../contextItemFormatting";

export const savedLlmResponseContextItemDefinition: ContextItemDefinition<"llm-response"> =
  {
    getSummaryView(item): ContextItemSummaryView {
      return getGeneratedSummaryView(item.summaryState, {
        detail: summarize(item.output),
        title: `Prompt result: ${summarize(item.prompt)}`,
      });
    },

    getActions(item): readonly ContextItemAction[] {
      return [
        openContextItemAction(item.id),
        rerunPromptAction({
          expectedResult: "text",
          prompt: item.prompt,
          replaceContextItemId: item.id,
        }),
        removeContextItemAction(item.id),
      ];
    },

    async getSummarizationInput(item): Promise<ContextItemSummarizationInput> {
      const sourceText = `Prompt:\n${truncateContent(item.prompt, MAX_CONTEXT_ITEM_SUMMARY_CHARACTERS)}\n\nOutput:\n${truncateContent(item.output, MAX_CONTEXT_ITEM_SUMMARY_CHARACTERS)}`;
      return {
        content: sourceText,
        itemId: item.id,
        label: `Prompt result: ${summarize(item.prompt)}`,
        sourceHash: hashContent(sourceText),
        type: item.type,
      };
    },

    async getDetailView(item): Promise<ContextItemDetailView> {
      return {
        content: item.output,
        kind: "markdown",
        title: `Output for: ${summarize(item.prompt)}`,
      };
    },

    async formatForLlm(
      item,
      { focused }: FormatContextItemForLlmOptions,
    ): Promise<FormattedContextItem> {
      return {
        consumedFileCharacters: 0,
        text: `<answer${formatAttributes({ focused, source_request_id: item.sourceRequestId, created_at: new Date(item.createdAt).toISOString() })}>\n<question>\n${truncateContent(item.prompt, MAX_SAVED_CONTEXT_CHARACTERS)}\n</question>\n<response>\n${truncateContent(item.output, MAX_SAVED_CONTEXT_CHARACTERS)}\n</response>\n</answer>`,
      };
    },
  };
