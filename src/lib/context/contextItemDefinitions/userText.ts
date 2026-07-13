import type {
  ContextItemAction,
  ContextItemDetailView,
  ContextItemSummarizationInput,
  ContextItemSummaryView,
  FormattedContextItem,
  FormatContextItemForLlmOptions,
} from "../../../types";
import type { ContextItemDefinition } from "../contextItemDefinition";
import type { UserTextContextItem } from "../contextItemTypes";
import {
  openContextItemAction,
  removeContextItemAction,
} from "../contextItemActions";
import {
  formatAttributes,
  getGeneratedSummaryView,
  MAX_SAVED_CONTEXT_CHARACTERS,
  summarize,
  truncateContent,
} from "../contextItemFormatting";

export const userTextContextItemDefinition: ContextItemDefinition<"user-text"> =
  {
    getSummaryView(item: UserTextContextItem): ContextItemSummaryView {
      return getGeneratedSummaryView(item.summaryState, {
        detail: summarize(item.text),
        title: `User text: ${summarize(item.text)}`,
      });
    },

    getActions(item: UserTextContextItem): readonly ContextItemAction[] {
      return [openContextItemAction(item.id), removeContextItemAction(item.id)];
    },

    async getSummarizationInput(): Promise<ContextItemSummarizationInput | null> {
      return null;
    },

    getLiveDetailView(
      item: UserTextContextItem,
    ): Extract<ContextItemDetailView, { kind: "editable-text" }> {
      return {
        content: item.text,
        itemId: item.id,
        kind: "editable-text" as const,
        title: "User text",
      };
    },

    async getDetailView(
      item: UserTextContextItem,
    ): Promise<ContextItemDetailView> {
      return {
        content: item.text,
        itemId: item.id,
        kind: "editable-text" as const,
        title: "User text",
      };
    },

    async formatForLlm(
      item: UserTextContextItem,
      { focused }: FormatContextItemForLlmOptions,
    ): Promise<FormattedContextItem> {
      return {
        consumedFileCharacters: 0,
        text: `<note${formatAttributes({ focused, created_at: new Date(item.createdAt).toISOString() })}>\n${truncateContent(item.text, MAX_SAVED_CONTEXT_CHARACTERS)}\n</note>`,
      };
    },
  };
