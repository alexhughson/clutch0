import { LlmResponseScreen } from "./components/LlmResponseScreen";
import { MessageComposer } from "./components/MessageComposer/MessageComposer";
import { SelectedFilesList } from "./components/SelectedFilesList";
import { useAppStore } from "./store/appStore";
import type { FilePath } from "./types";

type AppProps = {
  filePaths: readonly FilePath[];
};

export function App({ filePaths }: AppProps) {
  const screen = useAppStore((state) => state.screen);

  if (screen.name === "response") {
    return <LlmResponseScreen request={screen.request} />;
  }

  return (
    <box
      borderStyle="rounded"
      style={{
        border: true,
        flexDirection: "column",
        gap: 1,
        padding: 1,
        width: "100%",
      }}
    >
      <text>React + Zustand OpenTUI demo</text>
      <SelectedFilesList selectedFilePaths={screen.selectedFilePaths} />
      <MessageComposer composeScreen={screen} filePaths={filePaths} />
    </box>
  );
}
