export type FilePath = string;

export interface ContextItem {
  readonly id: string;
  readonly type: string;

  formatForLlm(
    options: FormatContextItemForLlmOptions,
  ): Promise<FormattedContextItem>;
  getActions(): readonly ContextItemAction[];
  getListLabel(): string;
}

export type ContextItemAction = {
  id: string;
  key?: string;
  label: string;
  run: (context: ContextItemActionContext) => Promise<void> | void;
};

export type ContextItemActionContext = {
  removeContextItem: (itemId: string) => void;
  rerunPrompt: (prompt: string) => void;
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
