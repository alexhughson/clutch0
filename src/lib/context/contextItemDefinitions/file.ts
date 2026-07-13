import type {
  ContextItemAction,
  ContextItemDetailView,
  ContextItemSummarizationInput,
  ContextItemSummaryView,
  FormattedContextItem,
  FormatContextItemForLlmOptions,
  GetContextItemDetailViewOptions,
  GetContextItemSummaryInputOptions,
} from "../../../types";
import type { ContextItemDefinition } from "../contextItemDefinition";
import type { FileContextItem } from "../contextItemTypes";
import {
  openContextItemAction,
  removeContextItemAction,
} from "../contextItemActions";
import {
  formatFile,
  getGeneratedSummaryView,
  hashContent,
  MAX_CONTEXT_ITEM_DETAIL_CHARACTERS,
  MAX_CONTEXT_ITEM_SUMMARY_CHARACTERS,
} from "../contextItemFormatting";
import { readFileContext } from "./shared";

export const fileContextItemDefinition: ContextItemDefinition<"file"> = {
  getSummaryView(item: FileContextItem): ContextItemSummaryView {
    return getGeneratedSummaryView(item.summaryState, {
      detail: "File context",
      title: `@${item.filePath}`,
    });
  },

  getActions(item: FileContextItem): readonly ContextItemAction[] {
    return [openContextItemAction(item.id), removeContextItemAction(item.id)];
  },

  async getSummarizationInput(
    item: FileContextItem,
    { root }: GetContextItemSummaryInputOptions,
  ): Promise<ContextItemSummarizationInput> {
    const file = await readFileContext({
      filePath: item.filePath,
      remainingFileCharacters: MAX_CONTEXT_ITEM_SUMMARY_CHARACTERS,
      root,
    });
    const content =
      file.status === "included"
        ? file.content
        : (file.errorMessage ?? "Unable to read file.");
    const sourceText = `File: ${item.filePath}\nStatus: ${file.status}\n\n${content}`;

    return {
      content: sourceText,
      itemId: item.id,
      label: item.filePath,
      sourceHash: hashContent(sourceText),
      type: item.type,
    };
  },

  async getDetailView(
    item: FileContextItem,
    { root }: GetContextItemDetailViewOptions,
  ): Promise<ContextItemDetailView> {
    const file = await readFileContext({
      filePath: item.filePath,
      remainingFileCharacters: MAX_CONTEXT_ITEM_DETAIL_CHARACTERS,
      root,
    });

    return {
      content:
        file.status === "included"
          ? `${file.content}${file.truncated ? "\n[File truncated.]" : ""}`
          : (file.errorMessage ?? "Unable to read file."),
      filePath: item.filePath,
      kind: "code" as const,
      title: item.filePath,
    };
  },

  async formatForLlm(
    item: FileContextItem,
    { focused, remainingFileCharacters, root }: FormatContextItemForLlmOptions,
  ): Promise<FormattedContextItem> {
    const file = await readFileContext({
      filePath: item.filePath,
      remainingFileCharacters,
      root,
    });

    return {
      consumedFileCharacters:
        file.status === "included" ? file.content.length : 0,
      file,
      text: formatFile(file, { focused }),
    };
  },
};
