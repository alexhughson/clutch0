import { MessageComposer } from "./components/MessageComposer/MessageComposer";
import { SelectedFilesList } from "./components/SelectedFilesList";
import { useAppStore } from "./store/appStore";
import type { FilePath } from "./types";

type AppProps = {
  filePaths: readonly FilePath[];
};

export function App({ filePaths }: AppProps) {
  const selectedFilePaths = useAppStore((state) => state.selectedFilePaths);

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
      <SelectedFilesList selectedFilePaths={selectedFilePaths} />
      <MessageComposer filePaths={filePaths} />
    </box>
  );
}
