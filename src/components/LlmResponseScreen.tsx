import { useKeyboard } from "@opentui/react";
import { useAppStore, type LlmRequestState } from "../store/appStore";
import type { FilePath } from "../types";

type LlmResponseScreenProps = {
  request: LlmRequestState;
};

export function LlmResponseScreen({ request }: LlmResponseScreenProps) {
  const clearResponseAndMessage = useAppStore(
    (state) => state.actions.navigation.clearResponseAndMessage,
  );
  const showComposer = useAppStore(
    (state) => state.actions.navigation.showComposer,
  );

  useKeyboard((event) => {
    if (event.name === "escape") {
      showComposer();
      return;
    }

    if (isEnterKey(event.name)) {
      event.preventDefault();
      event.stopPropagation();
      clearResponseAndMessage();
    }
  });

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
      <text>Clutch response — press Enter to clear, Esc to return</text>
      <box
        title="Question"
        borderStyle="rounded"
        style={{ border: true, flexDirection: "column", padding: 1 }}
      >
        <text>{request.question}</text>
      </box>
      <SubmittedFiles filePaths={request.filePaths} />
      <box
        title={`Response (${formatStatus(request.status)})`}
        borderStyle="rounded"
        style={{ border: true, flexDirection: "column", padding: 1 }}
      >
        {request.responseText.length > 0 ? (
          <text>{request.responseText}</text>
        ) : (
          <text>
            {request.status === "loading" ? "Waiting for model..." : ""}
          </text>
        )}
        {request.status === "error" ? (
          <text style={{ fg: "red" }}>{request.errorMessage}</text>
        ) : null}
      </box>
    </box>
  );
}

function SubmittedFiles({ filePaths }: { filePaths: readonly FilePath[] }) {
  if (filePaths.length === 0) {
    return null;
  }

  return (
    <box
      title="Selected files sent as context"
      borderStyle="rounded"
      style={{ border: true, flexDirection: "column", padding: 1 }}
    >
      {filePaths.map((filePath) => (
        <text key={filePath}>@{filePath}</text>
      ))}
    </box>
  );
}

function formatStatus(status: string): string {
  if (status === "done") {
    return "complete";
  }

  return status;
}

function isEnterKey(keyName: string): boolean {
  return (
    keyName === "return" || keyName === "kpenter" || keyName === "linefeed"
  );
}
