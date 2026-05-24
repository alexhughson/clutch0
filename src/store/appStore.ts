import { create } from "zustand";
import type { FilePath, HighlightedFilePath } from "../types";

export type ComposerState = {
  cursorPosition: number;
  highlightedFilePath: HighlightedFilePath;
  message: string;
};

export type AppState = ComposerState & {
  selectedFilePaths: FilePath[];
  acceptFileSelection: (options: {
    cursorPosition: number;
    filePath: FilePath;
    message: string;
  }) => void;
  setComposerState: (composerState: ComposerState) => void;
  setHighlightedFilePath: (filePath: HighlightedFilePath) => void;
};

export const useAppStore = create<AppState>((set) => ({
  cursorPosition: 0,
  highlightedFilePath: null,
  message: "",
  selectedFilePaths: [],
  acceptFileSelection: ({ cursorPosition, filePath, message }) =>
    set((state) => ({
      cursorPosition,
      highlightedFilePath: null,
      message,
      selectedFilePaths: state.selectedFilePaths.includes(filePath)
        ? state.selectedFilePaths
        : [...state.selectedFilePaths, filePath],
    })),
  setComposerState: (composerState) => set(composerState),
  setHighlightedFilePath: (highlightedFilePath) => set({ highlightedFilePath }),
}));
