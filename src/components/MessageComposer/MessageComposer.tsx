import type { FilePath } from "../../types";
import { FilteredFilesList } from "../FilteredFilesList";
import { useMessageComposerController } from "./useMessageComposerController";

type MessageComposerProps = {
  filePaths: readonly FilePath[];
};

export function MessageComposer({ filePaths }: MessageComposerProps) {
  const { fileSuggestions, inputHandlers, message } =
    useMessageComposerController(filePaths);

  return (
    <>
      <box
        title="Message"
        borderStyle="rounded"
        style={{ border: true, height: 3 }}
      >
        <input
          value={message}
          placeholder=""
          focused
          {...inputHandlers}
          style={{
            width: "100%",
          }}
        />
      </box>

      {fileSuggestions === null ? null : (
        <FilteredFilesList
          fileSelector={fileSuggestions.fileSelector}
          highlightedFilePath={fileSuggestions.highlightedFilePath}
          visibleFilePaths={fileSuggestions.visibleFilePaths}
        />
      )}
    </>
  );
}
