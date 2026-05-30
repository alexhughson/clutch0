import { formatContextItemAction } from "../../lib/context/contextItemActions";
import { getContextItemById } from "../../lib/context/contextItems";
import type { ComposeScreenState } from "../../store/appStore";
import type { FilePath } from "../../types";
import { FilteredCommandsList } from "../FilteredCommandsList";
import { FilteredFilesList } from "../FilteredFilesList";
import { useMessageComposerController } from "./useMessageComposerController";

type MessageComposerProps = {
  composeScreen: ComposeScreenState;
  filePaths: readonly FilePath[];
};

export function MessageComposer({
  composeScreen,
  filePaths,
}: MessageComposerProps) {
  const { commandSuggestions, fileSuggestions, inputHandlers, message } =
    useMessageComposerController({
      composeScreen,
      filePaths,
    });
  const focusedItem = getContextItemById(
    composeScreen.contextItems,
    composeScreen.focusedContextItemId,
  );
  const focusedActions = focusedItem?.getActions() ?? [];

  return (
    <>
      <box
        title="Message"
        bottomTitle={
          focusedActions.length === 0
            ? undefined
            : focusedActions.map(formatContextItemAction).join(" · ")
        }
        bottomTitleAlignment="right"
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

      {fileSuggestions !== null || commandSuggestions === null ? null : (
        <FilteredCommandsList
          commandSelector={commandSuggestions.commandSelector}
          highlightedCommandName={commandSuggestions.highlightedCommandName}
          visibleCommands={commandSuggestions.visibleCommands}
        />
      )}
    </>
  );
}
