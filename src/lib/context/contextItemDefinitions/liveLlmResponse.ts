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

export const liveLlmResponseContextItemDefinition: ContextItemDefinition<"llm-response-live"> =
  {
    getSummaryView(item): ContextItemSummaryView {
      return getGeneratedSummaryView(item.summaryState, {
        detail:
          item.status === "error"
            ? `Error: ${item.errorMessage ?? "Request failed."}`
            : summarize(item.output || "Waiting for response…"),
        title: `Running prompt: ${summarize(item.prompt)}`,
      });
    },

    getActions(item): readonly ContextItemAction[] {
      return [openContextItemAction(item.id), removeContextItemAction(item.id)];
    },

    async getSummarizationInput(
      item,
    ): Promise<ContextItemSummarizationInput | null> {
      if (item.status === "running") {
        return null;
      }

      const sourceText = `Prompt:\n${truncateContent(item.prompt, MAX_CONTEXT_ITEM_SUMMARY_CHARACTERS)}\n\nStatus: ${item.status}\n\nOutput:\n${truncateContent(item.output, MAX_CONTEXT_ITEM_SUMMARY_CHARACTERS)}\n\nError:\n${item.errorMessage ?? ""}`;
      return {
        content: sourceText,
        itemId: item.id,
        label: `Prompt result: ${summarize(item.prompt)}`,
        sourceHash: hashContent(sourceText),
        type: item.type,
      };
    },

    async getDetailView(item): Promise<ContextItemDetailView> {
      const statusLine =
        item.status === "running"
          ? "[Request still running.]"
          : `[Request failed: ${item.errorMessage ?? "unknown error"}]`;
      return {
        content: `${statusLine}\n\n${item.output}`,
        kind: "markdown",
        title: `Running prompt: ${summarize(item.prompt)}`,
      };
    },

    async formatForLlm(
      item,
      { focused }: FormatContextItemForLlmOptions,
    ): Promise<FormattedContextItem> {
      return {
        consumedFileCharacters: 0,
        text: `<answer${formatAttributes({ focused, source_request_id: item.sourceRequestId, created_at: new Date(item.createdAt).toISOString(), status: item.status })}>\n<question>\n${truncateContent(item.prompt, MAX_SAVED_CONTEXT_CHARACTERS)}\n</question>\n<response>\n${truncateContent(item.output, MAX_SAVED_CONTEXT_CHARACTERS)}\n</response>\n${item.errorMessage === undefined ? "" : `<error>\n${truncateContent(item.errorMessage, MAX_SAVED_CONTEXT_CHARACTERS)}\n</error>\n`}</answer>`,
      };
    },
  };
