import { renderTask } from "./app/taskRegistry";
import { ContextItemsList } from "./components/ContextItemsList";
import { MessageComposer } from "./components/MessageComposer/MessageComposer";
import { useAppStore } from "./store/appStore";
import type { FilePath } from "./types";

type AppProps = {
  filePaths: readonly FilePath[];
};

export function App({ filePaths }: AppProps) {
  const activeTask = useAppStore((state) => state.activeTask);
  const workspace = useAppStore((state) => state.workspace);

  if (activeTask !== null) {
    return renderTask(activeTask);
  }

  return (
    <box
      style={{
        flexDirection: "column",
        gap: 1,
        padding: 1,
        width: "100%",
      }}
    >
      <text>Clutch</text>
      <ContextItemsList
        contextItems={workspace.contextItems}
        focusedContextItemId={workspace.focusedContextItemId}
      />
      <MessageComposer composeScreen={workspace} filePaths={filePaths} />
    </box>
  );
}
