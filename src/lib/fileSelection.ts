import type {
  FilePath,
  FileSelectionDirection,
  HighlightedFilePath,
} from "../types";

export function getHighlightedFilePathForVisibleFiles({
  highlightedFilePath,
  visibleFilePaths,
}: {
  highlightedFilePath: HighlightedFilePath;
  visibleFilePaths: readonly FilePath[];
}): HighlightedFilePath {
  if (visibleFilePaths.length === 0) {
    return null;
  }

  if (highlightedFilePath && visibleFilePaths.includes(highlightedFilePath)) {
    return highlightedFilePath;
  }

  return visibleFilePaths[0];
}

/** Wraps when moving past the first or last visible file suggestion. */
export function moveFileHighlight({
  direction,
  highlightedFilePath,
  visibleFilePaths,
}: {
  direction: FileSelectionDirection;
  highlightedFilePath: HighlightedFilePath;
  visibleFilePaths: readonly FilePath[];
}): HighlightedFilePath {
  const activeSelection = getHighlightedFilePathForVisibleFiles({
    highlightedFilePath,
    visibleFilePaths,
  });

  if (activeSelection === null) {
    return null;
  }

  const currentIndex = visibleFilePaths.indexOf(activeSelection);
  const delta = direction === "next" ? 1 : -1;
  const nextIndex =
    (currentIndex + delta + visibleFilePaths.length) % visibleFilePaths.length;

  return visibleFilePaths[nextIndex];
}
