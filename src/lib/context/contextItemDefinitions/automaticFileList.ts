import { loadFileList } from "../../fileListLoader";
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
import { readFileListForLlm } from "../automaticContextItems";
import { openContextItemAction } from "../contextItemActions";
import type { ContextItemDefinition } from "../contextItemDefinition";
import { getGeneratedSummaryView, hashContent } from "../contextItemFormatting";
import type { AutomaticFileListContextItem } from "../contextItemTypes";

export const automaticFileListContextItemDefinition: ContextItemDefinition<"automatic-file-list"> =
  {
    getSummaryView(item: AutomaticFileListContextItem): ContextItemSummaryView {
      return getGeneratedSummaryView(item.summaryState, {
        detail: "Git-aware file list automatically included in LLM requests.",
        title: "File list",
      });
    },

    getActions(
      item: AutomaticFileListContextItem,
    ): readonly ContextItemAction[] {
      return [openContextItemAction(item.id)];
    },

    async getDetailView(
      _item: AutomaticFileListContextItem,
      { root }: GetContextItemDetailViewOptions,
    ): Promise<ContextItemDetailView> {
      const filePaths = await loadFileList({ root });
      return {
        content:
          filePaths.length === 0
            ? "No files found."
            : filePaths.map((path) => `- ${path}`).join("\n"),
        kind: "markdown",
        title: "File list",
      };
    },

    async getSummarizationInput(
      item: AutomaticFileListContextItem,
      { root }: GetContextItemSummaryInputOptions,
    ): Promise<ContextItemSummarizationInput | null> {
      const filePaths = await loadFileList({ root });
      if (filePaths.length === 0) {
        return null;
      }

      const sourceText = `File list\n\n${filePaths.join("\n")}`;
      return {
        content: sourceText,
        itemId: item.id,
        label: "File list",
        sourceHash: hashContent(sourceText),
        type: item.type,
      };
    },

    async formatForLlm(
      _item: AutomaticFileListContextItem,
      { root }: FormatContextItemForLlmOptions,
    ): Promise<FormattedContextItem> {
      return {
        consumedFileCharacters: 0,
        text: (await readFileListForLlm({ root })) ?? "",
      };
    },
  };
