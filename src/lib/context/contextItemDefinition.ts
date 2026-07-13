import type {
  ContextItemAction,
  ContextItemDetailView,
  ContextItemSummarizationInput,
  ContextItemSummaryView,
  FormattedContextItem,
  FormatContextItemForLlmOptions,
  GetContextItemDetailViewOptions,
  GetContextItemSummaryInputOptions,
} from "../../types";
import type { ContextItem } from "./contextItemTypes";

export type ContextItemDefinition<Type extends ContextItem["type"]> = {
  formatForLlm: (
    item: Extract<ContextItem, { type: Type }>,
    options: FormatContextItemForLlmOptions,
  ) => Promise<FormattedContextItem>;
  getActions: (
    item: Extract<ContextItem, { type: Type }>,
  ) => readonly ContextItemAction[];
  getDetailView: (
    item: Extract<ContextItem, { type: Type }>,
    options: GetContextItemDetailViewOptions,
  ) => Promise<ContextItemDetailView | null>;
  getLiveDetailView?: (
    item: Extract<ContextItem, { type: Type }>,
  ) => ContextItemDetailView | null;
  getSummarizationInput: (
    item: Extract<ContextItem, { type: Type }>,
    options: GetContextItemSummaryInputOptions,
  ) => Promise<ContextItemSummarizationInput | null>;
  getSummaryView: (
    item: Extract<ContextItem, { type: Type }>,
  ) => ContextItemSummaryView;
};

export type ContextItemDefinitions = {
  [Type in ContextItem["type"]]: ContextItemDefinition<Type>;
};
