import type { FilePath } from "../types";

type SelectedFilesListProps = {
  selectedFilePaths: FilePath[];
};

export function SelectedFilesList({
  selectedFilePaths,
}: SelectedFilesListProps) {
  if (selectedFilePaths.length === 0) {
    return null;
  }

  return (
    <box
      title="Selected files"
      borderStyle="rounded"
      style={{ border: true, flexDirection: "column", padding: 1 }}
    >
      {selectedFilePaths.map((filePath) => (
        <text key={filePath}>@{filePath}</text>
      ))}
    </box>
  );
}
