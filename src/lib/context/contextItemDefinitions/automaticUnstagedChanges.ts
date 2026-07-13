import { isNotGitRepositoryError, readGitDiff } from "../../git/gitDiff";
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
import { readCurrentDiffForLlm } from "../automaticContextItems";
import { openContextItemAction } from "../contextItemActions";
import type { ContextItemDefinition } from "../contextItemDefinition";
import { getGeneratedSummaryView, hashContent } from "../contextItemFormatting";
import type { AutomaticUnstagedChangesContextItem } from "../contextItemTypes";

export const automaticUnstagedChangesContextItemDefinition: ContextItemDefinition<"automatic-unstaged-changes"> =
  {
    getSummaryView(
      item: AutomaticUnstagedChangesContextItem,
    ): ContextItemSummaryView {
      return getGeneratedSummaryView(item.summaryState, {
        detail: "Git current changes automatically included in LLM requests.",
        title: "Current changes",
      });
    },

    getActions(
      item: AutomaticUnstagedChangesContextItem,
    ): readonly ContextItemAction[] {
      return [openContextItemAction(item.id)];
    },

    async getDetailView(
      _item: AutomaticUnstagedChangesContextItem,
      { root }: GetContextItemDetailViewOptions,
    ): Promise<ContextItemDetailView> {
      let diffText: string;
      try {
        diffText = await readGitDiff({
          includeStaged: true,
          maxBuffer: Number.MAX_SAFE_INTEGER,
          root,
        });
      } catch (error) {
        if (!isNotGitRepositoryError(error)) {
          throw error;
        }
        diffText = "";
      }

      return diffText.trim().length === 0
        ? {
            content: "No current changes.",
            kind: "text",
            title: "Current changes",
          }
        : {
            diffText,
            kind: "diff",
            summary: "Current working tree diff.",
            title: "Current changes",
          };
    },

    async getSummarizationInput(
      item: AutomaticUnstagedChangesContextItem,
      { root }: GetContextItemSummaryInputOptions,
    ): Promise<ContextItemSummarizationInput | null> {
      const diffText = await readCurrentDiffForLlm({ root });
      if (diffText === null) {
        return null;
      }

      const sourceText = `Current changes\n\n${diffText}`;
      return {
        content: sourceText,
        itemId: item.id,
        label: "Current changes",
        sourceHash: hashContent(sourceText),
        type: item.type,
      };
    },

    async formatForLlm(
      _item: AutomaticUnstagedChangesContextItem,
      { root }: FormatContextItemForLlmOptions,
    ): Promise<FormattedContextItem> {
      return {
        consumedFileCharacters: 0,
        text: (await readCurrentDiffForLlm({ root })) ?? "",
      };
    },

  };
