import type {
  ContextItemAction,
  ContextItemDetailView,
  ContextItemSummarizationInput,
  ContextItemSummaryView,
  FormattedContextItem,
  FormatContextItemForLlmOptions,
} from "../../../types";
import {
  applyDiffAction,
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

export const savedDiffContextItemDefinition: ContextItemDefinition<"diff"> = {
  getSummaryView(item): ContextItemSummaryView {
    return getGeneratedSummaryView(item.summaryState, {
      detail: summarize(item.prompt),
      title: `Diff: ${item.summary.length > 0 ? item.summary : summarize(item.prompt)}`,
    });
  },

  getActions(item): readonly ContextItemAction[] {
    return [
      openContextItemAction(item.id),
      applyDiffAction(item.id),
      rerunPromptAction({
        expectedResult: "diff",
        prompt: item.prompt,
        replaceContextItemId: item.id,
      }),
      removeContextItemAction(item.id),
    ];
  },

  async getSummarizationInput(item): Promise<ContextItemSummarizationInput> {
    const sourceText = `Prompt:\n${truncateContent(item.prompt, MAX_CONTEXT_ITEM_SUMMARY_CHARACTERS)}\n\nSummary:\n${truncateContent(item.summary, MAX_CONTEXT_ITEM_SUMMARY_CHARACTERS)}\n\nDiff:\n${truncateContent(item.diffText, MAX_CONTEXT_ITEM_SUMMARY_CHARACTERS)}`;
    return {
      content: sourceText,
      itemId: item.id,
      label: `Diff: ${item.summary.length > 0 ? item.summary : summarize(item.prompt)}`,
      sourceHash: hashContent(sourceText),
      type: item.type,
    };
  },

  async getDetailView(item): Promise<ContextItemDetailView> {
    return {
      diffText: item.diffText,
      kind: "diff",
      summary: item.summary,
      title: `Diff: ${item.summary.length > 0 ? item.summary : summarize(item.prompt)}`,
    };
  },

  async formatForLlm(
    item,
    { focused }: FormatContextItemForLlmOptions,
  ): Promise<FormattedContextItem> {
    return {
      consumedFileCharacters: 0,
      text: `<saved_diff${formatAttributes({ focused, source_request_id: item.sourceRequestId, created_at: new Date(item.createdAt).toISOString() })}>\n<question>\n${truncateContent(item.prompt, MAX_SAVED_CONTEXT_CHARACTERS)}\n</question>\n<summary>\n${item.summary}\n</summary>\n<diff>\n${truncateContent(item.diffText, MAX_SAVED_CONTEXT_CHARACTERS)}\n</diff>\n</saved_diff>`,
    };
  },
};
