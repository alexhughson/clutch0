import type { FilePath, HighlightedFilePath } from "../types";

type FilteredFilesListProps = {
  fileSelector: string;
  highlightedFilePath: HighlightedFilePath;
  visibleFilePaths: FilePath[];
};

export function FilteredFilesList({
  fileSelector,
  highlightedFilePath,
  visibleFilePaths,
}: FilteredFilesListProps) {
  return (
    <box
      title={`Files matching @${fileSelector}`}
      borderStyle="rounded"
      style={{ border: true, flexDirection: "column", padding: 1 }}
    >
      {visibleFilePaths.map((filePath) => {
        const isHighlighted = filePath === highlightedFilePath;

        return (
          <text
            key={filePath}
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
