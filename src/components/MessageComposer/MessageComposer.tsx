import type { TextareaRenderable } from "@opentui/core";
import { useCallback, useEffect, useRef } from "react";
import type { ComposeScreenState } from "../../store/appStore";
import type { FilePath } from "../../types";
import { FilteredCommandsList } from "../FilteredCommandsList";
import { FilteredFilesList } from "../FilteredFilesList";
import { useMessageComposerController } from "./useMessageComposerController";

type MessageComposerProps = {
  composeScreen: ComposeScreenState;
  filePaths: readonly FilePath[];
  inputHeight?: number;
  suggestionHeight?: number;
};

export function MessageComposer({
  composeScreen,
  filePaths,
  inputHeight = 4,
  suggestionHeight,
}: MessageComposerProps) {
  const textareaRef = useRef<TextareaRenderable | null>(null);
  const getEditorMessage = useCallback(
    () => textareaRef.current?.plainText ?? composeScreen.composer.message,
    [composeScreen.composer.message],
  );
  const getEditorCursorOffset = useCallback(
    () =>
      textareaRef.current?.cursorOffset ??
      composeScreen.composer.cursorPosition,
    [composeScreen.composer.cursorPosition],
  );
  const { commandSuggestions, fileSuggestions, inputHandlers, message } =
    useMessageComposerController({
      composeScreen,
      filePaths,
      getEditorCursorOffset,
      getEditorMessage,
    });
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea === null) {
      return;
    }

    if (textarea.plainText !== message) {
      textarea.replaceText(message);
    }

    if (textarea.cursorOffset !== composeScreen.composer.cursorPosition) {
      textarea.cursorOffset = composeScreen.composer.cursorPosition;
    }
  }, [composeScreen.composer.cursorPosition, message]);

  return (
    <box style={{ flexDirection: "column", gap: 1, width: "100%" }}>
      <box
        style={{
          backgroundColor: "#1f2937",
          height: inputHeight,
          paddingX: 1,
          width: "100%",
        }}
      >
        <textarea
          ref={textareaRef}
          initialValue={message}
          placeholder=""
          focused
          {...inputHandlers}
          style={{
            height: "100%",
            width: "100%",
            wrapMode: "word",
          }}
        />
      </box>

      {fileSuggestions === null ? null : (
        <FilteredFilesList
          fileSelector={fileSuggestions.fileSelector}
          height={suggestionHeight}
          highlightedFilePath={fileSuggestions.highlightedFilePath}
          visibleFilePaths={fileSuggestions.visibleFilePaths}
        />
      )}

      {fileSuggestions !== null || commandSuggestions === null ? null : (
        <FilteredCommandsList
          commandSelector={commandSuggestions.commandSelector}
          height={suggestionHeight}
          highlightedCommandName={commandSuggestions.highlightedCommandName}
          visibleCommands={commandSuggestions.visibleCommands}
        />
      )}
    </box>
  );
}
