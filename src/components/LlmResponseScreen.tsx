import { useKeyboard } from "@opentui/react";
import { applyPatchProposal } from "../lib/patch/patchEngine";
import { useAppStore, type LlmRequestState } from "../store/appStore";
import type { FilePath } from "../types";

type LlmResponseScreenProps = {
  request: LlmRequestState;
};

export function LlmResponseScreen({ request }: LlmResponseScreenProps) {
  const clearResponseAndMessage = useAppStore(
    (state) => state.actions.navigation.clearResponseAndMessage,
  );
  const rejectResponse = useAppStore(
    (state) => state.actions.navigation.rejectResponse,
  );
  const showComposer = useAppStore(
    (state) => state.actions.navigation.showComposer,
  );
  const responseActions = useAppStore((state) => state.actions.response);

  useKeyboard((event) => {
    if (request.patch !== undefined) {
      if (event.name === "a") {
        event.preventDefault();
        event.stopPropagation();
        void applyPatch(request, responseActions);
        return;
      }

      if (event.name === "e") {
        event.preventDefault();
        event.stopPropagation();
        showComposer();
        return;
      }

      if (event.name === "escape") {
        event.preventDefault();
        event.stopPropagation();
        rejectResponse();
        return;
      }
    }

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
      <text>{getHelpText(request)}</text>
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
      {request.patch === undefined ? null : <PatchReview request={request} />}
    </box>
  );
}

function PatchReview({ request }: { request: LlmRequestState }) {
  const patch = request.patch;
  if (patch === undefined) {
    return null;
  }

  return (
    <box
      title={`Patch (${formatPatchStatus(patch.applyStatus)})`}
      borderStyle="rounded"
      style={{ border: true, flexDirection: "column", padding: 1 }}
    >
      <text>{patch.proposal.summary}</text>
      {patch.status === "valid" ? (
        <scrollbox
          style={{
            height: 30,
            width: "100%",
          }}
        >
          <diff
            diff={patch.diffText}
            view="unified"
            showLineNumbers
            wrapMode="none"
            addedBg="#12351f"
            removedBg="#3a1717"
            addedSignColor="#4ade80"
            removedSignColor="#f87171"
            lineNumberFg="#666666"
            style={{ width: "100%" }}
          />
        </scrollbox>
      ) : (
        <box style={{ flexDirection: "column" }}>
          <text style={{ fg: "red" }}>Patch could not be applied cleanly:</text>
          {patch.errors.map((error) => (
            <text
              key={`${error.editIndex}:${error.path}`}
              style={{ fg: "red" }}
            >
              {error.path || "<unknown>"}: {error.message}
            </text>
          ))}
        </box>
      )}
      {patch.applyErrorMessage === undefined ? null : (
        <text style={{ fg: "red" }}>{patch.applyErrorMessage}</text>
      )}
      <text style={{ fg: "gray" }}>
        {patch.status === "valid"
          ? "a apply · e edit message · Esc reject"
          : "e edit message · Esc reject"}
      </text>
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

function formatPatchStatus(status: string): string {
  if (status === "apply-error") {
    return "apply error";
  }

  return status;
}

function getHelpText(request: LlmRequestState): string {
  return request.patch === undefined
    ? "Clutch response — press Enter to clear, Esc to return"
    : "Clutch patch — press a to apply, e to edit message, Esc to reject";
}

async function applyPatch(
  request: LlmRequestState,
  responseActions: ReturnType<
    typeof useAppStore.getState
  >["actions"]["response"],
) {
  if (
    request.patch === undefined ||
    request.patch.status !== "valid" ||
    request.patch.applyStatus === "applying" ||
    request.patch.applyStatus === "applied"
  ) {
    return;
  }

  responseActions.startPatchApply({ requestId: request.id });

  try {
    const result = await applyPatchProposal({
      proposal: request.patch.proposal,
    });

    if (result.status === "invalid") {
      responseActions.failPatchApply({
        errorMessage: result.errors
          .map((error) => `${error.path || "<unknown>"}: ${error.message}`)
          .join("\n"),
        requestId: request.id,
      });
      return;
    }

    responseActions.finishPatchApply({ requestId: request.id });
  } catch (error) {
    responseActions.failPatchApply({
      errorMessage: error instanceof Error ? error.message : String(error),
      requestId: request.id,
    });
  }
}

function isEnterKey(keyName: string): boolean {
  return (
    keyName === "return" || keyName === "kpenter" || keyName === "linefeed"
  );
}
