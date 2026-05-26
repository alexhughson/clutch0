export type FilePath = string;

export interface ContextItem {
  readonly id: string;
  readonly type: string;

  formatForLlm(
    options: FormatContextItemForLlmOptions,
  ): Promise<FormattedContextItem>;
  getActions(): readonly ContextItemAction[];
  getDetailView(
    options: GetContextItemDetailViewOptions,
  ): Promise<ContextItemDetailView | null>;
  getListLabel(): string;
  getSummarizationInput(
    options: GetContextItemSummaryInputOptions,
  ): Promise<ContextItemSummarizationInput | null>;
  getSummaryState(): ContextItemSummaryState;
  getSummaryView(): ContextItemSummaryView;
  withSummaryState(summaryState: ContextItemSummaryState): ContextItem;
}

export type GeneratedContextItemSummary = {
  details: string;
  generatedAt: number;
  oneLine: string;
  sourceHash: string;
};

export type ContextItemSummaryState =
  | { status: "missing" }
  | {
      sourceHash: string;
      status: "ready";
      summary: GeneratedContextItemSummary;
    }
  | {
      errorMessage: string;
      sourceHash: string;
      status: "error";
      workerId: string;
    }
  | { sourceHash: string; status: "pending"; workerId: string };

export type ContextItemSummaryView = {
  detail?: string;
  label: string;
  status: ContextItemSummaryState["status"];
  title: string;
};

export type ContextItemSummarizationInput = {
  content: string;
  itemId: string;
  label: string;
  sourceHash: string;
  type: string;
};

export type GetContextItemSummaryInputOptions = {
  root: string;
};

export type ContextItemDetailView =
  | {
      content: string;
      kind: "text";
      title: string;
    }
  | {
      diffText: string;
      kind: "diff";
      summary: string;
      title: string;
    };

export type GetContextItemDetailViewOptions = {
  root: string;
};

export type ContextItemAction = {
  id: string;
  key?: string;
  label: string;
  run: (context: ContextItemActionContext) => Promise<void> | void;
};

export type ContextItemActionContext = {
  applySavedDiff: (itemId: string) => void;
  openContextItem: (itemId: string) => void;
  removeContextItem: (itemId: string) => void;
  rerunPrompt: (options: {
    expectedResult: "diff" | "text";
    prompt: string;
    replaceContextItemId: string;
  }) => void;
};

export type FormatContextItemForLlmOptions = {
  focused: boolean;
  remainingFileCharacters: number;
  root: string;
};

export type FormattedContextItem = {
  consumedFileCharacters: number;
  file?: LlmFileContext;
  text: string;
};

export type LlmFileContext = {
  content: string;
  errorMessage?: string;
  filePath: FilePath;
  status: "included" | "skipped";
  truncated: boolean;
};

export type HighlightedFilePath = FilePath | null;

export type FileSelectionDirection = "previous" | "next";

export type FileSelectorMatch = {
  fileSelector: string;
  start: number;
  end: number;
};
