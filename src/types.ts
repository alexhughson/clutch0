export type FilePath = string;

export type HighlightedFilePath = FilePath | null;

export type FileSelectionDirection = "previous" | "next";

export type FileSelectorMatch = {
  fileSelector: string;
  start: number;
  end: number;
};
