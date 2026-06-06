import type { FilePath, HighlightedFilePath } from "../types";

type FilteredFilesListProps = {
  fileSelector: string;
  height?: number;
  highlightedFilePath: HighlightedFilePath;
  visibleFilePaths: FilePath[];
};

export function FilteredFilesList({
  fileSelector,
  height,
  highlightedFilePath,
  visibleFilePaths,
}: FilteredFilesListProps) {
  const renderedFilePaths = getRenderedFilePaths({
    height,
    highlightedFilePath,
    visibleFilePaths,
  });

  return (
    <box style={{ flexDirection: "column", height, width: "100%" }}>
      <text style={{ fg: "gray" }}>{`Files matching @${fileSelector}`}</text>
      {renderedFilePaths.map((filePath) => {
        const isHighlighted = filePath === highlightedFilePath;

        return (
          <text
            key={filePath}
            truncate
            wrapMode="none"
            style={isHighlighted ? { bg: "blue", fg: "white" } : undefined}
          >
            {isHighlighted ? `> ${filePath}` : `  ${filePath}`}
          </text>
        );
      })}
      {visibleFilePaths.length === 0 ? <text>No matching files.</text> : null}
    </box>
  );
}

function getRenderedFilePaths({
  height,
  highlightedFilePath,
  visibleFilePaths,
}: {
  height: number | undefined;
  highlightedFilePath: HighlightedFilePath;
  visibleFilePaths: readonly FilePath[];
}): FilePath[] {
  if (height === undefined) {
    return [...visibleFilePaths];
  }

  return getVisibleSuggestionWindow({
    highlightedIndex: highlightedFilePathIndex({
      highlightedFilePath,
      visibleFilePaths,
    }),
    items: visibleFilePaths,
    maxRows: Math.max(1, height - 1),
  });
}

function highlightedFilePathIndex({
  highlightedFilePath,
  visibleFilePaths,
}: {
  highlightedFilePath: HighlightedFilePath;
  visibleFilePaths: readonly FilePath[];
}): number {
  if (highlightedFilePath === null) {
    return -1;
  }

  return visibleFilePaths.indexOf(highlightedFilePath);
}

function getVisibleSuggestionWindow<T>({
  highlightedIndex,
  items,
  maxRows,
}: {
  highlightedIndex: number;
  items: readonly T[];
  maxRows: number;
}): T[] {
  if (items.length <= maxRows) {
    return [...items];
  }

  if (highlightedIndex === -1) {
    return [...items.slice(0, maxRows)];
  }

  const start = Math.min(
    Math.max(0, highlightedIndex - Math.floor(maxRows / 2)),
    items.length - maxRows,
  );
  return [...items.slice(start, start + maxRows)];
}
